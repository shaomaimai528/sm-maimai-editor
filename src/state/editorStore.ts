/** 编辑器全局状态 */

import { create } from 'zustand'
import type { Doc, Layer, AdjustParams } from '../core/doc/types'
import { History } from '../core/doc/history'
import type { MaskBuffer } from '../core/selection/mask'
import { createMask } from '../core/selection/mask'
import type { ProxyInfo } from '../core/render/pipeline'
import { activeLayer as findActive, insertLayerAbove, removeLayer as removeLayerOp, updateLayer as updateLayerOp, moveLayer as moveLayerOp } from '../core/doc/document'

export type ToolId = 'move' | 'lasso' | 'wand' | 'brush' | 'erase' | 'adjust'

export interface AIJob {
  id: string
  status: 'running' | 'done' | 'failed'
  phase: string
  elapsedMs: number
  error?: string
}

interface EditorState {
  doc: Doc | null
  /** 全分辨率源图，贴回时从这里裁切 */
  sourceBitmap: ImageBitmap | null
  proxy: ProxyInfo | null

  history: History
  tool: ToolId
  selection: MaskBuffer | null

  /** 蒙版笔刷的目标层 id；null 表示编辑选区本身 */
  maskTargetLayerId: string | null

  zoom: number
  panX: number
  panY: number

  /** 预览用的原图对照 */
  showOriginal: boolean

  aiJob: AIJob | null

  // ---- actions ----
  setDoc: (doc: Doc | null, source?: ImageBitmap | null) => void
  setProxy: (p: ProxyInfo | null) => void
  setTool: (t: ToolId) => void
  setSelection: (s: MaskBuffer | null) => void
  setMaskTarget: (id: string | null) => void

  /** 带历史记录的文档变更 */
  commit: (label: string, next: Doc) => void
  /** 不带历史的临时变更（如拖动中） */
  patch: (next: Doc) => void

  setLayerParam: (layerId: string, patch: Partial<Layer>) => void
  setAdjust: (layerId: string, patch: Partial<AdjustParams>) => void
  addLayer: (layer: Layer) => void
  deleteLayer: (id: string) => void
  moveLayer: (id: string, delta: number) => void

  undo: () => void
  redo: () => void

  setView: (v: { zoom?: number; panX?: number; panY?: number }) => void
  setShowOriginal: (v: boolean) => void
  setAIJob: (j: AIJob | null) => void
  patchAIJob: (p: Partial<AIJob>) => void
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  sourceBitmap: null,
  proxy: null,
  history: new History(50),
  tool: 'lasso',
  selection: null,
  maskTargetLayerId: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  showOriginal: false,
  aiJob: null,

  setDoc: (doc, source = null) => {
    const proxy = doc ? createMask(1, 1) && null : null
    set({ doc, sourceBitmap: source ?? get().sourceBitmap, proxy, selection: null, history: new History(50) })
  },
  setProxy: (proxy) => set({ proxy }),
  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),
  setMaskTarget: (maskTargetLayerId) => set({ maskTargetLayerId }),

  commit: (label, next) => {
    const { doc, history } = get()
    if (!doc) return
    // 只在真正变化时记历史
    if (doc === next) return
    history.push({ label, before: doc, after: next })
    set({ doc: next })
  },

  patch: (next) => {
    const { doc, history } = get()
    if (!doc) return
    // 合并进最近一条历史，避免拖动滑杆产生几十条记录
    const last = (history as any).past?.[(history as any).past.length - 1]
    if (last && last.label.startsWith('调整')) {
      last.after = next
    } else {
      history.push({ label: '调整参数', before: doc, after: next })
    }
    set({ doc: next })
  },

  setLayerParam: (layerId, p) => {
    const { doc, commit } = get()
    if (!doc) return
    commit('修改图层', updateLayerOp(doc, layerId, p))
  },

  setAdjust: (layerId, p) => {
    const { doc, patch } = get()
    if (!doc) return
    const layer = doc.layers.find((l) => l.id === layerId)
    if (!layer) return
    patch(updateLayerOp(doc, layerId, { params: { ...(layer.params || {} as AdjustParams), ...p } as AdjustParams }))
  },

  addLayer: (layer) => {
    const { doc, commit } = get()
    if (!doc) return
    commit('新增图层', insertLayerAbove(doc, doc.activeLayerId, layer))
  },

  deleteLayer: (id) => {
    const { doc, commit } = get()
    if (!doc) return
    commit('删除图层', removeLayerOp(doc, id))
  },

  moveLayer: (id, delta) => {
    const { doc, commit } = get()
    if (!doc) return
    commit('调整层级', moveLayerOp(doc, id, delta))
  },

  undo: () => {
    const { doc, history } = get()
    if (!doc) return
    const prev = history.undo(doc)
    if (prev) set({ doc: prev })
  },

  redo: () => {
    const { doc, history } = get()
    if (!doc) return
    const next = history.redo(doc)
    if (next) set({ doc: next })
  },

  setView: (v) => set((s) => ({ zoom: v.zoom ?? s.zoom, panX: v.panX ?? s.panX, panY: v.panY ?? s.panY })),
  setShowOriginal: (showOriginal) => set({ showOriginal }),
  setAIJob: (aiJob) => set({ aiJob }),
  patchAIJob: (p) => set((s) => ({ aiJob: s.aiJob ? { ...s.aiJob, ...p } : null })),
}))

/** 便捷选择器 */
export function useActiveLayer(): Layer | undefined {
  const doc = useEditor((s) => s.doc)
  return doc ? findActive(doc) : undefined
}
