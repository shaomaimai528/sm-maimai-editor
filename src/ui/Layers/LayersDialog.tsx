/** 图层面板：增删、显隐、排序、不透明度 */
import { Eye, EyeOff, Trash2, ChevronUp, ChevronDown, Plus } from 'lucide-react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { useEditor } from '../../state/editorStore'
import { createLayer } from '../../core/doc/document'
import './LayersDialog.css'

interface Props { open: boolean; onClose: () => void }

export function LayersDialog({ open, onClose }: Props) {
  const doc = useEditor((s) => s.doc)
  const commit = useEditor((s) => s.commit)
  const deleteLayer = useEditor((s) => s.deleteLayer)
  const moveLayer = useEditor((s) => s.moveLayer)

  if (!doc) return null

  return (
    <Sheet open={open} onClose={onClose} title="图层" maxHeight="70vh">
      <div className="layers">
        <div className="layers-list">
          {/* 倒序显示：上层在上 */}
          {[...doc.layers].reverse().map((layer) => {
            const active = layer.id === doc.activeLayerId
            return (
              <div key={layer.id} className="layer-row" data-active={active}>
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
                  className="layer-name"
                  onClick={() => commit('选择图层', { ...doc, activeLayerId: layer.id })}
                >
                  <span className="layer-kind" data-kind={layer.kind} />
                  {layer.name}
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
        </div>
      </div>
    </Sheet>
  )
}
