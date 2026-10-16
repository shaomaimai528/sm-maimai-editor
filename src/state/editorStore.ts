/** 编辑器全局状态 */

import { create } from 'zustand'
import type { Doc, Layer, AdjustParams } from '../core/doc/types'
import { uid } from '../core/doc/types'
import { History } from '../core/doc/history'
import type { MaskBuffer } from '../core/selection/mask'
import { activeLayer as findActive, insertLayerAbove, removeLayer as removeLayerOp, updateLayer as updateLayerOp, moveLayer as moveLayerOp } from '../core/doc/document'
import { DEFAULT_BRUSH, type BrushSettings } from '../core/selection/brush'

export type ToolId = 'move' | 'rect' | 'lasso' | 'wand' | 'brush' | 'erase' | 'adjust'

/** 笔刷当前作用对象：选区，还是某个图层的蒙版 */
export type BrushTarget = 'selection' | 'layer-mask'

interface EditorState {
  doc: Doc | null
  /** 全分辨率源图，贴回时从这里裁切 */
  sourceBitmap: ImageBitmap | null

  history: History
  /**
   * 历史版本号
   *
   * History 是个可变对象，push/undo/redo 都只改它内部的数组，
   * 不产生新的引用 —— zustand 因此完全察觉不到变化，
   * 撤销/重做按钮的 disabled 状态就会一直停在初始值（永远可点或永远灰）。
   * 每次改动历史都把这个计数 +1，让依赖它的组件能正确刷新。
   */
  historyRevision: number
  tool: ToolId
  selection: MaskBuffer | null

  zoom: number
  panX: number
  panY: number

  /** 预览用的原图对照 */
  showOriginal: boolean

  /**
   * 底部被非遮挡面板占掉的高度
   * 图层/调整面板停靠时把它报上来，画布据此把图片往上挪，
   * 这样"看到图"和"调到参数"能同时成立。
   */
  chrome: { bottomInset: number }

  /** 笔刷参数（大小/硬度/流量/不透明度），与 PS 的手感对齐 */
  brush: BrushSettings
  /** 笔刷涂抹到哪里 */
  brushTarget: BrushTarget

  /**
   * 矩形框选的宽高比锁
   * null＝自由框选；1＝正方形；16/9 等按数值给出。
   * 锁上之后 AI 收到的选区宽高比也就稳定了，出图不容易被拉伸裁切。
   */
  aspectLock: number | null

  /** 拖框过程中实时的选区尺寸，用于在屏幕上显示像素大小 */
  liveRect: { x: number; y: number; w: number; h: number } | null

  // ---- actions ----
  setDoc: (doc: Doc | null, source?: ImageBitmap | null) => void
  /** 仅替换全分辨率基准图，不影响文档与撤销历史 */
  setSourceBitmap: (source: ImageBitmap | null) => void
  setTool: (t: ToolId) => void
  setSelection: (s: MaskBuffer | null) => void
  /** 写入一条选区历史，让撤销能回退选区操作 */
  pushSelectionHistory: (label: string, next: MaskBuffer | null) => void

  /** 带历史记录的文档变更 */
  commit: (label: string, next: Doc) => void
  /** 不带历史的临时变更（如拖动中） */
  patch: (next: Doc) => void

  setLayerParam: (layerId: string, patch: Partial<Layer>) => void
  /** 切换当前图层（不记历史） */
  selectLayer: (layerId: string) => void
  setAdjust: (layerId: string, patch: Partial<AdjustParams>) => void
  addLayer: (layer: Layer) => void
  deleteLayer: (id: string) => void
  moveLayer: (id: string, delta: number) => void

  undo: () => void
  redo: () => void

  setBrush: (patch: Partial<BrushSettings>) => void
  setBrushTarget: (t: BrushTarget) => void
  setAspectLock: (v: number | null) => void
  /** 拖动中的矩形预览，松手置空 */
  setLiveRect: (r: { x: number; y: number; w: number; h: number } | null) => void
  /**
   * 给图层蒙版涂抹
   * 蒙版不存在时按需创建：进入「图层蒙版」模式即视为全白（全显示），
   * 与 PS 里「添加蒙版后默认全显」一致，用户涂黑才是遮住。
   */
  paintLayerMask: (layerId: string, next: MaskBuffer | null) => void
  /** 给指定图层挂上/取下蒙版 */
  setLayerMask: (layerId: string, mask: MaskBuffer | undefined) => void
  setLayerOpacity: (layerId: string, opacity: number) => void
  setLayerBlend: (layerId: string, blendMode: Layer['blendMode']) => void
  renameLayer: (layerId: string, name: string) => void
  duplicateLayer: (layerId: string) => void

