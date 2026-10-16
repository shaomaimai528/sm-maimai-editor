/** 顶部工具栏 + 底部工具切换 */
import {
  Wand2, Lasso, Brush, Eraser, Move, SlidersHorizontal,
  Undo2, Redo2, Upload, Download, Settings, Layers, Sparkles,
  SquareDashed, Frame,
} from 'lucide-react'
import { useEditor, type ToolId } from '../../state/editorStore'
import { Button } from '../primitives/Button'
import './Toolbar.css'

interface Props {
  onPickImage: () => void
  onExport: () => void
  onOpenSettings: () => void
  onOpenLayers: () => void
  onOpenAI: () => void
  onOpenAdjust: () => void
  onOpenCanvas: () => void
}

const TOOLS: Array<{ id: ToolId; label: string; icon: typeof Move }> = [
  { id: 'move', label: '移动', icon: Move },
  { id: 'rect', label: '矩形', icon: SquareDashed },
  { id: 'lasso', label: '套索', icon: Lasso },
  { id: 'wand', label: '魔术棒', icon: Wand2 },
  { id: 'brush', label: '蒙版', icon: Brush },
  { id: 'erase', label: '擦除', icon: Eraser },
]

export function Toolbar({ onPickImage, onExport, onOpenSettings, onOpenLayers, onOpenAI, onOpenAdjust, onOpenCanvas }: Props) {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const doc = useEditor((s) => s.doc)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const history = useEditor((s) => s.history)
  /**
   * 订阅历史版本号
   *
   * history 是可变对象，仅订阅它本身拿不到 push/undo 引起的更新，
   * 按钮的可用状态会永远停在第一帧。这里显式依赖 revision，
   * 并在下面用它参与计算，让 React 知道该重渲染。
   */
  const historyRevision = useEditor((s) => s.historyRevision)
  const selection = useEditor((s) => s.selection)

  const hasDoc = !!doc
  const canUndo = historyRevision >= 0 && hasDoc && history.canUndo()
  const canRedo = historyRevision >= 0 && hasDoc && history.canRedo()

  return (
    <>
      {/* 顶部：操作区 */}
      <div className="topbar">
        <div className="topbar-left">
          <Button size="sm" variant="ghost" icon={<Upload size={18} />} onClick={onPickImage}>
            导入
          </Button>
        </div>
        <div className="topbar-right">
          <Button
            size="sm" variant="ghost" icon={<Undo2 size={18} />}
            onClick={undo} disabled={!canUndo}
            aria-label="撤销"
          />
          <Button
            size="sm" variant="ghost" icon={<Redo2 size={18} />}
            onClick={redo} disabled={!canRedo}
            aria-label="重做"
          />
          <Button size="sm" variant="ghost" icon={<Frame size={18} />} onClick={onOpenCanvas} disabled={!hasDoc} aria-label="画布" />
          <Button size="sm" variant="ghost" icon={<Layers size={18} />} onClick={onOpenLayers} disabled={!hasDoc} aria-label="图层" />
          <Button size="sm" variant="ghost" icon={<SlidersHorizontal size={18} />} onClick={onOpenAdjust} disabled={!hasDoc} aria-label="调整" />
          <Button size="sm" variant="ghost" icon={<Settings size={18} />} onClick={onOpenSettings} aria-label="设置" />
          <Button size="sm" variant="ghost" icon={<Download size={18} />} onClick={onExport} disabled={!hasDoc} aria-label="导出" />
        </div>
      </div>

      {/* 底部：工具切换 + AI 主操作 */}
      {hasDoc && (
        <div className="bottombar">
          <div className="tool-strip">
            {TOOLS.map((t) => {
              const Icon = t.icon
              const active = tool === t.id
              return (
                <button
                  key={t.id}
                  className="tool-btn"
                  data-active={active}
                  onClick={() => setTool(t.id)}
                >
                  <Icon size={20} />
                  <span className="tool-label">{t.label}</span>
                </button>
              )
            })}
          </div>

          <button
            className="ai-fab"
            onClick={onOpenAI}
            data-ready={!!selection}
            aria-label="AI 生成"
          >
            <Sparkles size={20} />
            <span>AI</span>
          </button>
        </div>
      )}
    </>
  )
}
