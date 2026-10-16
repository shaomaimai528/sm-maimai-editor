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

/** 合成结果异常时抛出，由调用方决定是重试还是提示用户 */
export class RenderError extends Error {
  constructor(message: string, public readonly layerId?: string) {
    super(message)
    this.name = 'RenderError'
  }
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
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const canvas = new OffscreenCanvas(w, h)
  // 调整层与蒙版都要反复 getImageData / putImageData，
  // 不声明 willReadFrequently 时浏览器默认走 GPU 回读，手机上明显掉帧
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  for (const layer of doc.layers) {
    if (opts.skipHidden !== false && !layer.visible) continue
    await renderLayer(ctx, layer, w, h)
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
  if (layer.kind === 'adjustment') {
    // params 缺失就当作"没有任何调整"，直接跳过 ——
    // 旧实现会拿 undefined 去算 LUT，整幅图变成 0，表现就是"一拉滑杆就黑屏"
    if (!layer.params) return
    const CHUNK = 512
    try {
      for (let y0 = 0; y0 < height; y0 += CHUNK) {
        const h = Math.min(CHUNK, height - y0)
        const img = ctx.getImageData(0, y0, width, h)
        applyAdjust(img, layer.params)
        ctx.putImageData(img, 0, y0)
      }
    } catch (e) {
      // 处理失败就跳过这一层，保留已经画好的底层像素。
      // 宁可这一层不生效，也不能让整张画布变黑 ——
      // 用户看到黑屏时完全无从判断是哪一步出的问题。调用方会把失败如实提示出来。
      console.warn('[render] 调整层处理失败，已跳过', layer.id, e)
      throw new RenderError('调整层处理失败', layer.id)
    }
    return
  }

  const bmp = layer.source?.bitmap
  if (!bmp) return

  // 像素层：先画到临时画布，套用蒙版后再合成
  const tmp = new OffscreenCanvas(width, height)
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!
  tctx.imageSmoothingEnabled = true
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, width, height)

  if (layer.mask?.data) {
    // 同样分块，控制单次内存占用
    const CHUNK = 512
    const mw = layer.mask.width
    const mh = layer.mask.height
    for (let y0 = 0; y0 < height; y0 += CHUNK) {
      const h = Math.min(CHUNK, height - y0)
      const img = tctx.getImageData(0, y0, width, h)
      const d = img.data
      for (let y = 0; y < h; y++) {
        const my = Math.min(mh - 1, Math.floor(((y0 + y) / height) * mh))
        for (let x = 0; x < width; x++) {
          const mx = Math.min(mw - 1, Math.floor((x / width) * mw))
          const a = layer.mask.data[my * mw + mx]
          const idx = (y * width + x) * 4 + 3
          d[idx] = Math.round(d[idx] * (a / 255))
        }
      }
      tctx.putImageData(img, 0, y0)
    }
  }

  // 合成参数必须逐层重置：任何一次异常都不能把状态泄漏给后面的图层
  const prevAlpha = ctx.globalAlpha
  const prevOp = ctx.globalCompositeOperation
  try {
    ctx.globalAlpha = clamp01(layer.opacity)
    ctx.globalCompositeOperation = safeBlend(layer.blendMode)
    ctx.drawImage(tmp, 0, 0)
  } finally {
    ctx.globalAlpha = prevAlpha
    ctx.globalCompositeOperation = prevOp
  }
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1
}

/**
 * 混合模式白名单
 * 浏览器对不认识的值会保留上一次设置 —— 那会让后面所有图层
 * 都跟着用错模式，画面整体崩掉。这里只放行确定支持的那几个。
 */
const SAFE_BLEND: ReadonlySet<string> = new Set([
  'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
])

function safeBlend(mode: unknown): GlobalCompositeOperation {
  const m = typeof mode === 'string' ? mode : ''
  return (SAFE_BLEND.has(m) ? m : 'source-over') as GlobalCompositeOperation
}
