/**
 * 把当前文档合成成一张位图供画布显示
 *
 * 之前画布只画底层代理图，导致调整层、图层蒙版、AI 图层全都不显示。
 * 这里按代理图分辨率重放整条渲染管线，参数变化时重新合成。
 */
import { useEffect, useRef, useState } from 'react'
import type { Doc } from '../../core/doc/types'
import { renderDoc, PROXY_MAX_EDGE } from '../../core/render/pipeline'

export interface ComposedBitmap {
  bitmap: ImageBitmap
  width: number
  height: number
  /** 相对原图的缩放比 */
  scale: number
}

/** 生成文档的合成缩略快照，用于屏幕显示 */
export function useComposedBitmap(doc: Doc | null): ComposedBitmap | null {
  const [state, setState] = useState<ComposedBitmap | null>(null)
  const rafRef = useRef<number | null>(null)
  const prevRef = useRef<ImageBitmap | null>(null)

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
          // 蒙版的版本用像素长度与首尾值近似，避免每次全量比对
          m: l.mask?.data ? [l.mask.width, l.mask.height, l.mask.data.length, l.mask.data[0], l.mask.data[l.mask.data.length - 1]] : null,
        })),
      })
    : ''

  useEffect(() => {
    if (!doc) {
      setState(null)
      return
    }

    // 用 rAF 合并高频变更（拖滑杆时避免每帧都重算）
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(async () => {
      try {
        const scale = Math.min(1, PROXY_MAX_EDGE / Math.max(doc.width, doc.height))
        const w = Math.max(1, Math.round(doc.width * scale))
        const h = Math.max(1, Math.round(doc.height * scale))
        const bitmap = await renderDoc(doc, w, h)

        // 释放上一张，避免内存堆积
        prevRef.current?.close?.()
        prevRef.current = bitmap
        setState({ bitmap, width: w, height: h, scale })
      } catch (e) {
        console.warn('[compose] 合成失败', e)
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
