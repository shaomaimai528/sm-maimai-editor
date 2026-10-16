/**
 * 工作流参数编辑器
 *
 * 参数由 RunningHub 工作流自身定义，数量和类型都不固定：
 * 可能是提示词文本框、图片槽、数值滑杆、下拉选项、开关。
 * 这里按类型渲染对应控件，用户改完直接作为 nodeInfoList 提交。
 */
import { Image as ImageIcon, Type, Hash, List, ToggleLeft } from 'lucide-react'
import type { WorkflowParam } from '../../core/ai/workflow'
import './WorkflowParams.css'

interface Props {
  params: WorkflowParam[]
  onChange: (params: WorkflowParam[]) => void
}

export function WorkflowParams({ params, onChange }: Props) {
  if (!params.length) return null

  const update = (i: number, value: WorkflowParam['value']) => {
    const next = params.slice()
    next[i] = { ...next[i], value }
    onChange(next)
  }

  return (
    <div className="wfp">
      <div className="wfp-head">
        <span>工作流参数</span>
        <span className="wfp-count">{params.length} 项</span>
      </div>

      {params.map((p, i) => (
        <div className="wfp-field" key={`${p.nodeId}:${p.fieldName}:${i}`}>
          <label className="wfp-label">
            <Icon type={p.type} />
            <span className="wfp-name">{p.label}</span>
            {p.required && <span className="wfp-req">必填</span>}
          </label>

          {p.type === 'image' && (
            <div className="wfp-image">
              <ImageIcon size={15} />
              <span>自动使用当前选区图像</span>
            </div>
          )}

          {p.type === 'text' && (
            <textarea
              className="wfp-input"
              rows={2}
              value={String(p.value)}
              onChange={(e) => update(i, e.target.value)}
            />
          )}

          {p.type === 'number' && (
            <div className="wfp-num">
              <input
                type="range"
                min={p.min ?? 0}
                max={p.max ?? 100}
                step={p.step ?? 1}
                value={Number(p.value)}
                onChange={(e) => update(i, Number(e.target.value))}
              />
              <span className="wfp-numval">{String(p.value)}</span>
            </div>
          )}

          {p.type === 'select' && (
            <select
              className="wfp-input"
              value={String(p.value)}
              onChange={(e) => update(i, e.target.value)}
            >
              <option value="">请选择</option>
              {(p.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}

          {p.type === 'boolean' && (
            <label className="wfp-switch">
              <input
                type="checkbox"
                checked={!!p.value}
                onChange={(e) => update(i, e.target.checked)}
              />
              <span>{p.value ? '开启' : '关闭'}</span>
            </label>
          )}

          {p.description && <div className="wfp-desc">{p.description}</div>}
        </div>
      ))}
    </div>
  )
}

function Icon({ type }: { type: WorkflowParam['type'] }) {
  const size = 14
  if (type === 'image') return <ImageIcon size={size} />
  if (type === 'number') return <Hash size={size} />
  if (type === 'select') return <List size={size} />
  if (type === 'boolean') return <ToggleLeft size={size} />
  return <Type size={size} />
}
