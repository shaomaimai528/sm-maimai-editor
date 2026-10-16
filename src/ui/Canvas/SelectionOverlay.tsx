/**
 * 选区可视化
 *
 * 之前选区完全没有视觉反馈 —— 用户框选了却看不见，这是最影响可用性的缺陷。
 * 这里用两个手段表达选区：
 *  1. 选区外覆盖一层半透明暗色（像 PS 的快速蒙版），选区内保持原样
 *  2. 选区边界描一圈蚂蚁线（虚线，缓慢流动）
 *
 * 实现方式：把灰度蒙版转成一张带 alpha 的位图，直接作为 Konva Image 叠加。
 * 比逐点绘制路径快得多，且对任意形状（套索/魔术棒/笔刷）都成立。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as KImage } from 'react-konva'
import type { MaskBuffer } from '../../core/selection/mask'

interface Props {
  selection: MaskBuffer
  docWidth: number
  docHeight: number
  /** 屏幕上图片的显示宽高 */
  viewWidth: number
  viewHeight: number
  zoom: number
}

export function SelectionOverlay({
  selection, docWidth, docHeight, viewWidth, viewHeight, zoom,
}: Props) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [tick, setTick] = useState(0)
  const prevKey = useRef('')

  // 只有当蒙版内容真的变化时才重建画布，避免拖动时反复绘制
  const key = useMemo(() => {
    const d = selection.data
    let sum = 0
    // 采样求和作为内容指纹，比全量比对方便且够用
    const step = Math.max(1, Math.floor(d.length / 512))
    for (let i = 0; i < d.length; i += step) sum = (sum + d[i] * (i + 1)) % 2147483647
    return `${selection.width}x${selection.height}:${sum}`
  }, [selection])

  useEffect(() => {
    if (key === prevKey.current && canvas) return
    prevKey.current = key

    const { width, height, data } = selection
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(width, height)
    const px = img.data

    // 选区内透明，选区外半透明黑
    for (let i = 0, p = 0; i < data.length; i++, p += 4) {
      const inside = data[i]
      px[p] = 0
      px[p + 1] = 0
      px[p + 2] = 0
      px[p + 3] = Math.round((1 - inside / 255) * 110)
    }
    ctx.putImageData(img, 0, 0)
    setCanvas(c)
  }, [key, selection, canvas])

  // 蚂蚁线动画：让边界可见且显得"活的"
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 90)
    return () => clearInterval(id)
  }, [])

  // 边界绘制：在单独画布上描出蒙版的轮廓
  const outline = useMemo(() => {
    const { width, height, data } = selection
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(width, height)
    const px = img.data

    // 边缘检测：自身在选区内、但有邻居在选区外 → 判定为边界
    const inside = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] > 128

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!inside(x, y)) continue
        if (inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) continue
        const p = (y * width + x) * 4
        px[p] = 255
        px[p + 1] = 255
        px[p + 2] = 255
        px[p + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return c
  }, [key])

  return (
    <>
      {canvas && (
        <KImage
          image={canvas}
          width={viewWidth}
          height={viewHeight}
          listening={false}
          opacity={1}
        />
      )}
      {/* 蚂蚁线：用 dash offset 做流动感；tick 驱动重渲染 */}
      <KImage
        image={outline}
        width={viewWidth}
        height={viewHeight}
        listening={false}
        opacity={0.85}
        // 用交替显隐模拟流动虚线
        visible={tick % 2 === 0}
      />
    </>
  )
}
