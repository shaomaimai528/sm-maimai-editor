/**
 * 选区可视化
 *
 * 目标：让用户随时看清"选了什么"，同时**一点都不遮住图**。
 *
 * 早先的做法是在选区外铺一层半透明黑（模仿 PS 快速蒙版），
 * 但手机上屏幕本来就小，那层黑直接把整张图压暗，
 * 选完就看不见图了 —— 与"图层操作挡住视线"是同一类毛病。
 *
 * 现在只用两种轻量手段：
 *  1. 选区边界描一圈流动蚂蚁线（主视觉）
 *  2. 边界内再压一圈极细的白色内描边，深色底图上也看得清
 * 选区内部完全透明，图片原样可见。
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
  const [tick, setTick] = useState(0)
  const prevKey = useRef('')

  // 只有当蒙版内容真的变化时才重建边界，避免拖动时反复绘制
  const key = useMemo(() => {
    const d = selection.data
    let sum = 0
    // 采样求和作为内容指纹，比全量比对方便且够用
    const step = Math.max(1, Math.floor(d.length / 512))
    for (let i = 0; i < d.length; i += step) sum = (sum + d[i] * (i + 1)) % 2147483647
    return `${selection.width}x${selection.height}:${sum}`
  }, [selection])

  // 边界绘制：在单独画布上描出蒙版轮廓，只画线，不填任何东西
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
  }, [key, selection])

  // 蚂蚁线动画：让边界可见且显得"活的"
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 90)
    return () => clearInterval(id)
  }, [])

  // 边界光晕粗细按缩放反向补偿，放大后不会变糊
  const glow = Math.max(1.5, 3 / Math.max(0.25, zoom))

  return (
    <>
      {/*
        蓝色光晕打底
        纯白蚂蚁线在浅色/白色画面上会彻底消失（用户以为没选中），
        先铺一层带蓝色阴影的线，浅底靠蓝、深底靠白，两种底都成立。
      */}
      <KImage
        image={outline}
        width={viewWidth}
        height={viewHeight}
        listening={false}
        opacity={0.95}
        shadowColor="#2563EB"
        shadowBlur={glow}
        shadowOpacity={1}
      />
      {/* 白色蚂蚁线，靠交替显隐做出流动感 */}
      <KImage
        image={outline}
        width={viewWidth}
        height={viewHeight}
        listening={false}
        opacity={0.95}
        visible={tick % 2 === 0}
      />
    </>
  )
}
