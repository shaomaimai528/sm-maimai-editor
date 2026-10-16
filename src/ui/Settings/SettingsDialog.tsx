/** 设置：API Key 本地存储 + 渠道额度 + 配置导出导入 */
import { useState } from 'react'
import { KeyRound, Download, Upload, Trash2, CheckCircle2 } from 'lucide-react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { CHANNELS } from '../../core/ai/channels'
import { queryBalance } from '../../core/ai/pipeline'
import { getKeyFor, setKeyFor, exportSettings, importSettings, type AppSettings } from '../../state/settings'
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

        {CHANNELS.map((ch) => {
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

        {/* RunningHub 专用参数 */}
        <div className="settings-section">
          <div className="settings-section-title">RunningHub 参数</div>
          <input
            className="settings-input"
            placeholder="应用 ID (appId)"
            value={settings.runningHubAppId}
            onChange={(e) => onChange({ ...settings, runningHubAppId: e.target.value })}
          />
          <input
            className="settings-input"
            placeholder="工作流 ID (workflowId，可留空)"
            value={settings.runningHubWorkflowId}
            onChange={(e) => onChange({ ...settings, runningHubWorkflowId: e.target.value })}
          />
        </div>

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
