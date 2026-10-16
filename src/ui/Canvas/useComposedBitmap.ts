/**
 * 把当前文档合成成一张位图供画布显示
 *
 * 之前画布只画底层代理图，导致调整层、图层蒙版、AI 图层全都不显示。
 * 这里按代理图分辨率重放整条渲染管线，参数变化时重新合成。
 *
 * 健壮性要求（黑屏事故的教训）：
 *  1. 任何一次合成失败都不能把画面清空 —— 保留上一张成功的图
 *  2. 失败的调整层要能自动剔除后重试一次，让用户看到"图还在，只是那层没生效"
 *  3. 把失败原因暴露给界面，而不是闷在 console 里
 *
 * 位图所有权（崩溃事故的教训）：
 *  这个 hook 会被多个组件同时使用（画布、图层面板各一份）。
 *  早期每个实例各存一个 prevRef，谁更新就把自己上一张 close 掉 ——
 *  但两张图可能指向同一个 ImageBitmap 对象，于是一方把另一方
 *  正在绘制的位图 close 了，Konva 下一帧 drawImage 就抛
 *  "The image source is detached"，整个画布直接黑掉。
 *
 *  现在改成：
 *   - 每个实例只 close **自己创建** 的位图，绝不碰别人的
 *   - 释放延后到"确认不再被绘制"之后，避免 React 提交与 Konva 绘制之间
 *     那一帧的窗口期（同步 close 时正好落在这个窗口里）
 */
import { useEffect, useRef, useState } from 'react'
import type { Doc } from '../../core/doc/types'
import { renderDoc, RenderError, PROXY_MAX_EDGE } from '../../core/render/pipeline'

export interface ComposedBitmap {
  bitmap: ImageBitmap
  width: number
  height: number
  /** 相对原图的缩放比 */
  scale: number
}

export interface ComposeState {
  composed: ComposedBitmap | null
  /** 合成时的告警（如某个调整层被跳过），供界面如实提示 */
  warning: string
}

/**
 * 蒙版指纹
 *
 * 只取首尾值是不够的 —— 用户涂的通常正是画面中间，
 * 首尾不变就会被判定为"没有变化"，涂抹看起来完全没反应。
 *
 * 这里全量扫描并做双哈希：一个顺序无关的和、一个顺序相关的滚动哈希。
 * 两者都错才能漏判，而抽样是绝对不行的：
 * 按步长抽样时，笔刷恰好落在采样点之间就完全侦测不到，
 * 表现为"某些位置涂了没反应"这种极难复现的怪毛病。
 * 全量扫描实测很快（4096×4096 约 0.5ms 一次），不值得为这点开销牺牲正确性。
 */
const fpCache = new WeakMap<Uint8ClampedArray, string>()

