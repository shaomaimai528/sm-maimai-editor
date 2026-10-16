/** 图片导入：处理 EXIF 方向与超大图降采样 */

const MAX_PIXELS = 24_000_000 // 24MP，超过先降采样，防 iOS 崩内存

export interface LoadedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  /** 是否因超限被降采样 */
  downsampled: boolean
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
  // createImageBitmap 默认按 EXIF 方向解码（imageOrientation: 'from-image'）
  // 这比手写 EXIF 解析可靠得多
  let bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  const pixels = bitmap.width * bitmap.height
  if (pixels <= MAX_PIXELS) {
    return { bitmap, width: bitmap.width, height: bitmap.height, downsampled: false }
  }

  const scale = Math.sqrt(MAX_PIXELS / pixels)
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  bitmap = await createImageBitmap(canvas)
  return { bitmap, width: w, height: h, downsampled: true }
}


