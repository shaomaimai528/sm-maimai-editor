/** 非破坏性调整算子：对 ImageData 做纯函数变换 */

import type { AdjustParams } from '../doc/types'

/**
 * 参数安全化
 *
 * 这一步看着多余，其实是黑屏的根治点。
 * 只要 exposure / contrast 里混进 NaN 或 Infinity，
 * Math.pow(2, NaN) 就是 NaN，LUT 里整张表都变成 0，
 * 画面立刻全黑 —— 而用户只是拖了一下滑杆，完全不知道发生了什么。
 * 所以任何进入算法的数值都必须先夹到有限区间里。
 */
function safe(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(min, Math.min(max, n))
}

/** 查找表：把 0..255 的通道值预先算好，比逐像素计算快一个数量级 */
function buildLUT(p: AdjustParams): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  const exposure = safe(p.exposure, -100, 100) / 100
  const contrast = safe(p.contrast, -100, 100) / 100

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

/** 把 0..255 夹回合法范围（Uint8ClampedArray 会取整，这里只保证数值干净） */
function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/** 应用基础调整；就地修改传入的 ImageData */
export function applyAdjust(img: ImageData, p: AdjustParams): ImageData {
  // params 缺失时原样返回，绝不拿 undefined 去算
  if (!p) return img

  const d = img.data
  const lut = buildLUT(p)
  const sat = safe(p.saturation, -100, 100) / 100
  const temp = safe(p.temperature, -100, 100) / 100
  const tint = safe(p.tint, -100, 100) / 100

  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]]
    let g = lut[d[i + 1]]
    let b = lut[d[i + 2]]

    // 色温：暖加红减蓝，冷反之
    if (temp !== 0) {
      r = clamp255(r + temp * 40)
      b = clamp255(b - temp * 40)
    }
    // 色调：正洋红负绿
    if (tint !== 0) {
      g = clamp255(g - tint * 30)
      r = clamp255(r + tint * 15)
    }

    // 饱和度：向亮度灰阶插值
    if (sat !== 0) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = clamp255(lum + (r - lum) * (1 + sat))
      g = clamp255(lum + (g - lum) * (1 + sat))
      b = clamp255(lum + (b - lum) * (1 + sat))
    }

    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
  }
  return img
}
