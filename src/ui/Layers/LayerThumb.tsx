/**
 * 图层缩略图
 *
 * 优先用图层自身像素；调整层没有像素，用当前合成结果的缩略来示意，
 * 至少让用户一眼分清是哪一层。
 */
import { useEffect, useRef } from 'react'
import type { Layer } from '../../core/doc/types'

interface Props {
  layer: Layer
  /** 调整层没有源像素时，退而使用整幅合成图做底 */
  fallback?: ImageBitmap | null
  size?: number
}

export function LayerThumb({ layer, fallback, size = 40 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)

    // 棋盘格：让透明区域可见
    const cell = 6
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        ctx.fillStyle = ((x / cell + y / cell) % 2 === 0) ? '#f0f0f0' : '#e0e0e0'
        ctx.fillRect(x, y, cell, cell)
      }
    }

    const src = layer.source?.bitmap || (layer.kind === 'adjustment' ? fallback : null)
    if (src) {
      // 等比铺满，居中裁切，缩略图才不变形
      const ar = src.width / src.height
      let dw = size
      let dh = size
      if (ar > 1) dw = size * ar
      else dh = size / ar
      ctx.drawImage(src, (size - dw) / 2, (size - dh) / 2, dw, dh)
    }
  }, [layer.source?.bitmap, layer.kind, fallback, size])

  return (
    <canvas
      ref={ref}
      className="layer-thumb-canvas"
      style={{ width: size, height: size }}
    />
  )
}