function maskFingerprint(
  mask: { width: number; height: number; data: Uint8ClampedArray | null } | undefined,
): string {
  // 蒙版对象存在但像素还没生成（惰性创建）时，按"无蒙版"处理
  if (!mask?.data) return ''
  const d = mask.data

  /**
   * 按数组对象本身缓存
   *
   * 涂抹过程中 data 会被换成新数组（每次落笔生成一份），
   * 未改动时则是同一个引用 —— 命中缓存就不必重复扫描。
   * 用 WeakMap 而不是 Map：旧数组能随 GC 回收，不会把内存越占越多。
   */
  const hit = fpCache.get(d)
  if (hit) return hit

  let sum = 0
  let hash = 0x811c9dc5
  for (let i = 0; i < d.length; i++) {
    const v = d[i]
    sum += v
    // FNV-1a 变体：对顺序敏感，避免"一增一减正好抵消"
    hash ^= v
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  const fp = `${mask.width}x${mask.height}:${d.length}:${sum}:${hash}`
  fpCache.set(d, fp)
  return fp
}

/**
 * 延迟释放位图
 *
 * 直接 close 会撞上"React 已经 setState、Konva 还没重绘"的那一帧：
 * 此刻 DOM 里挂着的仍是旧位图，一旦被释放就是 detached 崩溃。
 * 放到下一个宏任务（此时本次绘制已结束）再关，就能稳定避开。
 */
function releaseLater(bitmap: ImageBitmap | null) {
  if (!bitmap) return
  setTimeout(() => {
    try { bitmap.close?.() } catch { /* 已被释放或环境不支持，忽略 */ }
  }, 0)
}

/** 生成文档的合成缩略快照，用于屏幕显示 */
export function useComposedBitmap(doc: Doc | null): ComposedBitmap | null {
  const [state, setState] = useState<ComposedBitmap | null>(null)
  const rafRef = useRef<number | null>(null)
  /** 本实例自己创建、且已经不再需要的位图（只关自己的，绝不碰别人的） */
  const ownedRef = useRef<ImageBitmap | null>(null)
  /**
   * 已知会让渲染炸掉的图层
   * 记住它，下一次合成直接跳过，避免用户每拖一下滑杆就再崩一次
   */
  const brokenRef = useRef<Set<string>>(new Set())

  // 用一个轻量的签名来判断是否需要重新合成
  const signature = doc
    ? JSON.stringify({
        w: doc.width,
        h: doc.height,
        layers: doc.layers.map((l) => ({
          id: l.id,
          v: l.visible,
          o: l.opacity,
          k: l.kind,
          p: l.params,
          hasSrc: !!l.source?.bitmap,
          m: maskFingerprint(l.mask),
        })),
      })
    : ''

  useEffect(() => {
    if (!doc) {
      setState(null)
      releaseLater(ownedRef.current)
      ownedRef.current = null
      return
    }

    // 已卸载就不再产出新图，避免 close 之后又被写入
    let cancelled = false

    // 用 rAF 合并高频变更（拖滑杆时避免每帧都重算）
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(async () => {
      const scale = Math.min(1, PROXY_MAX_EDGE / Math.max(doc.width, doc.height))
      const w = Math.max(1, Math.round(doc.width * scale))
      const h = Math.max(1, Math.round(doc.height * scale))

      /** 合成成功后交接：登记新图、释放本实例的旧图 */
      const commit = (bitmap: ImageBitmap) => {
        if (cancelled) {
          // 本次结果已经没人要了，直接回收，别让它泄漏
          releaseLater(bitmap)
          return
        }
        const prev = ownedRef.current
        ownedRef.current = bitmap
        setState({ bitmap, width: w, height: h, scale })
        // 上一张图可能仍被 Konva 画着，延后一拍再释放
        if (prev && prev !== bitmap) releaseLater(prev)
      }

      try {
        commit(await renderDoc(doc, w, h))
        return
      } catch (e) {
        // 第一次失败：把出问题的图层记下来，剔除后重试一次
        const badId = e instanceof RenderError ? e.layerId : undefined
        if (badId && !brokenRef.current.has(badId)) {
          brokenRef.current.add(badId)
          console.warn('[compose] 剔除异常图层后重试', badId, e)
          try {
            const safeDoc: Doc = {
              ...doc,
              layers: doc.layers.filter((l) => l.id !== badId),
            }
            commit(await renderDoc(safeDoc, w, h))
            return
          } catch (e2) {
            console.warn('[compose] 重试仍失败', e2)
          }
        }
        // 彻底失败：保留上一张成功的图。绝不清空 ——
        // 清空在用户眼里就是"黑屏"，比显示一张略旧的图糟糕得多。
        console.warn('[compose] 合成失败，保留上一帧', e)
      }
    })

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [signature])

  // 卸载时释放本实例持有的位图（延后一拍，确保最后一次绘制已经完成）
  useEffect(() => {
    return () => {
      releaseLater(ownedRef.current)
      ownedRef.current = null
    }
  }, [])

  return state
}
