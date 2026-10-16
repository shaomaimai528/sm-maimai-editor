/** 编辑器全局状态 */

import { create } from 'zustand'
import type { Doc, Layer, AdjustParams } from '../core/doc/types'
import { History } from '../core/doc/history'
import type { MaskBuffer } from '../core/selection/mask'
import { activeLayer as findActive, insertLayerAbove, removeLayer as removeLayerOp, updateLayer as updateLayerOp, moveLayer as moveLayerOp } from '../core/doc/document'

export type ToolId = 'move' | 'lasso' | 'wand' | 'brush' | 'erase' | 'adjust'

interface EditorState {
  doc: Doc | null
  /** 全分辨率源图，贴回时从这里裁切 */
  sourceBitmap: ImageBitmap | null

  history: History
  tool: ToolId
  selection: MaskBuffer | null

  zoom: number
  panX: number
  panY: number

  /** 预览用的原图对照 */
  showOriginal: boolean

  // ---- actions ----
  setDoc: (doc: Doc | null, source?: ImageBitmap | null) => void
  setTool: (t: ToolId) => void
  setSelection: (s: MaskBuffer | null) => void
  /** 写入一条选区历史，让撤销能回退选区操作 */
  pushSelectionHistory: (label: string, next: MaskBuffer | null) => void

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
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  sourceBitmap: null,
  history: new History(50),
  tool: 'lasso',
  selection: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  showOriginal: false,

  setDoc: (doc, source = null) => {
    // 换文档时清空代理图与选区，历史重新开始
    set({
      doc,
      sourceBitmap: source ?? get().sourceBitmap,
      selection: null,
      history: new History(50),
    })
  },
  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),

  pushSelectionHistory: (label, next) => {
    const { selection, history } = get()
    // 选区历史单独记录，形状用同一套 History 结构承载
    history.push({
      label,
      before: { selection } as unknown as Doc,
      after: { selection: next } as unknown as Doc,
    })
    set({ selection: next })
  },

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
    const prev = history.undo(doc) as any
    if (!prev) return
    // 选区历史只带 selection 字段，文档历史带 layers
    if (prev.selection !== undefined && !prev.layers) {
      set({ selection: prev.selection })
    } else {
      set({ doc: prev as Doc })
    }
  },

  redo: () => {
    const { doc, history } = get()
    if (!doc) return
    const next = history.redo(doc) as any
    if (!next) return
    if (next.selection !== undefined && !next.layers) {
      set({ selection: next.selection })
    } else {
      set({ doc: next as Doc })
    }
  },

  setView: (v) => set((s) => ({ zoom: v.zoom ?? s.zoom, panX: v.panX ?? s.panX, panY: v.panY ?? s.panY })),
  setShowOriginal: (showOriginal) => set({ showOriginal }),
}))

/** 便捷选择器 */
export function useActiveLayer(): Layer | undefined {
  const doc = useEditor((s) => s.doc)
  return doc ? findActive(doc) : undefined
}
