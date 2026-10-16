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
    /**
     * 渠道既可能在内置表里，也可能是用户自建
     *
     * 早期只查 CHANNELS 并用了非空断言，列表里渲染的却是
     * [...CHANNELS, ...userChannels] —— 点自定义渠道的「查额度」时
     * find 返回 undefined，断言让它带着一个空对象继续跑，
     * queryBalance 里读 family 就抛异常，整个面板白屏。
     */
    const builtin = CHANNELS.find((c) => c.id === channelId)
    const user = settings.userChannels.find((u) => u.id === channelId)
    const ch = builtin || (user ? ucToChannel(user) : undefined)
    if (!ch) {
      setBalanceMsg((m) => ({ ...m, [channelId]: '渠道不存在' }))
      return
    }

    const key = getKeyFor(settings, channelId)
    if (!key) {
      setBalanceMsg((m) => ({ ...m, [channelId]: '请先填写 API Key' }))
      return
    }
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

        {/* 结果图代理：应对少数渠道的图床没有跨域头 */}
        <div className="settings-row">
          <div className="settings-row-head">
            <span className="settings-channel">图片代理</span>
            {settings.imageProxy && <CheckCircle2 size={16} color="var(--c-accent)" />}
          </div>
          <input
            className="settings-input"
            value={settings.imageProxy}
            placeholder="可选，如 https://你的worker.workers.dev"
            onChange={(e) => onChange({ ...settings, imageProxy: e.target.value.trim() })}
          />
          <div className="settings-hint">
            一般不用填。应用已优先要求渠道直接返回内嵌图片，绝大多数情况够用。
            万一仍取不回图，再在这里填一个转发地址兜底，格式为「代理前缀?url=图片地址」。
            部署脚本见仓库 proxy 目录。
          </div>
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
          onPresetKey={(channelId, apiKey) =>
            onChange({ ...setKeyFor(settings, channelId, apiKey) })
          }
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

  const full = `${base}${path}`

  try {
    const resp = await fetch(full, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    })
    // 拿到 HTTP 响应 = 地址可达 + CORS 放行 + TLS 正常
    if (resp.status === 401 || resp.status === 403) {
      return `✓ 连接正常，但鉴权被拒（HTTP ${resp.status}）—— 请检查 API Key`
    }
    if (resp.status === 404) {
      return `✓ 地址可达，但路径不存在（404）—— 请检查提交路径「${cfg.submitPath}」`
    }
    if (resp.status === 400 || resp.status === 422) {
      return `✓ 连接正常，服务已响应（HTTP ${resp.status}）—— 空请求被拒属正常`
    }
    return `✓ 连接正常（HTTP ${resp.status}）`
  } catch (e) {
    const msg = (e as Error)?.message || ''
    if (/abort|timeout/i.test(msg)) {
      throw new Error(`请求超时 —— ${full} 无响应，可能地址错误或服务已下线`)
    }
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      // 浏览器把 DNS/TLS/CORS 三种情况都报成同一句话，这里分别探测
      const cause = await probeCause(base)
      throw new Error(cause)
    }
    throw new Error(msg || '测试失败')
  }
}

/**
 * "Failed to fetch" 有三种截然不同的原因，浏览器不区分。
 * 用一个 no-cors 的探测请求 + 图片加载来区分它们。
 */
async function probeCause(base: string): Promise<string> {
  const host = (() => { try { return new URL(base).host } catch { return base } })()

  // no-cors 请求：能发出但不给读响应。若不抛错，说明 DNS/TLS 都通，只是缺 CORS 头
  try {
    await fetch(`${base}/favicon.ico`, { mode: 'no-cors', signal: AbortSignal.timeout(10000) })
    return [
      `✗ 服务器可达，但未开放跨域（CORS）`,
      `  ${host} 拒绝了浏览器的跨域请求。`,
      '  这是服务端配置问题，浏览器端无法绕过。',
      '  解决：换一个支持 CORS 的接口，或让服务方加上 Access-Control-Allow-Origin',
    ].join('\n')
  } catch {
    // 连 no-cors 都失败 —— DNS 解析不了，或 TLS 握手失败
    return [
      `✗ 无法连接到 ${host}`,
      '  域名解析失败，或该地址没有可用的 HTTPS 证书。',
      '  排查：浏览器直接打开该域名，能否正常访问？',
      '  若打不开，说明地址填错了。',
    ].join('\n')
  }
}

/** 供测试函数读取当前 Key（由组件渲染时同步） */
let currentSettingsForTest: AppSettings = { credentials: [] } as unknown as AppSettings
