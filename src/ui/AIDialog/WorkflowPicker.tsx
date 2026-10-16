/**
 * RunningHub 工作流选择器
 *
 * 支持保存与切换 —— 用户常年在几个固定的工作流之间来回用，
 * 每次手抄 ID 不现实。
 *
 * 数据来源：settings.savedWorkflows（本机持久化）
 * 首屏会带入用户 HHPS 里已保存的工作流，避免重新录入。
 */

import { useState } from 'react'
import { Check, ChevronDown, Plus, Trash2, X } from 'lucide-react'
import type { SavedWorkflow } from '../../state/settings'
import './WorkflowPicker.css'

interface Props {
  workflows: SavedWorkflow[]
  activeId: string
  onPick: (webappId: string) => void
  onAdd: (webappId: string, name?: string) => void
  onRemove: (webappId: string) => void
}

export function WorkflowPicker({ workflows, activeId, onPick, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const active = workflows.find((w) => w.webappId === activeId)

  const submitDraft = () => {
    const v = draft.trim()
    if (!v) return
    onAdd(v)
    setDraft('')
    setOpen(false)
  }

  return (
    <div className="wf-picker">
      <button className="wf-picker-trigger" onClick={() => setOpen((v) => !v)} type="button">
        <span className="wf-picker-current">
          {active ? active.name : (activeId || '选择工作流')}
        </span>
        <ChevronDown size={15} className={open ? 'rot' : ''} />
      </button>

      {open && (
        <div className="wf-picker-panel">
          {workflows.length > 0 ? (
            <div className="wf-picker-list">
              {workflows.map((w) => (
                <div
                  key={w.webappId}
                  className="wf-picker-item"
                  data-active={w.webappId === activeId}
                >
                  <button className="wf-picker-pick" onClick={() => { onPick(w.webappId); setOpen(false) }} type="button">
                    {w.coverUrl
                      ? <img className="wf-picker-cover" src={w.coverUrl} alt="" />
                      : <span className="wf-picker-cover wf-picker-cover-empty" />}
                    <span className="wf-picker-text">
                      <span className="wf-picker-name">{w.name || w.webappId}</span>
                      <span className="wf-picker-id">{w.webappId}</span>
                    </span>
                    {w.webappId === activeId && <Check size={15} className="wf-picker-check" />}
                  </button>
                  <button
                    className="wf-picker-del"
                    onClick={() => onRemove(w.webappId)}
                    aria-label="删除"
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="wf-picker-empty">还没有保存的工作流，在下方粘贴 ID 添加</div>
          )}

          <div className="wf-picker-add">
            <input
              className="wf-picker-input"
              value={draft}
              placeholder="粘贴工作流 ID"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitDraft() }}
            />
            <button className="wf-picker-add-btn" onClick={submitDraft} type="button">
              <Plus size={14} />
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
