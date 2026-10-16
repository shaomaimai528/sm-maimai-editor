/**
 * 非破坏性渲染管线
 *
 * 屏幕只渲染代理图（长边 1500），参数调整在代理图上实时预览；
 * 导出时才按原图全分辨率重放一遍操作链。
 */

import type { Doc, Layer } from '../doc/types'
import { applyAdjust } from '../adjust/ops'

export const PROXY_MAX_EDGE = 1500

export interface ProxyInfo {
  bitmap: ImageBitmap
  scale: number
  width: number
  height: number
}

/** 生成代理图：小到足以实时预览，大到肉眼无差 */
export async function makeProxy(source: ImageBitmap, maxEdge = PROXY_MAX_EDGE): Promise<ProxyInfo> {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height))
  if (scale >= 1) {
    return { bitmap: source, scale: 1, width: source.width, height: source.height }
  }
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return { bitmap: await createImageBitmap(canvas), scale, width: w, height: h }
}

/**
 * 合成整个文档到目标画布
 * @param target 目标尺寸（代理或原始）
 */
export async function renderDoc(
  doc: Doc,
  width: number,
  height: number,
  opts: { skipHidden?: boolean } = {}
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!

  for (const layer of doc.layers) {
    if (opts.skipHidden !== false && !layer.visible) continue
    await renderLayer(ctx, layer, width, height)
  }

  return createImageBitmap(canvas)
}

async function renderLayer(
  ctx: OffscreenCanvasRenderingContext2D,
  layer: Layer,
  width: number,
  height: number
) {
  // 调整层：对当前已合成内容做整体调整
  if (layer.kind === 'adjustment' && layer.params) {
    const img = ctx.getImageData(0, 0, width, height)
    applyAdjust(img, layer.params)
    ctx.putImageData(img, 0, 0)
    return
  }

  const bmp = layer.source?.bitmap
  if (!bmp) return

  // 像素层：先画到临时画布，套用蒙版后再合成
  const tmp = new OffscreenCanvas(width, height)
  const tctx = tmp.getContext('2d')!
  tctx.imageSmoothingEnabled = true
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(bmp, 0, 0, width, height)

  if (layer.mask?.data) {
    const img = tctx.getImageData(0, 0, width, height)
    const d = img.data
    const mw = layer.mask.width
    const mh = layer.mask.height
    for (let y = 0; y < height; y++) {
      const my = Math.min(mh - 1, Math.floor((y / height) * mh))
      for (let x = 0; x < width; x++) {
        const mx = Math.min(mw - 1, Math.floor((x / width) * mw))
        const a = layer.mask.data[my * mw + mx]
        d[(y * width + x) * 4 + 3] = Math.round(d[(y * width + x) * 4 + 3] * (a / 255))
      }
    }
    tctx.putImageData(img, 0, 0)
  }

  ctx.globalAlpha = layer.opacity
  ctx.globalCompositeOperation = layer.blendMode
  ctx.drawImage(tmp, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}
