/**
 * AI 结果贴回管线 —— 整个产品的体验分水岭
 *
 * 流程：扩边取上下文 → 编码上传 → AI 生成 → 缩放还原 → 蒙版合成 → 新图层
 *
 * 关键点：
 *  1. 裁切取自原图而非代理图，保证画质
 *  2. 外扩 padding 给 AI 留上下文，避免生成内容与周边割裂
 *  3. 还原时按裁切记录的比例精确缩放，不引入位置漂移
 *  4. 合成必须走原选区蒙版 + 羽化，否则边缘一眼看出是"贴上去的"
 */

import type { MaskBuffer } from '../selection/mask'
import { feather } from '../selection/mask'
import { computeBounds } from '../doc/types'

export interface ContextBox {
  x: number
  y: number
  w: number
  h: number
}

/** 计算带上下文的外扩框，并夹取到画布范围内 */
export function contextBounds(
  selBounds: { x: number; y: number; w: number; h: number },
  docW: number,
  docH: number,
  paddingRatio = 0.15
): ContextBox {
  const pad = Math.max(32, Math.round(Math.max(selBounds.w, selBounds.h) * paddingRatio))
  const x = Math.max(0, selBounds.x - pad)
  const y = Math.max(0, selBounds.y - pad)
  const w = Math.min(docW - x, selBounds.w + pad * 2)
  const h = Math.min(docH - y, selBounds.h + pad * 2)
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) }
}

/** 从源图裁出上下文区域，并等比缩放到模型友好尺寸，返回 dataURL */
export async function cropForAI(
  source: ImageBitmap,
  box: ContextBox,
  maxEdge = 1536,
  quality = 0.92
): Promise<{ dataUrl: string; scale: number }> {
  const scale = Math.min(1, maxEdge / Math.max(box.w, box.h))
  const tw = Math.max(1, Math.round(box.w * scale))
  const th = Math.max(1, Math.round(box.h * scale))

  const canvas = new OffscreenCanvas(tw, th)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, tw, th)

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  const dataUrl = await blobToDataUrl(blob)
  return { dataUrl, scale }
}

/** 把 AI 结果按选区蒙版合成回原图，返回新图层的 ImageBitmap */
export async function composeResult(
  result: ImageBitmap,
  source: ImageBitmap,
  box: ContextBox,
  mask: MaskBuffer,
  featherRadius: number,
  /** 是否做颜色匹配，把生成结果的色调往原图靠 */
  colorMatch = false
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(Math.round(box.w), Math.round(box.h))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 1. 把 AI 结果还原到上下文框的原始像素尺寸
  //
  // 多数模型会保持输入宽高比（实测 XEM 输入 800x300 返回 2048x768，比例一致），
  // 但部分模型固定输出 1:1。此时直接拉伸会让画面变形、贴回后"对不上"。
  // 因此先等比铺满，再把多出来的部分居中裁掉 —— 保证不形变且中心对齐。
  const tw = Math.round(box.w)
  const th = Math.round(box.h)
  const srcAR = result.width / result.height
  const dstAR = tw / th
  if (Math.abs(srcAR - dstAR) > 0.01) {
    // 等比放大到刚好覆盖目标框
    let dw = tw
    let dh = th
    if (srcAR > dstAR) {
      dw = Math.round(th * srcAR)   // 太宽，左右裁
    } else {
      dh = Math.round(tw / srcAR)   // 太高，上下裁
    }
    const dx = Math.round((tw - dw) / 2)
    const dy = Math.round((th - dh) / 2)
    ctx.drawImage(result, 0, 0, result.width, result.height, dx, dy, dw, dh)
  } else {
    ctx.drawImage(result, 0, 0, result.width, result.height, 0, 0, tw, th)
  }

  // 2. 取出结果像素
  const w = tw
  const h = th
  const imgData = ctx.getImageData(0, 0, w, h)
  const px = imgData.data

  // 3. 可选颜色匹配：把结果的均值/标准差对齐到原图同区域
  if (colorMatch) {
    const origCanvas = new OffscreenCanvas(w, h)
    const octx = origCanvas.getContext('2d')!
    octx.drawImage(source, box.x, box.y, w, h, 0, 0, w, h)
    const orig = octx.getImageData(0, 0, w, h).data
    matchColor(px, orig, w, h)
  }

  // 4. 从全图蒙版裁出本区域，并羽化
  const sub = new Uint8ClampedArray(w * h)
  const bx = Math.round(box.x)
  const by = Math.round(box.y)
  for (let y = 0; y < h; y++) {
    const sy = by + y
    if (sy < 0 || sy >= mask.height) continue
    for (let x = 0; x < w; x++) {
      const sx = bx + x
      if (sx < 0 || sx >= mask.width) continue
      sub[y * w + x] = mask.data[sy * mask.width + sx]
    }
  }
  const feathered = feather({ data: sub, width: w, height: h }, featherRadius)

  // 5. 用羽化蒙版作为 alpha，乘到结果上
  for (let i = 0, m = 0; i < px.length; i += 4, m++) {
    px[i + 3] = Math.round(px[i + 3] * (feathered.data[m] / 255))
  }
  ctx.putImageData(imgData, 0, 0)

  return createImageBitmap(canvas)
}

/** 简单的均值/标准差颜色匹配（Reinhard 风格） */
function matchColor(target: Uint8ClampedArray, reference: Uint8ClampedArray, w: number, h: number) {
  const n = w * h
  const tMean = [0, 0, 0]
  const rMean = [0, 0, 0]

  for (let i = 0, m = 0; m < n; i += 4, m++) {
    // 只统计不透明区域，避免把透明像素算进均值
    if (reference[i + 3] < 8) continue
    tMean[0] += target[i]; tMean[1] += target[i + 1]; tMean[2] += target[i + 2]
    rMean[0] += reference[i]; rMean[1] += reference[i + 1]; rMean[2] += reference[i + 2]
  }
  for (let c = 0; c < 3; c++) { tMean[c] /= n; rMean[c] /= n }

  const tVar = [0, 0, 0], rVar = [0, 0, 0]
  for (let i = 0, m = 0; m < n; i += 4, m++) {
    if (reference[i + 3] < 8) continue
    for (let c = 0; c < 3; c++) {
      tVar[c] += (target[i + c] - tMean[c]) ** 2
      rVar[c] += (reference[i + c] - rMean[c]) ** 2
    }
  }
  const gain = [1, 1, 1]
  for (let c = 0; c < 3; c++) {
    const ts = Math.sqrt(tVar[c] / n) || 1
    const rs = Math.sqrt(rVar[c] / n) || 1
    gain[c] = Math.max(0.5, Math.min(2, rs / ts))
  }

  // 半强度混合，避免过度校正导致色彩失真
  const blend = 0.5
  for (let i = 0; i < target.length; i += 4) {
    if (target[i + 3] < 8) continue
    for (let c = 0; c < 3; c++) {
      const matched = (target[i + c] - tMean[c]) * gain[c] + rMean[c]
      target[i + c] = Math.max(0, Math.min(255, target[i + c] * (1 - blend) + matched * blend))
    }
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('读取图片数据失败'))
    fr.readAsDataURL(blob)
  })
}

/** 换算选区 bounds（供 contextBounds 使用） */
export function selectionBounds(mask: MaskBuffer) {
  return computeBounds(mask.data, mask.width, mask.height)
}
