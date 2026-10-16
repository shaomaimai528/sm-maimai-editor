/** 导出：按原图全分辨率重放操作链，并处理方向与格式 */

import type { Doc } from '../doc/types'

export type ExportFormat = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ExportOptions {
  format: ExportFormat
  /** JPEG/WebP 质量 0..1 */
  quality: number
}

export const DEFAULT_EXPORT: ExportOptions = {
  format: 'image/jpeg',
  quality: 0.92,
}

/** 把已有画布内容编码为 Blob */
export async function encodeCanvas(
  bitmap: ImageBitmap,
  opts: ExportOptions
): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0)
  return canvas.convertToBlob({ type: opts.format, quality: opts.quality })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 稍后释放，确保下载已开始
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function suggestFilename(doc: Doc, opts: ExportOptions): string {
  const ext = opts.format === 'image/png' ? 'png' : opts.format === 'image/webp' ? 'webp' : 'jpg'
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `ai-photo-${ts}.${ext}`
}
