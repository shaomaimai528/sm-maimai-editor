/** 非破坏性调整算子：对 ImageData 做纯函数变换 */

import type { AdjustParams } from '../doc/types'

/** 查找表：把 0..255 的通道值预先算好，比逐像素计算快一个数量级 */
function buildLUT(p: AdjustParams): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  const exposure = p.exposure / 100
  const contrast = p.contrast / 100

  for (let i = 0; i < 256; i++) {
    let v = i / 255

    // 曝光：以 2 为底的指数增益，符合摄影直觉
    v *= Math.pow(2, exposure)

    // 对比度：围绕中灰 0.5 拉伸
    v = (v - 0.5) * (1 + contrast) + 0.5

    lut[i] = Math.max(0, Math.min(255, Math.round(v * 255)))
  }
  return lut
}

/** 应用基础调整；就地修改传入的 ImageData */
export function applyAdjust(img: ImageData, p: AdjustParams): ImageData {
  const d = img.data
  const lut = buildLUT(p)
  const sat = p.saturation / 100
  const temp = p.temperature / 100
  const tint = p.tint / 100

  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]]
    let g = lut[d[i + 1]]
    let b = lut[d[i + 2]]

    // 色温：暖加红减蓝，冷反之
    if (temp !== 0) {
      r = Math.max(0, Math.min(255, r + temp * 40))
      b = Math.max(0, Math.min(255, b - temp * 40))
    }
    // 色调：正洋红负绿
    if (tint !== 0) {
      g = Math.max(0, Math.min(255, g - tint * 30))
      r = Math.max(0, Math.min(255, r + tint * 15))
    }

    // 饱和度：向亮度灰阶插值
    if (sat !== 0) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = Math.max(0, Math.min(255, lum + (r - lum) * (1 + sat)))
      g = Math.max(0, Math.min(255, lum + (g - lum) * (1 + sat)))
      b = Math.max(0, Math.min(255, lum + (b - lum) * (1 + sat)))
    }

    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
  }
  return img
}

/** 计算直方图（RGB 三通道 + 亮度） */
export function histogram(img: ImageData) {
  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  const lum = new Uint32Array(256)
  const d = img.data

  for (let i = 0; i < d.length; i += 4) {
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++
    lum[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++
  }
  return { r, g, b, lum }
}

/** 解析曲线控制点到查找表 */
export function curveLUT(points: Array<[number, number]>): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  if (!points || points.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i
    return lut
  }
  const sorted = [...points].sort((a, b) => a[0] - b[0])

  for (let i = 0; i < 256; i++) {
    const x = i / 255
    let y: number
    if (x <= sorted[0][0]) y = sorted[0][1]
    else if (x >= sorted[sorted.length - 1][0]) y = sorted[sorted.length - 1][1]
    else {
      let k = 0
      while (k < sorted.length - 1 && sorted[k + 1][0] < x) k++
      const [x0, y0] = sorted[k]
      const [x1, y1] = sorted[k + 1]
      const t = (x - x0) / Math.max(1e-6, x1 - x0)
      // 平滑插值，避免曲线出现折角
      const ts = t * t * (3 - 2 * t)
      y = y0 + (y1 - y0) * ts
    }
    lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)))
  }
  return lut
}