  /** 非遮挡面板上报自己占用的底部高度 */
  setBottomInset: (px: number) => void

  setView: (v: { zoom?: number; panX?: number; panY?: number }) => void
  /** 围绕画布上某点缩放，并同步补偿位移 —— 必须原子提交，否则缩放会跑偏 */
  zoomAt: (factor: number, cx: number, cy: number, viewW: number, viewH: number) => void
  setShowOriginal: (v: boolean) => void
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  sourceBitmap: null,
  history: new History(50),
  historyRevision: 0,
  tool: 'lasso',
  selection: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  showOriginal: false,
  chrome: { bottomInset: 0 },
  brush: { ...DEFAULT_BRUSH },
  brushTarget: 'selection',
  aspectLock: null,
  liveRect: null,

  setDoc: (doc, source = null) => {
    // 换文档时清空代理图与选区，历史重新开始
    set((s) => ({
      doc,
      sourceBitmap: source ?? get().sourceBitmap,
      selection: null,
      history: new History(50),
      historyRevision: s.historyRevision + 1,
    }))
  },

  /**
   * 只同步基准位图，不动文档与历史
   *
   * 换画布尺寸时既要用 commit 记一步可撤销的操作，
   * 又要把新的全分辨率基准图交给贴回逻辑。
   * 若为了传基准图去调 setDoc，它会顺手清空历史 ——
   * 刚提交的那一步立刻消失，用户按撤销毫无反应。
   */
  setSourceBitmap: (source) => set({ sourceBitmap: source }),
  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),

  pushSelectionHistory: (label, next) => {
    const { selection, history, historyRevision } = get()
    // 选区历史单独记录，形状用同一套 History 结构承载
    history.push({
      label,
      before: { selection } as unknown as Doc,
      after: { selection: next } as unknown as Doc,
    })
    set({ selection: next, historyRevision: historyRevision + 1 })
  },

  commit: (label, next) => {
    const { doc, history, historyRevision } = get()
    if (!doc) return
    // 只在真正变化时记历史
    if (doc === next) return
    history.push({ label, before: doc, after: next })
    set({ doc: next, historyRevision: historyRevision + 1 })
  },

  patch: (next) => {
    const { doc, history, historyRevision } = get()
    if (!doc) return
    /**
     * 连续拖动要合并成一条历史，否则拖一次滑杆产生几十条记录，
     * 用户按一次撤销只退回一个像素级变化，等于撤销废掉。
     *
     * 合并条件用「上一条是不是连续的参数调整」判断，
     * 而 patch 正是为拖动这类高频变更准备的，调用它就意味着"还在同一次调整里"。
     */
    const past = (history as unknown as { past: Array<{ label: string; after: Doc }> }).past
    const last = past?.[past.length - 1]
    if (last && last.label === '调整参数') {
      last.after = next
      // 内容变了但历史条数没变，仍要触发一次刷新
      set({ doc: next, historyRevision: historyRevision + 1 })
    } else {
      history.push({ label: '调整参数', before: doc, after: next })
      set({ doc: next, historyRevision: historyRevision + 1 })
    }
  },

  setLayerParam: (layerId, p) => {
    const { doc, commit } = get()
    if (!doc) return
    commit('修改图层', updateLayerOp(doc, layerId, p))
  },

  /**
   * 选中图层
   *
   * 走 patch 而不是 commit：换图层是"我现在在看哪一层"，
   * 属于界面状态而非对图的操作。记进历史会让撤销变得莫名其妙 ——
   * 用户按撤销本意是后悔上一步修改，结果只是切回了上一层的选择。
   */
  selectLayer: (layerId) => {
    const { doc, patch } = get()
    if (!doc || doc.activeLayerId === layerId) return
    patch({ ...doc, activeLayerId: layerId })
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

  /**
   * 撤销 / 重做
   *
   * 文档变更与选区变更共用同一条历史栈，靠"有没有 layers 字段"区分。
   * 这样两类操作严格按发生顺序回退 ——
   * 若各用一条栈，用户会看到"撤销跳过了我刚做的选区操作"这种怪现象。
   */
  undo: () => {
    const { doc, history, historyRevision } = get()
    if (!doc) return
    const prev = history.undo(doc) as unknown as (Doc & { selection?: MaskBuffer | null }) | null
    if (!prev) return
    if (!prev.layers) {
      set({ selection: prev.selection ?? null, historyRevision: historyRevision + 1 })
    } else {
      set({ doc: prev as Doc, historyRevision: historyRevision + 1 })
    }
  },

  redo: () => {
    const { doc, history, historyRevision } = get()
    if (!doc) return
    const next = history.redo(doc) as unknown as (Doc & { selection?: MaskBuffer | null }) | null
    if (!next) return
    if (!next.layers) {
      set({ selection: next.selection ?? null, historyRevision: historyRevision + 1 })
    } else {
      set({ doc: next as Doc, historyRevision: historyRevision + 1 })
    }
  },

  setView: (v) => set((s) => ({ zoom: v.zoom ?? s.zoom, panX: v.panX ?? s.panX, panY: v.panY ?? s.panY })),

  /**
   * 围绕指定点缩放
   * 设缩放前该点在图片上的位置为 P，缩放后要保持 P 停在手指下，
   * 位移需补偿 (锚点 - 画布中心) * (1 - factor)
   */
  zoomAt: (factor, cx, cy, viewW, viewH) => set((s) => {
    const next = Math.max(0.25, Math.min(12, s.zoom * factor))
    // 实际生效的比例可能被边界截断，要用它算补偿，否则会漂移
    const real = next / s.zoom
    const ox = cx - viewW / 2
    const oy = cy - viewH / 2
    return {
      zoom: next,
      panX: s.panX + ox * (1 - real),
      panY: s.panY + oy * (1 - real),
    }
  }),
  setShowOriginal: (showOriginal) => set({ showOriginal }),

  // 只在数值真的变了才 set，避免面板每帧重报引起画布抖动
  setBottomInset: (px) => set((s) => (
    s.chrome.bottomInset === px ? s : { chrome: { ...s.chrome, bottomInset: px } }
  )),

  setBrush: (patch) => set((s) => ({ brush: { ...s.brush, ...patch } })),
  setBrushTarget: (brushTarget) => set({ brushTarget }),
  setAspectLock: (aspectLock) => set({ aspectLock }),
  setLiveRect: (liveRect) => set({ liveRect }),

  paintLayerMask: (layerId, next) => {
    const { doc, commit } = get()
    if (!doc) return
    commit('涂抹图层蒙版', updateLayerOp(doc, layerId, {
      mask: next ? { data: next.data, width: next.width, height: next.height } : undefined,
    }))
  },

  setLayerMask: (layerId, mask) => {
    const { doc, commit } = get()
    if (!doc) return
    commit(mask ? '添加蒙版' : '移除蒙版', updateLayerOp(doc, layerId, { mask }))
  },

  setLayerOpacity: (layerId, opacity) => {
    const { doc, patch } = get()
    if (!doc) return
    const v = Math.max(0, Math.min(1, opacity))
    patch(updateLayerOp(doc, layerId, { opacity: v }))
  },

  setLayerBlend: (layerId, blendMode) => {
    const { doc, patch } = get()
    if (!doc) return
    patch(updateLayerOp(doc, layerId, { blendMode }))
  },

  renameLayer: (layerId, name) => {
    const { doc, commit } = get()
    if (!doc) return
    const clean = name.trim()
    if (!clean) return
    commit('重命名图层', updateLayerOp(doc, layerId, { name: clean }))
  },

  duplicateLayer: (layerId) => {
    const { doc, commit } = get()
    if (!doc) return
    const src = doc.layers.find((l) => l.id === layerId)
    if (!src) return
    // 蒙版数据要深拷贝，否则两个图层会共享同一块内存
    const copy: Layer = {
      ...src,
      id: uid('layer'),
      name: `${src.name} 副本`,
      mask: src.mask?.data
        ? { ...src.mask, data: new Uint8ClampedArray(src.mask.data) }
        : src.mask,
    }
    commit('复制图层', insertLayerAbove(doc, layerId, copy))
  },
}))

/** 便捷选择器 */
export function useActiveLayer(): Layer | undefined {
  const doc = useEditor((s) => s.doc)
  return doc ? findActive(doc) : undefined
}
