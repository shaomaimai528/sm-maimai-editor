/**
 * RunningHub 工作流参数面板
 *
 * 参数来自 POST /api/webapp/detail 的 inputNodes，
 * 已实测的真实字段：nodeId / nodeName / fieldName / fieldType / fieldValue / descriptionCn
 *
 * fieldType 取值与对应控件：
 *   IMAGE   —— 复用主图，不单独上传（面板里只做提示）
 *   FLOAT   —— 数字输入，步长 0.05
 *   INT     —— 整数输入，步长 1
 *   BOOLEAN —— 开关
 *   STRING  —— 多行文本（提示词通常很长）
 */

import { Hash, Image as ImageIcon, MessageSquare, SlidersHorizontal, ToggleLeft, Wand2 } from 'lucide-react'
import type { WorkflowInfo, WorkflowParam } from '../../core/ai/workflow'
import { isImageParam, promptParamOf } from '../../core/ai/workflow'
import './WorkflowParams.css'

interface Props {
  info: WorkflowInfo
  values: Record<string, string>
  onChange: (nodeId: string, value: string) => void
  /** 重置为工作流默认值 */
  onReset: () => void
}

/** 按参数类型选图标 */
function iconFor(p: WorkflowParam) {
  if (isImageParam(p)) return ImageIcon
  const t = p.fieldType.toUpperCase()
  if (t === 'FLOAT' || t === 'INT') return SlidersHorizontal
  if (t === 'BOOLEAN') return ToggleLeft
  if (p.label.includes('提示词') || p.label.includes('prompt')) return MessageSquare
  return Hash
}

export function WorkflowParams({ info, values, onChange, onReset }: Props) {
  if (!info.params.length) {
    return (
      <div className="wf-empty">
        该工作流没有可调参数，上传图片后直接运行即可
      </div>
    )
  }

  // 图片参数由主图自动带入，不在面板里重复展示
  const editable = info.params.filter((p) => !isImageParam(p))
  const imageParams = info.params.filter(isImageParam)
  // 哪个参数是"要改成什么"的编辑指令 —— 标出来，用户才知道提示词该填哪
  const promptSlot = promptParamOf(info.params)

  return (
    <div className="wf-params">
      <div className="wf-head">
        <div className="wf-title-row">
          <span className="wf-name">{info.name}</span>
          <button className="wf-reset" onClick={onReset} type="button">恢复默认</button>
        </div>

        <div className="wf-meta">
          {info.tags?.slice(0, 3).map((t) => (
            <span key={t} className="wf-tag">{t}</span>
          ))}
          {info.successRate && <span className="wf-stat">成功率 {info.successRate}%</span>}
          {info.avgSeconds && <span className="wf-stat">约 {info.avgSeconds} 秒</span>}
        </div>

        {imageParams.length > 0 && (
          <div className="wf-auto-note">
            <ImageIcon size={13} />
            已自动使用你框选的区域作为主图
          </div>
        )}
      </div>

      <div className="wf-list">
        {editable.map((p) => {
          const Icon = iconFor(p)
          const t = p.fieldType.toUpperCase()
          const v = values[p.nodeId] ?? p.value

          const isPromptSlot = promptSlot?.nodeId === p.nodeId

          return (
            <div className="wf-item" key={p.nodeId + p.fieldName} data-prompt={isPromptSlot}>
              <label className="wf-label">
                <Icon size={14} className="wf-icon" />
                <span>{p.label || p.fieldName}</span>
                {isPromptSlot && (
                  <span className="wf-prompt-badge">
                    <Wand2 size={11} />
                    编辑指令
                  </span>
                )}
              </label>

              {t === 'BOOLEAN' ? (
                <button
                  className="wf-switch"
                  data-on={String(v) === 'true'}
                  onClick={() => onChange(p.nodeId, String(v) === 'true' ? 'false' : 'true')}
                  type="button"
                >
                  <span className="wf-knob" />
                </button>
              ) : t === 'FLOAT' || t === 'INT' ? (
                <input
                  className="wf-input wf-number"
                  type="number"
                  step={t === 'INT' ? 1 : 0.05}
                  value={v}
                  onChange={(e) => onChange(p.nodeId, e.target.value)}
                />
              ) : String(v).length > 40 || p.label.includes('提示词') ? (
                <textarea
                  className="wf-input wf-textarea"
                  rows={3}
                  value={v}
                  placeholder={p.label}
                  onChange={(e) => onChange(p.nodeId, e.target.value)}
                />
              ) : (
                <input
                  className="wf-input"
                  value={v}
                  placeholder={p.label}
                  onChange={(e) => onChange(p.nodeId, e.target.value)}
                />
              )}

              {p.description && <div className="wf-hint">{p.description}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
