/**
 * AI 生成面板：选区 → 提示词 → 选渠道 → 生成 → 贴回
 * 这是产品的核心工作流界面
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles, X, AlertCircle, CheckCircle2, Loader2, RefreshCw, Workflow, Plus } from 'lucide-react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { useEditor } from '../../state/editorStore'
import { allChannels, getChannel } from '../../core/ai/channels'
import { generate, fetchResultBitmap, fetchModels } from '../../core/ai/pipeline'
import { AIError } from '../../core/ai/types'
import {
  contextBounds, cropForAI, composeResult, selectionBounds,
} from '../../core/render/pasteback'
import { createLayer } from '../../core/doc/document'
import { uid } from '../../core/doc/types'
import { fetchWorkflow, buildNodeInfoList, type WorkflowInfo, type WorkflowParam } from '../../core/ai/workflow'
import { WorkflowParams } from './WorkflowParams'
import type { AppSettings } from '../../state/settings'
import './AIDialog.css'

interface Props {
  open: boolean
  onClose: () => void
  settings: AppSettings
  apiKey: string
  onNeedKey: (channelId: string) => void
  /** 切换渠道；second 参数为要同时选中的模型（可空，空则沿用该渠道记住的） */
  onPickChannel: (channelId: string, model?: string) => void
  /** 切换模型 */
  onPickModel: (model: string) => void
  /** 还没有自定义渠道时，引导用户去添加 */
  onAddChannel: () => void
}

const PRESETS = [
  '把这里换成一片森林',
  '替换成蓝天白云',
  '改成夜晚场景',
  '去掉这个物体',
  '换成大理石材质',
]

