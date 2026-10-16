/**
 * 选区操作条：反选、羽化、扩张、收缩、清除
 * 这些是选区功能的必要组成，之前写好了却没接到界面上。
 */
import { ArrowLeftRight, Sparkle, Shrink, Expand, X, Paintbrush } from 'lucide-react'
import { useState } from 'react'
import { useEditor } from '../../state/editorStore'
import { invert, feather, grow } from '../../core/selection/mask'
import { Slider } from '../primitives/Slider'
import './SelectionBar.css'

export function SelectionBar() {
  const selection = useEditor((s) => s.selection)
  const setSelection = useEditor((s) => s.setSelection)
  const pushSelectionHistory = useEditor((s) => s.pushSelectionHistory)
  const tool = useEditor((s) => s.tool)
  const [showFeather, setShowFeather] = useState(false)
  const [featherValue, setFeatherValue] = useState(12)
  const [growValue, setGrowValue] = useState(6)

  // 只在有选区时出现；涂抹类工具下不遮挡
  if (!selection) return null

  const apply = (label: string, next: ReturnType<typeof invert>) => {
    pushSelectionHistory(label, next)
  }

  return (
    <div className="sel-bar" data-tool={tool}>
      <div className="sel-bar-row">
        <button className="sel-btn" onClick={() => apply('反选', invert(selection))}>
          <ArrowLeftRight size={16} />
          <span>反选</span>
        </button>
        <button
          className="sel-btn"
          data-on={showFeather}
          onClick={() => setShowFeather(!showFeather)}
        >
          <Sparkle size={16} />
          <span>羽化</span>
        </button>
        <button
          className="sel-btn"
          onClick={() => apply('收缩', grow(selection, -growValue))}
        >
          <Shrink size={16} />
          <span>收缩</span>
        </button>
        <button
          className="sel-btn"
          onClick={() => apply('扩张', grow(selection, growValue))}
        >
          <Expand size={16} />
          <span>扩张</span>
        </button>
        <button
          className="sel-btn sel-btn-clear"
          onClick={() => pushSelectionHistory('清除选区', null)}
        >
          <X size={16} />
          <span>清除</span>
        </button>
      </div>

      {showFeather && (
        <div className="sel-bar-slider">
          <Slider
            label="羽化半径"
            min={0}
            max={60}
            value={featherValue}
            resetValue={0}
            onChange={setFeatherValue}
          />
          <button
            className="sel-apply"
            onClick={() => {
              apply('羽化', feather(selection, featherValue))
              setShowFeather(false)
            }}
          >
            应用
          </button>
        </div>
      )}

      {(tool === 'brush' || tool === 'erase') && (
        <div className="sel-bar-tip">
          <Paintbrush size={14} />
          <span>直接在画布上涂抹可增减选区</span>
        </div>
      )}
    </div>
  )
}
