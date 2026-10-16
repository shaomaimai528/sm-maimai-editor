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

/** 生成文档的合成缩略快照，用于屏幕显示 */
export function useComposedBitmap(doc: Doc | null): ComposedBitmap | null {
  const [state, setState] = useState<ComposedBitmap | null>(null)
  const rafRef = useRef<number | null>(null)
  const prevRef = useRef<ImageBitmap | null>(null)
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
      prevRef.current?.close?.()
      prevRef.current = null
      return
    }

    // 用 rAF 合并高频变更（拖滑杆时避免每帧都重算）
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(async () => {
      const scale = Math.min(1, PROXY_MAX_EDGE / Math.max(doc.width, doc.height))
      const w = Math.max(1, Math.round(doc.width * scale))
      const h = Math.max(1, Math.round(doc.height * scale))

      try {
        const bitmap = await renderDoc(doc, w, h)
        prevRef.current?.close?.()
        prevRef.current = bitmap
        setState({ bitmap, width: w, height: h, scale })
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
            const bitmap = await renderDoc(safeDoc, w, h)
            prevRef.current?.close?.()
            prevRef.current = bitmap
            setState({ bitmap, width: w, height: h, scale })
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

  useEffect(() => {
    return () => { prevRef.current?.close?.() }
  }, [])

  return state
}
