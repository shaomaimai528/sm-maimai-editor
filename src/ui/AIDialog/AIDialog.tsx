/**
 * AI 生成面板：选区 → 提示词 → 选渠道 → 生成 → 贴回
 * 这是产品的核心工作流界面
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, X, AlertCircle, CheckCircle2, Loader2, RefreshCw, Workflow, Plus } from 'lucide-react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { useEditor } from '../../state/editorStore'
import { allChannels, getChannel } from '../../core/ai/channels'
import { generate, fetchResultBitmap, fetchModels } from '../../core/ai/pipeline'
import { AIError } from '../../core/ai/types'
import {
  contextBounds, cropForAI, composeResult, selectionBounds,
  type ContextBox,
} from '../../core/render/pasteback'
import { createLayer } from '../../core/doc/document'
import { uid } from '../../core/doc/types'
import {
  fetchWorkflow, buildNodeInfoList, promptParamOf,
  type WorkflowInfo, type WorkflowParam,
} from '../../core/ai/workflow'
import { WorkflowParams } from './WorkflowParams'
import { WorkflowPicker } from './WorkflowPicker'
import type { SavedWorkflow } from '../../state/settings'
import { defaultParamValues } from '../../core/ai/workflow'
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
  /** 保存的工作流列表 */
  savedWorkflows: SavedWorkflow[]
  /** 选中某个工作流 */
  onPickWorkflow: (webappId: string) => void
  /** 保存一个工作流 ID（名称可后续补全） */
  onSaveWorkflow: (webappId: string, name?: string, coverUrl?: string) => void
  /** 删除一个工作流 */
  onRemoveWorkflow: (webappId: string) => void
  /** 拉到真实名称后回填 */
  onLearnWorkflow: (webappId: string, name: string, coverUrl?: string) => void
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
  savedWorkflows, onPickWorkflow, onSaveWorkflow, onRemoveWorkflow, onLearnWorkflow,
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

  // RunningHub 工作流
  const [wfInfo, setWfInfo] = useState<WorkflowInfo | null>(null)
  const [wfValues, setWfValues] = useState<Record<string, string>>({})
  const [wfLoading, setWfLoading] = useState(false)
  const [wfError, setWfError] = useState('')

  const doc = useEditor((s) => s.doc)
  const sourceBitmap = useEditor((s) => s.sourceBitmap)
  const selection = useEditor((s) => s.selection)
  const commit = useEditor((s) => s.commit)

  /**
   * onLearnWorkflow 用 ref 间接引用
   *
   * 它是 App 层的 useCallback，依赖整个 settings；
   * 回填工作流名会改 settings，于是它换新引用，
   * 进而让下面的 loadWorkflow 换新引用、useEffect 再跑一次 ——
   * 形成"拉取 → 回填 → 再拉取"的循环。
   * 放进 ref 后 loadWorkflow 不再依赖它，循环断开。
   */
  const learnRef = useRef(onLearnWorkflow)
  learnRef.current = onLearnWorkflow

  const channels = useMemo(() => allChannels(), [settings.userChannels])
  const channel = useMemo(
    () => getChannel(settings.activeChannelId) || channels[0],
    [settings.activeChannelId, channels]
  )
  const selBounds = useMemo(
    () => (selection ? selectionBounds(selection) : null),
    [selection]
  )

  /**
   * 当前预览位的所有权标记
   *
   * 只有"还没插入图层"的合成结果才归面板管，关闭时要主动 close，
   * 否则每生成一次就漏一张全分辨率位图，几次下来手机就撑不住。
   * 一旦插入图层，所有权转移给图层，标记清掉，绝不能在这里 close。
   */
  const ownedBitmapRef = useRef<ImageBitmap | null>(null)

  // 关闭时清理，避免残留内存
  useEffect(() => {
    if (!open) {
      setBusy(false)
      setError('')
      setPhase('')
      setPreview(null)
      setResultLayer(null)
      ownedBitmapRef.current?.close?.()
      ownedBitmapRef.current = null
    }
  }, [open])

  /**
   * 选中 RunningHub 时自动拉取工作流参数
   * 工作流 ID 或 Key 变化都重新拉，因为权限与参数都会随之变化
   */
  const loadWorkflow = useCallback(async () => {
    if (!open) return
    if (channel?.family !== 'runninghub') { setWfInfo(null); setWfValues({}); setWfError(''); return }

    // 优先用选中的工作流，退回到设置里手填的 ID
    const wfId = (settings.activeWorkflowId || settings.runningHubWorkflowId || '').trim()
    // 换了工作流就必须等新参数到位，期间禁止提交
    if (wfInfo && wfInfo.webappId !== wfId) { setWfInfo(null); setWfValues({}) }
    if (!wfId) {
      setWfInfo(null); setWfValues({})
      setWfError('请先选择或添加一个工作流')
      return
    }
    if (!apiKey) {
      setWfInfo(null); setWfValues({})
      setWfError('请先填写该渠道的 API Key')
      return
    }

    setWfLoading(true)
    setWfError('')
    /**
     * 立刻清空上一个工作流的参数
     *
     * 否则切换工作流的那一小段时间里，界面上还挂着旧工作流的参数，
     * 用户以为改的是新工作流、提交的却是旧参数 —— 典型的"参数改了没用"。
     * 清空后界面上是空的加载态，语义明确。
     */
    setWfValues({})
    try {
      const info = await fetchWorkflow(wfId, apiKey, channel.apiUrl)
      setWfInfo(info)
      // 用工作流自带默认值初始化，用户改动只覆盖对应项
      setWfValues(defaultParamValues(info.params))
      // 拿到真实名称后回填到保存列表，方便下次识别
      learnRef.current(info.webappId, info.name, info.coverUrl)
    } catch (e) {
      setWfInfo(null)
      setWfValues({})
      setWfError((e as Error)?.message || '获取工作流参数失败')
    } finally {
      setWfLoading(false)
    }
  }, [open, channel, settings.activeWorkflowId, settings.runningHubWorkflowId, apiKey])

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
    if (!apiKey) { onNeedKey(channel.id); return }

    // RunningHub 必须先拿到工作流参数才允许提交 ——
    // 参数没读到就提交，等于用错的工作流盲跑，会白扣算力
    const isRH = channel?.family === 'runninghub'
    if (isRH && !wfInfo) {
      setError(wfLoading ? '正在读取工作流参数，请稍候' : (wfError || '请先选择工作流'))
      return
    }
    if (!isRH && !prompt.trim()) { setError('请输入提示词'); return }

    setBusy(true)
    setError('')
    setPreview(null)
    setResultLayer(null)

    try {
      // 1. 提交生成
      //
      // RunningHub 不需要"扩边取上下文"：局部重绘的范围由选区蒙版决定，
      // 多送一圈周边的像素只会让模型把周边也重画一遍，反而毁掉原图。
      // 因此这里直接把整张原图交给工作流，贴回时再按蒙版精确合成。
      // 只有走 OpenAI 兼容协议的渠道才需要裁切 + 传 dataURL。
      setPhase('准备素材')
      let imageDataUrl: string | undefined
      let box: ContextBox
      if (isRH) {
        box = { x: 0, y: 0, w: doc.width, h: doc.height }
      } else {
        box = contextBounds(selBounds, doc.width, doc.height)
        imageDataUrl = (await cropForAI(sourceBitmap, box)).dataUrl
      }

      // 提示词落到工作流真正接受它的那个参数上
      const rhValues = { ...wfValues }
      if (isRH && wfInfo) {
        const slot = promptParamOf(wfInfo.params)
        // 参数面板里用户填过就用他填的，否则用底部输入框
        if (slot && !(rhValues[slot.nodeId] || '').trim()) {
          rhValues[slot.nodeId] = prompt.trim()
        }
      }

      const res = await generate({
        channel,
        apiKey,
        request: {
          // RunningHub 的提示词由 nodeInfoList 承载，这里不重复传
          prompt: isRH ? '' : prompt.trim(),
          imageDataUrl,
          model: settings.activeModel || channel.defaultModel || channel.imageModels[0] || '',
          aspectRatio: settings.aspectRatio,
          resolution: settings.resolution,
          extra: {
            // RunningHub：提交工作流 ID 与逐节点参数
            appId: isRH ? (wfInfo?.webappId || settings.runningHubAppId) : settings.runningHubAppId,
            workflowId: isRH ? (wfInfo?.workflowId || '') : settings.runningHubWorkflowId,
            nodeInfoList: isRH && wfInfo ? buildNodeInfoList(wfInfo.params, rhValues) : undefined,
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

      // 上一张还没插入就被新结果顶掉了，先释放，避免连点生成时堆内存
      if (ownedBitmapRef.current && ownedBitmapRef.current !== composed) {
        ownedBitmapRef.current.close?.()
      }
      ownedBitmapRef.current = composed
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
  }, [doc, sourceBitmap, selection, selBounds, prompt, apiKey, channel, settings, onNeedKey, wfInfo, wfValues])

  /** 把结果作为新图层插入（不覆盖原像素） */
  const handleApply = useCallback(() => {
    if (!doc || !resultLayer) return
    // 名字优先用工作流名，没有提示词的 RunningHub 也能一眼认出是哪个工作流出的图
    const title = (prompt.trim() || wfInfo?.name || 'AI 结果').slice(0, 14)
    const layer = createLayer('ai-result', title, resultLayer.bitmap)
    layer.aiMeta = {
      channelId: channel.id,
      channelLabel: channel.label,
      model: settings.activeModel || channel.defaultModel || '',
      prompt: prompt.trim(),
      createdAt: Date.now(),
    }
    commit('AI 生成', { ...doc, layers: [...doc.layers, layer], activeLayerId: layer.id })
    // 位图已归图层所有，交出所有权，关闭面板时不能再释放它
    ownedBitmapRef.current = null
    onClose()
  }, [doc, resultLayer, prompt, channel, settings, commit, onClose, wfInfo])

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

        {/* RunningHub：工作流选择与参数 */}
        {channel?.family === 'runninghub' && (
          <>
            <div className="ai-field">
              <label className="ai-label">工作流</label>
              <WorkflowPicker
                workflows={savedWorkflows}
                activeId={settings.activeWorkflowId}
                onPick={onPickWorkflow}
                onAdd={onSaveWorkflow}
                onRemove={onRemoveWorkflow}
              />
              {wfLoading && (
                <div className="ai-status">
                  <Loader2 size={15} className="spinning" />
                  正在读取工作流参数
                </div>
              )}
              {wfError && <div className="ai-hint-warn">{wfError}</div>}
            </div>

            {wfInfo && (
              <WorkflowParams
                info={wfInfo}
                values={wfValues}
                onChange={(nodeId, v) => setWfValues((prev) => ({ ...prev, [nodeId]: v }))}
                onReset={() => setWfValues(defaultParamValues(wfInfo.params))}
              />
            )}
          </>
        )}

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
              disabled={
                busy ||
                !selBounds || selBounds.w === 0 ||
                // RunningHub 参数没就绪就不让点，避免盲跑白扣算力
                (channel?.family === 'runninghub' && (!wfInfo || wfLoading))
              }
              icon={busy ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
            >
              {busy ? '生成中' : (channel?.family === 'runninghub' && wfLoading ? '读取工作流中' : '开始生成')}
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
