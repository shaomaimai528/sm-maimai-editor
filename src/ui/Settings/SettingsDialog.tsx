/** 设置：API Key 本地存储 + 渠道额度 + 配置导出导入 */
import { useState } from 'react'
import { KeyRound, Download, Upload, Trash2, CheckCircle2 } from 'lucide-react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { CHANNELS, makeCustomChannel } from '../../core/ai/channels'
import { queryBalance } from '../../core/ai/pipeline'
import {
  getKeyFor, setKeyFor, exportSettings, importSettings,
  type AppSettings, type UserChannelConfig,
} from '../../state/settings'
import { CustomChannelEditor } from './CustomChannelEditor'
import type { Channel } from '../../core/ai/types'
import './SettingsDialog.css'

interface Props {
  open: boolean
  onClose: () => void
  settings: AppSettings
  onChange: (s: AppSettings) => void
}

export function SettingsDialog({ open, onClose, settings, onChange }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draftKey, setDraftKey] = useState('')
  const [balanceMsg, setBalanceMsg] = useState<Record<string, string>>({})
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)

  // 让模块级的测试函数能读到最新 Key
  currentSettingsForTest = settings

  const saveKey = (channelId: string) => {
    onChange(setKeyFor(settings, channelId, draftKey.trim()))
    setEditing(null)
    setDraftKey('')
  }

  const checkBalance = async (channelId: string) => {
    const ch = CHANNELS.find((c) => c.id === channelId)!
    const key = getKeyFor(settings, channelId)
    if (!key) return
    setBalanceMsg((m) => ({ ...m, [channelId]: '查询中' }))
    try {
      const b = await queryBalance(ch, key)
      const text = !b ? '该渠道不支持查询'
        : b.unlimited ? '不限量'
        : b.balance === null ? '未知'
        : `${b.balance} ${b.currency}`
      setBalanceMsg((m) => ({ ...m, [channelId]: text }))
    } catch (e) {
      setBalanceMsg((m) => ({ ...m, [channelId]: (e as Error).message || '查询失败' }))
    }
  }

  const doExport = () => {
    const blob = new Blob([exportSettings(settings)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ai-photo-settings.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 3000)
  }

  const doImport = () => {
    try {
      onChange(importSettings(importText))
      setShowImport(false)
      setImportText('')
    } catch {
      alert('配置格式不正确')
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="设置" maxHeight="85vh">
      <div className="settings">
        <div className="settings-note">
          API Key 只保存在本机浏览器，不会上传到任何服务器
        </div>

        {[...CHANNELS, ...settings.userChannels.map(ucToChannel)].map((ch) => {
          const key = getKeyFor(settings, ch.id)
          const masked = key ? `${key.slice(0, 6)}••••${key.slice(-4)}` : ''
          return (
            <div className="settings-row" key={ch.id}>
              <div className="settings-row-head">
                <span className="settings-channel">{ch.label}</span>
                {key && <CheckCircle2 size={16} color="var(--c-accent)" />}
              </div>

              {editing === ch.id ? (
                <div className="settings-key-edit">
                  <input
                    className="settings-input"
                    type="password"
                    value={draftKey}
                    autoFocus
                    placeholder="粘贴 API Key"
                    onChange={(e) => setDraftKey(e.target.value)}
                  />
                  <Button size="sm" variant="primary" onClick={() => saveKey(ch.id)}>保存</Button>
                </div>
              ) : (
                <div className="settings-key-view">
                  <button className="settings-key-btn" onClick={() => { setEditing(ch.id); setDraftKey(key) }}>
                    <KeyRound size={14} />
                    <span>{key ? masked : '未配置'}</span>
                  </button>
                  {key && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => checkBalance(ch.id)}>查额度</Button>
                      <Button
                        size="sm" variant="ghost"
                        icon={<Trash2 size={14} />}
                        onClick={() => onChange(setKeyFor(settings, ch.id, ''))}
                        aria-label="清除"
                      />
                    </>
                  )}
                </div>
              )}

              {balanceMsg[ch.id] && <div className="settings-balance">{balanceMsg[ch.id]}</div>}
            </div>
          )
        })}

        {/* RunningHub：只需工作流 ID */}
        <div className="settings-section">
          <div className="settings-section-title">RunningHub 工作流</div>
          <input
            className="settings-input"
            placeholder="工作流 ID"
            value={settings.runningHubWorkflowId}
            onChange={(e) => onChange({ ...settings, runningHubWorkflowId: e.target.value })}
          />
          <div className="settings-hint">
            在 RunningHub 打开你的工作流，从网址里取那段数字 ID 填这里即可
          </div>
        </div>

        {/* 自定义渠道 */}
        <CustomChannelEditor
          channels={settings.userChannels}
          onChange={(list) => onChange({ ...settings, userChannels: list })}
          onTest={testCustomChannel}
        />

        {/* 贴回参数 */}
        <div className="settings-section">
          <div className="settings-section-title">贴回融合</div>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settings.colorMatch}
              onChange={(e) => onChange({ ...settings, colorMatch: e.target.checked })}
            />
            <span>颜色匹配（让生成结果色调贴近原图）</span>
          </label>
        </div>

        {/* 配置备份 */}
        <div className="settings-section">
          <div className="settings-section-title">配置备份</div>
          <div className="settings-io">
            <Button size="sm" variant="ghost" icon={<Download size={16} />} onClick={doExport}>
              导出配置
            </Button>
            <Button size="sm" variant="ghost" icon={<Upload size={16} />} onClick={() => setShowImport(!showImport)}>
              导入配置
            </Button>
          </div>
          {showImport && (
            <div className="settings-import">
              <textarea
                className="settings-input"
                rows={4}
                placeholder="粘贴之前导出的配置 JSON"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <Button size="sm" variant="primary" onClick={doImport}>确认导入</Button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/** 把持久化的用户渠道配置转换成运行时 Channel 结构 */
function ucToChannel(uc: UserChannelConfig): Channel {
  const models = uc.models.split(',').map((m) => m.trim()).filter(Boolean)
  return makeCustomChannel({
    id: uc.id,
    label: uc.label || '自定义渠道',
    apiUrl: uc.apiUrl || 'https://example.invalid',
    models,
    custom: {
      mode: uc.mode,
      submitPath: uc.submitPath,
      pollPath: uc.pollPath,
      imageField: uc.imageField,
      promptField: uc.promptField,
      modelField: uc.modelField,
      taskIdField: uc.taskIdField,
      imageAsDataUrl: uc.imageAsDataUrl,
      authHeader: uc.authHeader,
      authPrefix: uc.authPrefix,
    },
  })
}

/** 连通性测试：只验证地址可达与鉴权是否被接受，不做真实生成 */
async function testCustomChannel(cfg: UserChannelConfig): Promise<string> {
  if (!cfg.apiUrl) throw new Error('请先填写接口地址')
  if (!/^https?:\/\//i.test(cfg.apiUrl)) throw new Error('接口地址需以 http:// 或 https:// 开头')

  const base = cfg.apiUrl.replace(/\/+$/, '')
  const path = cfg.submitPath.startsWith('/') ? cfg.submitPath : `/${cfg.submitPath}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = getKeyFor(currentSettingsForTest, cfg.id)
  if (key) {
    headers[cfg.authHeader || 'Authorization'] = `${cfg.authPrefix ?? ''}${key}`
  }

  try {
    const resp = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    })
    // 只要拿到 HTTP 响应就说明地址可达、CORS 放行
    if (resp.status === 401 || resp.status === 403) {
      return `地址可达，但鉴权被拒（HTTP ${resp.status}），请检查 Key`
    }
    if (resp.status === 404) {
      return `地址可达，但路径不存在（404），请检查提交路径`
    }
    return `地址可达，接口已响应（HTTP ${resp.status}）`
  } catch (e) {
    const msg = (e as Error)?.message || ''
    if (/failed to fetch|network|load failed/i.test(msg)) {
      throw new Error('地址不可达，或该服务未开放跨域（CORS）')
    }
    if (/timeout|abort/i.test(msg)) {
      throw new Error('请求超时，地址可能不可达')
    }
    throw new Error(msg || '测试失败')
  }
}

/** 供测试函数读取当前 Key（由组件渲染时同步） */
let currentSettingsForTest: AppSettings = { credentials: [] } as unknown as AppSettings
