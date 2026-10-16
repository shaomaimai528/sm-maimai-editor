import { uid, DEFAULT_ADJUST, type Doc, type Layer, type LayerKind } from './types'

/** 创建一个空白文档 */
export function createDoc(width: number, height: number, name = '新建文档'): Doc {
  const base: Layer = {
    id: uid('layer'),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    kind: 'raster',
    source: { bitmap: null },
  }
  return {
    id: uid('doc'),
    width,
    height,
    layers: [base],
    activeLayerId: base.id,
  }
}

export function findLayer(doc: Doc, id: string): Layer | undefined {
  return doc.layers.find((l) => l.id === id)
}

export function activeLayer(doc: Doc): Layer | undefined {
  return findLayer(doc, doc.activeLayerId)
}

/** 在指定图层上方插入新图层，并设为激活 */
export function insertLayerAbove(doc: Doc, refId: string | null, layer: Layer): Doc {
  const layers = doc.layers.slice()
  const idx = refId ? layers.findIndex((l) => l.id === refId) : -1
  const at = idx >= 0 ? idx + 1 : layers.length
  layers.splice(at, 0, layer)
  return { ...doc, layers, activeLayerId: layer.id }
}

export function insertLayerTop(doc: Doc, layer: Layer): Doc {
  return { ...doc, layers: [...doc.layers, layer], activeLayerId: layer.id }
}

export function removeLayer(doc: Doc, id: string): Doc {
  if (doc.layers.length <= 1) return doc // 至少保留一层
  const layers = doc.layers.filter((l) => l.id !== id)
  const activeLayerId = doc.activeLayerId === id ? layers[layers.length - 1].id : doc.activeLayerId
  return { ...doc, layers, activeLayerId }
}

export function updateLayer(doc: Doc, id: string, patch: Partial<Layer>): Doc {
  return {
    ...doc,
    layers: doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  }
}

export function moveLayer(doc: Doc, id: string, delta: number): Doc {
  const layers = doc.layers.slice()
  const i = layers.findIndex((l) => l.id === id)
  if (i < 0) return doc
  const j = Math.min(layers.length - 1, Math.max(0, i + delta))
  if (i === j) return doc
  const [item] = layers.splice(i, 1)
  layers.splice(j, 0, item)
  return { ...doc, layers }
}

/** 创建调整层（非破坏性） */
export function createAdjustLayer(name: string): Layer {
  return {
    id: uid('layer'),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    kind: 'adjustment',
    params: { ...DEFAULT_ADJUST },
  }
}

export function createLayer(kind: LayerKind, name: string, bitmap: ImageBitmap | null = null): Layer {
  return {
    id: uid('layer'),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    kind,
    source: { bitmap },
  }
}
