/** 调整面板：非破坏性参数，实时预览 */
import { useEffect, useState } from 'react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Slider } from '../primitives/Slider'
import { useEditor } from '../../state/editorStore'
import { createAdjustLayer } from '../../core/doc/document'
import { DEFAULT_ADJUST, type AdjustParams } from '../../core/doc/types'
import './AdjustDialog.css'

interface Props { open: boolean; onClose: () => void }

export function AdjustDialog({ open, onClose }: Props) {
  const doc = useEditor((s) => s.doc)
  const commit = useEditor((s) => s.commit)
  const setAdjust = useEditor((s) => s.setAdjust)

  const active = doc?.layers.find((l) => l.id === doc.activeLayerId)
  const isAdjust = active?.kind === 'adjustment'
  const params: AdjustParams = active?.params || DEFAULT_ADJUST

  const ensureAdjustLayer = () => {
    if (!doc) return
    if (isAdjust) return
    const layer = createAdjustLayer('调整')
    commit('新增调整层', { ...doc, layers: [...doc.layers, layer], activeLayerId: layer.id })
  }

  useEffect(() => {
    if (open && doc && !isAdjust) ensureAdjustLayer()
  }, [open])

  if (!doc || !active) return null

  const items: Array<{ key: keyof AdjustParams; label: string; min: number; max: number }> = [
    { key: 'exposure', label: '曝光', min: -100, max: 100 },
    { key: 'contrast', label: '对比度', min: -100, max: 100 },
    { key: 'saturation', label: '饱和度', min: -100, max: 100 },
    { key: 'temperature', label: '色温', min: -100, max: 100 },
    { key: 'tint', label: '色调', min: -100, max: 100 },
  ]

  return (
    <Sheet open={open} onClose={onClose} title="调整" maxHeight="70vh">
      <div className="adjust">
        {items.map((it) => (
          <Slider
            key={String(it.key)}
            label={it.label}
            min={it.min}
            max={it.max}
            value={Number(params[it.key] ?? 0)}
            onChange={(v) => setAdjust(active.id, { [it.key]: v } as Partial<AdjustParams>)}
          />
        ))}

        <div className="adjust-actions">
          <Button
            variant="ghost"
            onClick={() => setAdjust(active.id, { ...DEFAULT_ADJUST })}
          >
            重置全部
          </Button>
          <Button variant="primary" onClick={onClose}>完成</Button>
        </div>
      </div>
    </Sheet>
  )
}
