/**
 * RunningHub 工作流面板
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
 *
 * 这里刻意做得像"工作流本身的界面"，而不是一个通用参数表：
 * 用户在 RunningHub 网站上看到的就是封面、作者、成功率、分组编号的参数，
 * 界面一致他才知道自己跑的是同一个东西。
 */

import { useState } from 'react'
import {
  Hash, Image as ImageIcon, MessageSquare, SlidersHorizontal, ToggleLeft, Wand2,
  Timer, TrendingUp, User, Play, ChevronDown, Info, ImageOff,
} from 'lucide-react'
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

/**
 * 把参数按作者的编号分组
 *
 * 工作流的说明普遍写成 "2.1厚涂lora" "3.2提示词" 这种带层级编号的形式，
 * 编号本身就是作者划定的分组，按它折叠比我们自己瞎分类准确得多。
 * 没有编号的参数归到"其他"。
 */
function groupOf(p: WorkflowParam): string {
  const m = (p.label || '').match(/^\s*(\d+)/)
  return m ? `${m[1]}.` : '其他'
}

export function WorkflowParams({ info, values, onChange, onReset }: Props) {
  // 有编号的分组默认展开，没有的（其他）默认收起，避免一屏塞满
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [coverFailed, setCoverFailed] = useState(false)
  const [showDesc, setShowDesc] = useState(false)

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

  // 按编号分组，保持作者原始顺序
  const groups: Array<{ key: string; items: WorkflowParam[] }> = []
  for (const p of editable) {
    const k = groupOf(p)
    let g = groups.find((x) => x.key === k)
    if (!g) { g = { key: k, items: [] }; groups.push(g) }
    g.items.push(p)
  }
  // "其他"永远排最后
  groups.sort((a, b) => (a.key === '其他' ? 1 : 0) - (b.key === '其他' ? 1 : 0))

  const hasCover = !!info.coverUrl && !coverFailed

  return (
    <div className="wf-params">
      {/* 工作流卡片：封面 + 名称 + 作者 + 统计，对齐 RunningHub 网站上的样子 */}
      <div className="wf-card">
        <div className="wf-cover">
          {hasCover ? (
            <img
              src={info.coverUrl}
              alt={info.name}
              loading="lazy"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <div className="wf-cover-fallback">
              <ImageOff size={20} />
            </div>
          )}
          {info.available === false && (
            <span className="wf-offline">状态未知</span>
          )}
        </div>

        <div className="wf-card-body">
          <div className="wf-name" title={info.name}>{info.name}</div>

          <div className="wf-meta">
            {info.author && (
              <span className="wf-stat"><User size={12} />{info.author}</span>
            )}
            {info.successRate && (
              <span className="wf-stat"><TrendingUp size={12} />成功率 {info.successRate}%</span>
            )}
            {info.avgSeconds && (
              <span className="wf-stat"><Timer size={12} />约 {info.avgSeconds} 秒</span>
            )}
            {info.runCount && (
              <span className="wf-stat"><Play size={12} />{info.runCount} 次</span>
            )}
          </div>

          {info.tags && info.tags.length > 0 && (
            <div className="wf-tags">
              {info.tags.slice(0, 4).map((t) => (
                <span key={t} className="wf-tag">{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {info.description && (
        <div className="wf-desc-block">
          <button
            className="wf-desc-toggle"
            type="button"
            data-open={showDesc}
            onClick={() => setShowDesc((v) => !v)}
          >
            <Info size={13} />
            工作流说明
            <ChevronDown size={14} className="wf-desc-arrow" />
          </button>
          {showDesc && <p className="wf-desc">{info.description}</p>}
        </div>
      )}

      <div className="wf-toolbar">
        <span className="wf-count">{editable.length} 项参数</span>
        {imageParams.length > 0 && (
          <span className="wf-auto-note">
            <ImageIcon size={13} />
            主图已用框选区域
          </span>
        )}
        <button className="wf-reset" onClick={onReset} type="button">恢复默认</button>
      </div>

      {info.available === false && (
        <div className="wf-warn">
          RunningHub 未把该应用标记为上线状态，提交可能失败。
          若之前跑过没问题，可以直接忽略这条提示。
        </div>
      )}

      <div className="wf-list">
        {groups.map((g) => {
          const isCollapsed = !!collapsed[g.key]
          return (
            <div className="wf-group" key={g.key}>
              {/*
                只有一个分组（都是"其他"）时不显示组头，
                否则会出现一个只包着一层壳、没有任何信息量的标题
              */}
              {!(groups.length === 1 && g.key === '其他') && (
                <button
                  className="wf-group-head"
                  type="button"
                  data-collapsed={isCollapsed}
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                >
                  <ChevronDown size={14} className="wf-group-arrow" />
                  <span>{g.key === '其他' ? '其他参数' : `第 ${g.key.replace('.', '')} 组`}</span>
                  <span className="wf-group-count">{g.items.length}</span>
                </button>
              )}

              {!isCollapsed && g.items.map((p) => {
                const Icon = iconFor(p)
                const t = p.fieldType.toUpperCase()
                const v = values[p.nodeId] ?? p.value
                const isPromptSlot = promptSlot?.nodeId === p.nodeId

                // 编号已经从组头体现，条目里去掉重复的前缀数字
                const rawLabel = p.label || p.fieldName
                const label = groups.length === 1 && g.key === '其他'
                  ? rawLabel
                  : rawLabel.replace(/^\s*\d+(\.\d+)?\s*/, '') || rawLabel

                return (
                  <div className="wf-item" key={p.nodeId + p.fieldName} data-prompt={isPromptSlot}>
                    <label className="wf-label">
                      <Icon size={14} className="wf-icon" />
                      <span>{label}</span>
                      {isPromptSlot && (
                        <span className="wf-prompt-badge">
                          <Wand2 size={11} />
                          编辑指令
                        </span>
                      )}
                      <span className="wf-node-id">#{p.nodeId}</span>
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
                    ) : String(v).length > 40 || isPromptSlot ? (
                      <textarea
                        className="wf-input wf-textarea"
                        rows={isPromptSlot ? 3 : 2}
                        value={v}
                        placeholder={isPromptSlot ? '描述你要改成什么样' : label}
                        onChange={(e) => onChange(p.nodeId, e.target.value)}
                      />
                    ) : (
                      <input
                        className="wf-input"
                        value={v}
                        placeholder={label}
                        onChange={(e) => onChange(p.nodeId, e.target.value)}
                      />
                    )}

                    {p.description && p.description !== rawLabel && (
                      <div className="wf-hint">{p.description}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
