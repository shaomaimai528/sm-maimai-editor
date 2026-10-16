/**
 * 蒙版与选区运算
 *
 * 选区与蒙版用同一套表示：Uint8ClampedArray 灰度，0..255。
 * 选区（白=选中）与图层蒙版（白=显示）语义一致，可直接互转。
 */

import { computeBounds } from '../doc/types'

export interface MaskBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

export function createMask(width: number, height: number, fill = 0): MaskBuffer {
  const data = new Uint8ClampedArray(width * height)
  if (fill) data.fill(fill)
  return { data, width, height }
}

/** 把点集渲染成抗锯齿的选区蒙版（套索用） */
export function maskFromPolygon(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number
): MaskBuffer {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  if (points.length) {
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    ctx.closePath()
    ctx.fill()
  }
  const img = ctx.getImageData(0, 0, width, height)
  const out = new Uint8ClampedArray(width * height)
  // 取红通道即可（抗锯齿结果天然平滑）
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = img.data[p]
  return { data: out, width, height }
}

/** 魔术棒：扫描线洪水填充，比逐像素递归快得多且不会爆栈 */
export function magicWand(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  tolerance: number,
  contiguous = true
): MaskBuffer {
  const out = createMask(width, height, 0)
  const visited = new Uint8Array(width * height)
  const sx = Math.round(startX)
  const sy = Math.round(startY)
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return out

  const si = (sy * width + sx) * 4
  const sr = pixels[si], sg = pixels[si + 1], sb = pixels[si + 2]

  const match = (x: number, y: number): boolean => {
    const i = (y * width + x) * 4
    const dr = pixels[i] - sr
    const dg = pixels[i + 1] - sg
    const db = pixels[i + 2] - sb
    // 欧氏距离，阈值按 0..255 的 tolerance 放大
    const dist = Math.sqrt(dr * dr + dg * dg + db * db)
    return dist <= tolerance * 2.55
  }

  if (!contiguous) {
    // 全局模式：整幅图匹配相似颜色
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (match(x, y)) out.data[y * width + x] = 255
      }
    }
    return out
  }

  // 扫描线填充
  const stack: Array<[number, number]> = [[sx, sy]]
  while (stack.length) {
    const [x0, y0] = stack.pop()!
    if (visited[y0 * width + x0]) continue

    let left = x0
    let right = x0
    while (left > 0 && !visited[y0 * width + left - 1] && match(left - 1, y0)) left--
    while (right < width - 1 && !visited[y0 * width + right + 1] && match(right + 1, y0)) right++

    for (let x = left; x <= right; x++) {
      const idx = y0 * width + x
      visited[idx] = 1
      out.data[idx] = 255

      if (y0 > 0) {
        const up = (y0 - 1) * width + x
        if (!visited[up] && match(x, y0 - 1)) stack.push([x, y0 - 1])
      }
      if (y0 < height - 1) {
        const dn = (y0 + 1) * width + x
        if (!visited[dn] && match(x, y0 + 1)) stack.push([x, y0 + 1])
      }
    }
  }

  return out
}

/** 高斯羽化：用栈式模糊近似，两次盒式模糊逼近高斯，够快且观感自然 */
export function feather(mask: MaskBuffer, radius: number): MaskBuffer {
  const r = Math.max(0, Math.round(radius))
  if (r <= 0) return mask
  const { width, height } = mask
  let src = new Float32Array(mask.data)
  let dst = new Float32Array(width * height)

  for (let pass = 0; pass < 2; pass++) {
    // 水平
    for (let y = 0; y < height; y++) {
      const row = y * width
      let sum = 0
      const win = 2 * r + 1
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(width - 1, Math.max(0, x))]
      for (let x = 0; x < width; x++) {
        dst[row + x] = sum / win
        const outIdx = row + Math.min(width - 1, Math.max(0, x - r))
        const inIdx = row + Math.min(width - 1, Math.max(0, x + r + 1))
        sum += src[inIdx] - src[outIdx]
      }
    }
    // 垂直
    const tmp = src; src = dst; dst = tmp
    for (let x = 0; x < width; x++) {
      let sum = 0
      const win = 2 * r + 1
      for (let y = -r; y <= r; y++) sum += src[Math.min(height - 1, Math.max(0, y)) * width + x]
      for (let y = 0; y < height; y++) {
        dst[y * width + x] = sum / win
        const outIdx = Math.min(height - 1, Math.max(0, y - r)) * width + x
        const inIdx = Math.min(height - 1, Math.max(0, y + r + 1)) * width + x
        sum += src[inIdx] - src[outIdx]
      }
    }
    const tmp2 = src; src = dst; dst = tmp2
  }

  const out = new Uint8ClampedArray(width * height)
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, src[i]))
  return { data: out, width, height }
}

/** 反选 */
export function invert(mask: MaskBuffer): MaskBuffer {
  const data = new Uint8ClampedArray(mask.width * mask.height)
  for (let i = 0; i < data.length; i++) data[i] = 255 - mask.data[i]
  return { ...mask, data }
}

export function bounds(mask: MaskBuffer) {
  return computeBounds(mask.data, mask.width, mask.height)
}

/** 扩张 / 收缩（形态学膨胀腐蚀，用近似盒式实现） */
export function grow(mask: MaskBuffer, amount: number): MaskBuffer {
  if (amount === 0) return mask
  return amount > 0 ? dilate(mask, amount) : erode(mask, -amount)
}

function dilate(mask: MaskBuffer, r: number): MaskBuffer {
  const { width, height, data } = mask
  const out = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0
      for (let dy = -r; dy <= r && max < 255; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const v = data[yy * width + xx]
          if (v > max) max = v
        }
      }
      out[y * width + x] = max
    }
  }
  return { data: out, width, height }
}

function erode(mask: MaskBuffer, r: number): MaskBuffer {
  const { width, height, data } = mask
  const out = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 255
      for (let dy = -r; dy <= r && min > 0; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const v = data[yy * width + xx]
          if (v < min) min = v
        }
      }
      out[y * width + x] = min
    }
  }
  return { data: out, width, height }
}

/** 在蒙版上绘制笔刷：硬度控制边缘柔和度，流量控制叠加浓度 */
export function paintBrush(
  mask: MaskBuffer,
  cx: number,
  cy: number,
  radius: number,
  hardness: number,
  flow: number,
  erase: boolean
): MaskBuffer {
  const { width, height, data } = mask
  const out = new Uint8ClampedArray(data)
  const r = Math.max(1, radius)
  const hardR = r * Math.max(0, Math.min(1, hardness))
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(width - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(height - 1, Math.ceil(cy + r))
  const f = Math.max(0, Math.min(1, flow))

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx
      const dy = y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r) continue
      // 硬度范围内为 1，之外线性衰减到 0
      const t = d <= hardR ? 1 : 1 - (d - hardR) / Math.max(1e-6, r - hardR)
      const a = Math.max(0, Math.min(1, t)) * f
      const idx = y * width + x
      const cur = out[idx]
      out[idx] = erase ? cur * (1 - a) : cur + (255 - cur) * a
    }
  }
  return { data: out, width, height }
}
