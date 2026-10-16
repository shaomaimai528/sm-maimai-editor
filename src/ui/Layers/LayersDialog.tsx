/**
 * 图层面板
 *
 * 支持：选中、显隐、排序、删除、复制、重命名、
 *      不透明度、混合模式、蒙版添加与涂抹入口、缩略图预览
 */
import { useState } from 'react'
import {
  Eye, EyeOff, Trash2, ChevronUp, ChevronDown, Plus,
  Copy, CircleDashed, Brush, PencilLine, Check, X,
} from 'lucide-react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Slider } from '../primitives/Slider'
import { useEditor } from '../../state/editorStore'
import { createLayer } from '../../core/doc/document'
import { createMask } from '../../core/selection/mask'
import { useComposedBitmap } from '../Canvas/useComposedBitmap'
import { LayerThumb } from './LayerThumb'
import type { Layer } from '../../core/doc/types'
import './LayersDialog.css'

interface Props { open: boolean; onClose: () => void }

/** 常用的几种混合模式，够用且不造成选择困难 */
const BLEND_MODES: Array<{ value: Layer['blendMode']; label: string }> = [
  { value: 'source-over', label: '正常' },
  { value: 'multiply', label: '正片叠底' },
  { value: 'screen', label: '滤色' },
  { value: 'overlay', label: '叠加' },
  { value: 'soft-light', label: '柔光' },
  { value: 'lighten', label: '变亮' },
  { value: 'darken', label: '变暗' },
  { value: 'color-burn', label: '颜色加深' },
  { value: 'difference', label: '差值' },
]

export function LayersDialog({ open, onClose }: Props) {
  const doc = useEditor((s) => s.doc)
  const commit = useEditor((s) => s.commit)
  const deleteLayer = useEditor((s) => s.deleteLayer)
  const moveLayer = useEditor((s) => s.moveLayer)
  const setLayerOpacity = useEditor((s) => s.setLayerOpacity)
  const setLayerBlend = useEditor((s) => s.setLayerBlend)
  const renameLayer = useEditor((s) => s.renameLayer)
  const duplicateLayer = useEditor((s) => s.duplicateLayer)
  const setLayerMask = useEditor((s) => s.setLayerMask)
  const setBrushTarget = useEditor((s) => s.setBrushTarget)
  const setTool = useEditor((s) => s.setTool)
  const selectLayer = useEditor((s) => s.selectLayer)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  // 调整层没有自己的像素，用合成图当缩略图底
  const composed = useComposedBitmap(open ? doc : null)

  if (!doc) return null

  const active = doc.layers.find((l) => l.id === doc.activeLayerId)

  const startRename = (layer: Layer) => {
    setEditingId(layer.id)
    setDraftName(layer.name)
  }
  const confirmRename = () => {
    if (editingId) renameLayer(editingId, draftName)
    setEditingId(null)
  }

  /** 添加蒙版并直接切到画笔，省掉"再点一次工具"的步骤 */
  const addMaskAndPaint = (layer: Layer) => {
    if (!layer.mask?.data) {
      setLayerMask(layer.id, createMask(doc.width, doc.height, 255))
    }
    selectLayer(layer.id)
    setBrushTarget('layer-mask')
    setTool('brush')
    onClose()
  }

  return (
    /* 用 peek 变体：面板只占底部一条，画布始终看得见 —— 图层操作要盯着图做 */
    <Sheet open={open} onClose={onClose} title="图层" variant="peek">
      <div className="layers">
        {/* 当前图层的快速设置 */}
        {active && (
          <div className="layers-current">
            <div className="layers-current-head">
              <span className="layers-current-name">{active.name}</span>
              <span className="layers-current-kind" data-kind={active.kind}>
                {active.kind === 'adjustment' ? '调整' : active.kind === 'ai-result' ? 'AI' : '像素'}
              </span>
            </div>

            <Slider
              label="不透明度"
              value={Math.round(active.opacity * 100)}
              min={0}
              max={100}
              onChange={(v) => setLayerOpacity(active.id, v / 100)}
              resetValue={100}
              unit="%"
            />

            <div className="layers-blend">
              <span className="layers-blend-label">混合模式</span>
              <select
                className="layers-blend-select"
                value={active.blendMode}
                onChange={(e) => setLayerBlend(active.id, e.target.value as Layer['blendMode'])}
              >
                {BLEND_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="layers-mask-row">
              <button className="layers-mask-btn" onClick={() => addMaskAndPaint(active)}>
                <Brush size={15} />
                {active.mask?.data ? '涂抹蒙版' : '加蒙版并涂抹'}
              </button>
              {active.mask?.data && (
                <button
                  className="layers-mask-btn layers-mask-del"
                  onClick={() => setLayerMask(active.id, undefined)}
                >
                  <Trash2 size={15} />
                  移除蒙版
                </button>
              )}
            </div>
          </div>
        )}

        <div className="layers-list">
          {/* 倒序显示：上层在上 */}
          {[...doc.layers].reverse().map((layer) => {
            const isActive = layer.id === doc.activeLayerId
            const masked = !!layer.mask?.data
            return (
              <div key={layer.id} className="layer-row" data-active={isActive}>
                <button
                  className="layer-vis"
                  onClick={() => commit('切换可见', {
                    ...doc,
                    layers: doc.layers.map((l) => l.id === layer.id ? { ...l, visible: !l.visible } : l),
                  })}
                  aria-label={layer.visible ? '隐藏' : '显示'}
                >
                  {layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>

                <button
                  className="layer-pick"
                  onClick={() => selectLayer(layer.id)}
                  onDoubleClick={() => startRename(layer)}
                >
                  <LayerThumb layer={layer} fallback={composed?.bitmap} size={38} />
                </button>

                <div className="layer-info">
                  {editingId === layer.id ? (
                    <div className="layer-rename">
                      <input
                        className="layer-rename-input"
                        value={draftName}
                        autoFocus
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmRename()
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                      <button className="layer-act" onClick={confirmRename} aria-label="确定">
                        <Check size={14} />
                      </button>
                      <button className="layer-act" onClick={() => setEditingId(null)} aria-label="取消">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button className="layer-name" onClick={() => startRename(layer)}>
                      {layer.name}
                      {masked && <CircleDashed size={12} className="layer-mask-dot" />}
                    </button>
                  )}
                  <div className="layer-meta">
                    {Math.round(layer.opacity * 100)}%
                    {masked && <span className="layer-meta-tag">蒙版</span>}
                  </div>
                </div>

                <div className="layer-acts">
                  <button className="layer-act" onClick={() => duplicateLayer(layer.id)} aria-label="复制">
                    <Copy size={14} />
                  </button>
                  <button className="layer-act" onClick={() => moveLayer(layer.id, 1)} aria-label="上移">
                    <ChevronUp size={15} />
                  </button>
                  <button className="layer-act" onClick={() => moveLayer(layer.id, -1)} aria-label="下移">
                    <ChevronDown size={15} />
                  </button>
                  <button
                    className="layer-act layer-del"
                    onClick={() => deleteLayer(layer.id)}
                    disabled={doc.layers.length <= 1}
                    aria-label="删除"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="layers-actions">
          <Button
            size="sm" variant="ghost" icon={<Plus size={16} />}
            onClick={() => commit('新增图层', {
              ...doc,
              layers: [...doc.layers, createLayer('raster', `图层 ${doc.layers.length + 1}`)],
            })}
          >
            新建图层
          </Button>
          <Button
            size="sm" variant="ghost" icon={<PencilLine size={16} />}
            onClick={() => {
              if (!active) return
              addMaskAndPaint(active)
            }}
          >
            涂抹蒙版
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
