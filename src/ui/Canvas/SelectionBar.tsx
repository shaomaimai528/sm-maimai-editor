/**
 * 选区操作条：比例锁、反选、羽化、扩张、收缩、清除
 * 这些是选区功能的必要组成，之前写好了却没接到界面上。
 */
import { ArrowLeftRight, Sparkle, Shrink, Expand, X, Paintbrush, Ratio } from 'lucide-react'
import { useState } from 'react'
import { useEditor } from '../../state/editorStore'
import { invert, feather, grow } from '../../core/selection/mask'
import { Slider } from '../primitives/Slider'
import './SelectionBar.css'

/**
 * 可选比例
 * 自由是默认项 —— 多数修图场景只想圈个大致范围，不该被迫选比例。
 * 明确要出某比例的图时再锁上，AI 收到的宽高比也跟着稳定。
 */
const RATIOS: Array<{ label: string; value: number | null }> = [
  { label: '自由', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]

export function SelectionBar() {
  const selection = useEditor((s) => s.selection)
  const pushSelectionHistory = useEditor((s) => s.pushSelectionHistory)
  const tool = useEditor((s) => s.tool)
  const aspectLock = useEditor((s) => s.aspectLock)
  const setAspectLock = useEditor((s) => s.setAspectLock)
  const [showFeather, setShowFeather] = useState(false)
  const [showRatio, setShowRatio] = useState(false)
  const [featherValue, setFeatherValue] = useState(12)
  const [growValue, setGrowValue] = useState(6)

  // 框选工具下即使还没选区，也要能先把比例选好
  const isRectTool = tool === 'rect'
  if (!selection && !isRectTool) return null

  const apply = (label: string, next: ReturnType<typeof invert>) => {
    pushSelectionHistory(label, next)
  }

  return (
    <div className="sel-bar" data-tool={tool}>
      {isRectTool && (
        <div className="sel-ratio">
          <button
            className="sel-ratio-trigger"
            data-on={showRatio}
            onClick={() => setShowRatio((v) => !v)}
          >
            <Ratio size={14} />
            <span>比例</span>
            <span className="sel-ratio-current">
              {RATIOS.find((r) => r.value === aspectLock)?.label || '自由'}
            </span>
          </button>

          {showRatio && (
            <div className="sel-ratio-list">
              {RATIOS.map((r) => (
                <button
                  key={r.label}
                  className="sel-ratio-item"
                  data-on={r.value === aspectLock}
                  onClick={() => { setAspectLock(r.value); setShowRatio(false) }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selection && (
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
      )}

      {showFeather && selection && (
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

      {!selection && isRectTool && (
        <div className="sel-bar-tip">
          <Paintbrush size={14} />
          <span>在画布上拖动框选，拖动时实时显示像素尺寸</span>
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
