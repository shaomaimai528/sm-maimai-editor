/**
 * 自定义渠道编辑器
 *
 * 面向任意 OpenAI 兼容或私有接口，可配置：
 * 提交/轮询路径、字段名映射、鉴权方式、图片以 dataURL 还是表单提交。
 * 默认值已按 OpenAI 兼容格式填好，多数情况下只需填地址、Key、模型名。
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2, Zap, Download } from 'lucide-react'
import { Button } from '../primitives/Button'
import type { UserChannelConfig } from '../../state/settings'
import { makeDefaultUserChannel } from '../../state/settings'
import { CHANNEL_PRESETS, PRESET_ID_PREFIX } from '../../core/ai/presets'
import { uid } from '../../core/doc/types'
import './CustomChannelEditor.css'

interface Props {
  channels: UserChannelConfig[]
  onChange: (list: UserChannelConfig[]) => void
  /** 测试连通性：传入配置，返回提示文本 */
  onTest: (cfg: UserChannelConfig) => Promise<string>
}

export function CustomChannelEditor({ channels, onChange, onTest }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [testMsg, setTestMsg] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<string | null>(null)

  const add = () => {
    const cfg = makeDefaultUserChannel(uid('custom'))
    onChange([...channels, cfg])
    setExpanded(cfg.id)
  }

  /** 一键添加预置渠道：地址与协议都填好，用户只需补 Key */
  const addPreset = (key: string) => {
    const p = CHANNEL_PRESETS.find((x) => x.key === key)
    if (!p) return
    const id = PRESET_ID_PREFIX + p.key
    if (channels.some((c) => c.id === id)) return
    const cfg = makeDefaultUserChannel(id)
    cfg.label = p.label
    cfg.apiUrl = p.apiUrl
    cfg.models = p.defaultModel
    cfg.mode = p.spec.mode
    cfg.submitPath = p.spec.submitPath || '/v1/images/generations'
    cfg.pollPath = p.spec.pollPath || ''
    cfg.imageField = p.spec.imageField || 'image'
    cfg.promptField = p.spec.promptField || 'prompt'
    cfg.modelField = p.spec.modelField || 'model'
    cfg.taskIdField = p.spec.taskIdField || 'taskId'
    cfg.imageAsDataUrl = p.spec.imageAsDataUrl !== false
    cfg.authHeader = p.spec.authHeader || 'Authorization'
    cfg.authPrefix = p.spec.authPrefix ?? 'Bearer '
    onChange([...channels, cfg])
  }

  const update = (id: string, patch: Partial<UserChannelConfig>) => {
    onChange(channels.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const remove = (id: string) => {
    onChange(channels.filter((c) => c.id !== id))
  }

  const runTest = async (cfg: UserChannelConfig) => {
    setTesting(cfg.id)
    setTestMsg((m) => ({ ...m, [cfg.id]: '测试中' }))
    try {
      const msg = await onTest(cfg)
      setTestMsg((m) => ({ ...m, [cfg.id]: msg }))
    } catch (e) {
      setTestMsg((m) => ({ ...m, [cfg.id]: (e as Error).message || '测试失败' }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="cc">
      <div className="cc-head">
        <span className="cc-title">自定义渠道</span>
        <Button size="sm" variant="ghost" icon={<Plus size={15} />} onClick={add}>
          添加
        </Button>
      </div>

      {/* 预置渠道：地址已经填好，点一下即可加入 */}
      {(() => {
        const available = CHANNEL_PRESETS.filter(
          (p) => !channels.some((c) => c.id === PRESET_ID_PREFIX + p.key)
        )
        if (!available.length) return null
        return (
          <div className="cc-presets">
            <div className="cc-presets-title">
              <Download size={13} />
              常用渠道 点一下自动填入地址
            </div>
            <div className="cc-presets-list">
              {available.map((p) => (
                <button key={p.key} className="cc-preset" onClick={() => addPreset(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )
      })()}

      {channels.length === 0 && (
        <div className="cc-empty">还没有自定义渠道，点上方预置项或「添加」接入自己的接口</div>
      )}

      {channels.map((cfg) => {
        const open = expanded === cfg.id
        return (
          <div className="cc-item" key={cfg.id} data-open={open}>
            <div className="cc-item-head">
              <button className="cc-item-title" onClick={() => setExpanded(open ? null : cfg.id)}>
                {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                <span>{cfg.label || '未命名渠道'}</span>
              </button>
              <button className="cc-del" onClick={() => remove(cfg.id)} aria-label="删除">
                <Trash2 size={15} />
              </button>
            </div>

            {open && (
              <div className="cc-body">
                <Field label="渠道名称" hint="显示在渠道下拉里的名字">
                  <input
                    className="cc-input" value={cfg.label} placeholder="例如：我的中转"
                    onChange={(e) => update(cfg.id, { label: e.target.value })}
                  />
                </Field>

                <Field label="接口地址" hint="基础地址，不含具体路径">
                  <input
                    className="cc-input" value={cfg.apiUrl} placeholder="https://api.example.com"
                    onChange={(e) => update(cfg.id, { apiUrl: e.target.value })}
                  />
                </Field>

                <Field label="模型名" hint="多个用英文逗号分隔">
                  <input
                    className="cc-input" value={cfg.models} placeholder="gpt-image-2, flux-dev"
                    onChange={(e) => update(cfg.id, { models: e.target.value })}
                  />
                </Field>

                <Field label="返回方式">
                  <div className="cc-seg">
                    <button data-on={cfg.mode === 'sync'} onClick={() => update(cfg.id, { mode: 'sync' })}>
                      同步直出图片
                    </button>
                    <button data-on={cfg.mode === 'poll'} onClick={() => update(cfg.id, { mode: 'poll' })}>
                      返回任务号需轮询
                    </button>
                  </div>
                </Field>

                <Field label="提交路径">
                  <input
                    className="cc-input" value={cfg.submitPath} placeholder="/v1/images/generations"
                    onChange={(e) => update(cfg.id, { submitPath: e.target.value })}
                  />
                </Field>

                {cfg.mode === 'poll' && (
                  <Field label="轮询路径" hint="用任务号查询结果的地址">
                    <input
                      className="cc-input" value={cfg.pollPath} placeholder="/v1/draw/result"
                      onChange={(e) => update(cfg.id, { pollPath: e.target.value })}
                    />
                  </Field>
                )}

                <details className="cc-advanced">
                  <summary>高级：字段名与鉴权</summary>

                  <Field label="图片字段名">
                    <input className="cc-input" value={cfg.imageField}
                      onChange={(e) => update(cfg.id, { imageField: e.target.value })} />
                  </Field>
                  <Field label="提示词字段名">
                    <input className="cc-input" value={cfg.promptField}
                      onChange={(e) => update(cfg.id, { promptField: e.target.value })} />
                  </Field>
                  <Field label="模型字段名">
                    <input className="cc-input" value={cfg.modelField}
                      onChange={(e) => update(cfg.id, { modelField: e.target.value })} />
                  </Field>
                  {cfg.mode === 'poll' && (
                    <Field label="任务号字段名">
                      <input className="cc-input" value={cfg.taskIdField}
                        onChange={(e) => update(cfg.id, { taskIdField: e.target.value })} />
                    </Field>
                  )}
                  <Field label="鉴权头名称">
                    <input className="cc-input" value={cfg.authHeader}
                      onChange={(e) => update(cfg.id, { authHeader: e.target.value })} />
                  </Field>
                  <Field label="鉴权前缀" hint="如 Bearer 后面跟一个空格；留空则直接拼 Key">
                    <input className="cc-input" value={cfg.authPrefix}
                      onChange={(e) => update(cfg.id, { authPrefix: e.target.value })} />
                  </Field>
                  <label className="cc-check">
                    <input type="checkbox" checked={cfg.imageAsDataUrl}
                      onChange={(e) => update(cfg.id, { imageAsDataUrl: e.target.checked })} />
                    <span>图片以 dataURL 内嵌 JSON（取消则用 multipart 表单）</span>
                  </label>
                </details>

                <div className="cc-actions">
                  <Button
                    size="sm" variant="ghost" icon={<Zap size={15} />}
                    disabled={testing === cfg.id || !cfg.apiUrl}
                    onClick={() => runTest(cfg)}
                  >
                    {testing === cfg.id ? '测试中' : '测试连接'}
                  </Button>
                </div>

                {testMsg[cfg.id] && <div className="cc-test">{testMsg[cfg.id]}</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="cc-field">
      <label className="cc-label">{label}{hint && <span className="cc-hint">{hint}</span>}</label>
      {children}
    </div>
  )
}
