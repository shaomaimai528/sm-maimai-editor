/**
 * 文档数据模型 —— 整个应用的地基
 *
 * 三条硬规则：
 *  1. 绝不原地改像素做破坏性编辑，一切操作都是参数，渲染时才合成
 *  2. AI 结果永远作为新图层插入，不覆盖原像素，用户可随时隐藏/删除
 *  3. 蒙版是图层属性，与图层同生命周期、同进历史栈
 */

/** 调整参数（非破坏性，全部可反复修改） */
export interface AdjustParams {
  /** 曝光，-100..100 */
  exposure: number
  /** 对比度，-100..100 */
  contrast: number
  /** 饱和度，-100..100 */
  saturation: number
  /** 色温，-100..100（负冷正暖） */
  temperature: number
  /** 色调，-100..100（负绿正洋红） */
  tint: number
  /** 曲线控制点，归一化 0..1 */
  curve?: Array<[number, number]>
}

export const DEFAULT_ADJUST: AdjustParams = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
}

/** 图层蒙版：灰度，白=显示，黑=隐藏 */
export interface LayerMask {
  /** 与图层源等尺寸的灰度 alpha，0..255；null 表示全显示 */
  data: Uint8ClampedArray | null
  width: number
  height: number
}

export type LayerKind = 'raster' | 'adjustment' | 'ai-result'

/** AI 结果的来源信息，用于追溯与重放 */
export interface AIMeta {
  channelId: string
  channelLabel: string
  model: string
  prompt: string
  taskId?: string
  /** 生成时刻，用于界面排序展示 */
  createdAt: number
}

export interface Layer {
  id: string
  name: string
  visible: boolean
  /** 0..1 */
  opacity: number
  blendMode: GlobalCompositeOperation
  kind: LayerKind
  /** 源像素，仅 raster / ai-result 有 */
  source?: {
    bitmap: ImageBitmap | null
    /** 持久化时用的 key，从 IndexedDB 取回 */
    blobKey?: string
  }
  mask?: LayerMask
  params?: AdjustParams
  aiMeta?: AIMeta
}

export interface Doc {
  id: string
  /** 原图尺寸 */
  width: number
  height: number
  layers: Layer[]
  activeLayerId: string
}

/** 选区，用与源图等尺寸的灰度图表示（白=选中） */
export interface Selection {
  data: Uint8ClampedArray
  width: number
  height: number
  /** 选区包围盒，用于裁切与贴回 */
  bounds: { x: number; y: number; w: number; h: number }
}

let seq = 0
export function uid(prefix = 'id'): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`
}

/** 从灰度 alpha 数组计算包围盒 */
export function computeBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 8
): { x: number; y: number; w: number; h: number } {
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (data[row + x] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}