export function AIDialog({
  open, onClose, settings, apiKey, onNeedKey, onPickChannel, onPickModel, onAddChannel,
}: Props) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState('')
  const [preview, setPreview] = useState<ImageBitmap | null>(null)
  const [resultLayer, setResultLayer] = useState<{ id: string; bitmap: ImageBitmap } | null>(null)

  // 模型列表（从对方网站拉取）
  const [modelList, setModelList] = useState<string[]>([])
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState('')

  // RunningHub 工作流参数
  const [wfInfo, setWfInfo] = useState<WorkflowInfo | null>(null)
  const [wfParams, setWfParams] = useState<WorkflowParam[]>([])
  const [wfLoading, setWfLoading] = useState(false)
  const [wfError, setWfError] = useState('')

  const doc = useEditor((s) => s.doc)
  const sourceBitmap = useEditor((s) => s.sourceBitmap)
  const selection = useEditor((s) => s.selection)
  const commit = useEditor((s) => s.commit)

  const channels = useMemo(() => allChannels(), [settings.userChannels])
  const channel = useMemo(
    () => getChannel(settings.activeChannelId) || channels[0],
    [settings.activeChannelId, channels]
  )
  const selBounds = useMemo(
    () => (selection ? selectionBounds(selection) : null),
    [selection]
  )

  // 关闭时清理，避免残留内存
  useEffect(() => {
    if (!open) {
      setBusy(false)
      setError('')
      setPhase('')
      setPreview(null)
      setResultLayer(null)
    }
  }, [open])

  /**
   * 选中 RunningHub 时自动拉取工作流参数
   * 工作流 ID 或 Key 变化都重新拉，因为权限与参数都会随之变化
   */
  const loadWorkflow = useCallback(async () => {
    if (!open) return
    if (channel?.family !== 'runninghub') { setWfInfo(null); setWfParams([]); setWfError(''); return }

    const wfId = settings.runningHubWorkflowId?.trim()
    if (!wfId) {
      setWfInfo(null); setWfParams([])
      setWfError('请先在设置里填写工作流 ID')
      return
    }
    if (!apiKey) {
      setWfInfo(null); setWfParams([])
      setWfError('请先填写该渠道的 API Key')
      return
    }

    setWfLoading(true)
    setWfError('')
    try {
      const info = await fetchWorkflow(wfId, apiKey, channel.apiUrl)
      setWfInfo(info)
      setWfParams(info.params)
    } catch (e) {
      setWfInfo(null)
      setWfParams([])
      setWfError((e as Error)?.message || '获取工作流参数失败')
    } finally {
      setWfLoading(false)
    }
  }, [open, channel, settings.runningHubWorkflowId, apiKey])

  useEffect(() => { loadWorkflow() }, [loadWorkflow])

  /**
   * 拉取模型列表
   * 用户要求模型从对方网站实时获取而非本地写死，这样渠道上新模型无需改代码。
   * RunningHub 由工作流自身决定参数，不需要选模型。
   */
  const reloadModels = useCallback(async () => {
    if (!open) return
    if (!channel || channel.family === 'runninghub') { setModelList([]); setModelError(''); return }
    if (!apiKey) { setModelList([]); setModelError(''); return }
    if (!channel.apiUrl || /example\.invalid/.test(channel.apiUrl)) {
      setModelList([]); setModelError('请先填写接口地址')
      return
    }

    setModelLoading(true)
    setModelError('')
    try {
      const list = await fetchModels(channel, apiKey)
      setModelList(list)
      if (!list.length) {
        setModelError('对方未返回模型列表，可手动填写模型名')
      } else if (!list.includes(settings.activeModel)) {
        // 当前选中的模型不在新列表里，自动切到第一个
        onPickModel(list[0])
      }
    } catch (e) {
      setModelList([])
      setModelError((e as Error)?.message || '获取模型失败')
    } finally {
      setModelLoading(false)
    }
  }, [open, channel, apiKey, settings.activeModel, onPickModel])

  // 渠道或 Key 变化时自动重新拉取
  useEffect(() => { reloadModels() }, [reloadModels])

  const handleGenerate = useCallback(async () => {
    if (!doc || !sourceBitmap) { setError('请先导入图片'); return }
    if (!selection || !selBounds || selBounds.w === 0) { setError('请先框选要修改的区域'); return }
    if (!prompt.trim()) { setError('请输入提示词'); return }
    if (!apiKey) { onNeedKey(channel.id); return }

    setBusy(true)
    setError('')
    setPreview(null)
    setResultLayer(null)

    try {
      // 1. 扩边取上下文
      const box = contextBounds(selBounds, doc.width, doc.height)
      setPhase('准备素材')
      const { dataUrl } = await cropForAI(sourceBitmap, box)

      // 2. 提交生成
      const res = await generate({
        channel,
        apiKey,
        request: {
          prompt: prompt.trim(),
          imageDataUrl: dataUrl,
          model: settings.activeModel || channel.defaultModel || channel.imageModels[0] || '',
          aspectRatio: settings.aspectRatio,
          resolution: settings.resolution,
          extra: {
            appId: settings.runningHubAppId,
            workflowId: settings.runningHubWorkflowId,
            useEdits: settings.openaiUseEdits,
            custom: channel.custom,
          },
        },
        onProgress: (info) => setPhase(info.phase),
      })

      // 3. 取回结果
      setPhase('取回结果')
      const resultBmp = await fetchResultBitmap(res.imageUrl)

      // 4. 按选区蒙版合成
      setPhase('合成中')
      const composed = await composeResult(
        resultBmp, sourceBitmap, box, selection,
        settings.featherRadius, settings.colorMatch
      )

      setPreview(composed)
      setResultLayer({ id: uid('layer'), bitmap: composed })
      setPhase('')
    } catch (e) {
      const msg = e instanceof AIError ? e.message : (e as Error)?.message || '生成失败'
      setError(msg)
      setPhase('')
    } finally {
      setBusy(false)
    }
  }, [doc, sourceBitmap, selection, selBounds, prompt, apiKey, channel, settings, onNeedKey])

  /** 把结果作为新图层插入（不覆盖原像素） */
  const handleApply = useCallback(() => {
    if (!doc || !resultLayer) return
    const layer = createLayer('ai-result', prompt.slice(0, 12) || 'AI 结果', resultLayer.bitmap)
    layer.aiMeta = {
      channelId: channel.id,
      channelLabel: channel.label,
      model: settings.activeModel || channel.defaultModel || '',
      prompt: prompt.trim(),
      createdAt: Date.now(),
    }
    commit('AI 生成', { ...doc, layers: [...doc.layers, layer], activeLayerId: layer.id })
    onClose()
  }, [doc, resultLayer, prompt, channel, settings, commit, onClose])

  return (
    <Sheet open={open} onClose={onClose} title="AI 生成" maxHeight="80vh">
      <div className="ai-panel">
        {/* 选区状态 */}
        <div className="ai-status" data-ok={!!selBounds && selBounds.w > 0}>
          {selBounds && selBounds.w > 0 ? (
            <>
              <CheckCircle2 size={16} />
              <span>已选区 {selBounds.w} × {selBounds.h} px</span>
            </>
          ) : (
            <>
              <AlertCircle size={16} />
              <span>请先在画布上框选区域</span>
            </>
          )}
        </div>

        {/* 渠道 */}
        <div className="ai-field">
          <label className="ai-label">渠道</label>
          <select
            className="ai-select"
            value={settings.activeChannelId}
            onChange={(e) => {
              const id = e.target.value
              const c = getChannel(id)
              onNeedKey(id)
              onPickChannel(id, c?.defaultModel || '')
            }}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>

          {/* 没有任何自定义渠道时给出入口提示 */}
          {channels.filter((c) => c.isUserDefined).length === 0 && (
            <button className="ai-add-channel" type="button" onClick={onAddChannel}>
              <Plus size={14} />
              接入自定义接口（OpenAI 兼容）
            </button>
          )}
        </div>

        {/* 模型：从对方网站自动拉取；RunningHub 不需要选模型 */}
        {channel.family !== 'runninghub' && (
          <div className="ai-field">
            <label className="ai-label">
              模型
              <button
                className="ai-refresh"
                onClick={reloadModels}
                disabled={modelLoading}
                type="button"
              >
                <RefreshCw size={13} className={modelLoading ? 'spinning' : ''} />
                {modelLoading ? '获取中' : '刷新'}
              </button>
            </label>

            {modelList.length > 0 ? (
              <select
                className="ai-select"
                value={settings.activeModel}
                onChange={(e) => onPickModel(e.target.value)}
              >
                {modelList.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                className="ai-input"
                value={settings.activeModel}
                placeholder={modelLoading ? '正在获取模型列表' : '填 API Key 后自动获取，也可手填'}
                onChange={(e) => onPickModel(e.target.value)}
              />
            )}

            {modelError && <div className="ai-hint-warn">{modelError}</div>}
          </div>
        )}

        {/* 提示词 */}
        <div className="ai-field">
          <label className="ai-label">提示词</label>
          <textarea
            className="ai-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述你希望选区内变成什么样"
            rows={3}
          />
          <div className="ai-presets">
            {PRESETS.map((p) => (
              <button key={p} className="ai-chip" onClick={() => setPrompt(p)}>{p}</button>
            ))}
          </div>
        </div>

        {/* 错误 */}
        {error && (
          <div className="ai-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* 进度 */}
        {busy && (
          <div className="ai-progress">
            <Loader2 size={16} className="spin" />
            <span>{phase || '处理中'}</span>
          </div>
        )}

        {/* 结果预览 */}
        {preview && (
          <div className="ai-preview">
            <img
              src={bitmapToUrl(preview)}
              alt="生成结果预览"
              className="ai-preview-img"
            />
            <p className="ai-preview-hint">已按选区蒙版合成，确认后作为新图层插入</p>
          </div>
        )}

        {/* 操作 */}
        <div className="ai-actions">
          {resultLayer ? (
            <>
              <Button variant="ghost" onClick={() => { setPreview(null); setResultLayer(null) }}>
                重新生成
              </Button>
              <Button variant="primary" onClick={handleApply} icon={<Sparkles size={18} />}>
                插入为新图层
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={handleGenerate}
              disabled={busy || !selBounds || selBounds.w === 0}
              icon={busy ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
            >
              {busy ? '生成中' : '开始生成'}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/** ImageBitmap 转可显示的 URL，并缓存避免重复创建 */
const urlCache = new WeakMap<ImageBitmap, string>()
function bitmapToUrl(bmp: ImageBitmap): string {
  let url = urlCache.get(bmp)
  if (!url) {
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    canvas.getContext('2d')!.drawImage(bmp, 0, 0)
    url = canvas.toDataURL('image/png')
    urlCache.set(bmp, url)
  }
  return url
}
