/**
 * 笔刷参数条 —— 工具为蒙版/擦除时出现在画布底部
 *
 * 参数对齐 PS 的手感：
 *  大小   笔触直径（文档像素）
 *  硬度   边缘羽化程度，0 最柔、100 最锐
 *  流量   单次落笔的浓度，决定了来回涂抹能叠多深
 *  不透明度 整笔的上限，决定这一笔最多能盖到多浓
 * 作用对象 涂抹选区，还是当前图层的蒙版
 */
import { useState } from 'react'
import { Brush, Eraser, Circle, Droplet, Layers, SquareDashed, ChevronDown } from 'lucide-react'
import { useEditor } from '../../state/editorStore'
import { Slider } from '../primitives/Slider'
import './BrushBar.css'

export function BrushBar() {
  const tool = useEditor((s) => s.tool)
  const brush = useEditor((s) => s.brush)
  const setBrush = useEditor((s) => s.setBrush)
  const brushTarget = useEditor((s) => s.brushTarget)
  const setBrushTarget = useEditor((s) => s.setBrushTarget)
  const doc = useEditor((s) => s.doc)

  const [open, setOpen] = useState(false)

  const isBrushTool = tool === 'brush' || tool === 'erase'
  if (!isBrushTool || !doc) return null

  const erasing = tool === 'erase'

  return (
    <div className="brush-bar" data-erase={erasing}>
      <button
        className="brush-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="brush-head-icon">
          {erasing ? <Eraser size={16} /> : <Brush size={16} />}
        </span>
        <span className="brush-head-text">
          {erasing ? '擦除' : '蒙版'} · {Math.round(brush.radius * 2)}px
        </span>
        <span className="brush-head-target">
          {brushTarget === 'layer-mask' ? '图层蒙版' : '选区'}
        </span>
        <ChevronDown size={15} className="brush-head-chevron" data-open={open} />
      </button>

      {open && (
        <div className="brush-panel">
          {/* 作用对象：涂抹选区 vs 图层蒙版 */}
          <div className="brush-target">
            <button
              className="brush-target-btn"
              data-on={brushTarget === 'selection'}
              onClick={() => setBrushTarget('selection')}
            >
              <SquareDashed size={15} />
              选区
            </button>
            <button
              className="brush-target-btn"
              data-on={brushTarget === 'layer-mask'}
              onClick={() => setBrushTarget('layer-mask')}
            >
              <Layers size={15} />
              图层蒙版
            </button>
          </div>

          <Slider
            label="大小"
            value={Math.round(brush.radius * 2)}
            min={4}
            max={400}
            step={2}
            onChange={(v) => setBrush({ radius: v / 2 })}
            resetValue={80}
            unit="px"
          />
          <Slider
            label="硬度"
            value={Math.round(brush.hardness * 100)}
            min={0}
            max={100}
            onChange={(v) => setBrush({ hardness: v / 100 })}
            resetValue={70}
            unit="%"
          />
          <Slider
            label="流量"
            value={Math.round(brush.flow * 100)}
            min={1}
            max={100}
            onChange={(v) => setBrush({ flow: v / 100 })}
            resetValue={80}
            unit="%"
          />
          <Slider
            label="不透明度"
            value={Math.round(brush.opacity * 100)}
            min={1}
            max={100}
            onChange={(v) => setBrush({ opacity: v / 100 })}
            resetValue={100}
            unit="%"
          />

          <div className="brush-foot">
            <span className="brush-foot-item"><Circle size={13} />{Math.round(brush.radius * 2)} px</span>
            <span className="brush-foot-item"><Droplet size={13} />{Math.round(brush.flow * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
