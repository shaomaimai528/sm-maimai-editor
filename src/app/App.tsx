/** 应用外壳：串联画布、工具栏、各面板与文档生命周期 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { CanvasStage } from '../ui/Canvas/CanvasStage'
import { Toolbar } from '../ui/Toolbar/Toolbar'
import { AIDialog } from '../ui/AIDialog/AIDialog'
import { SettingsDialog } from '../ui/Settings/SettingsDialog'
import { LayersDialog } from '../ui/Layers/LayersDialog'
import { AdjustDialog } from '../ui/Adjust/AdjustDialog'
import { Button } from '../ui/primitives/Button'
import { useEditor } from '../state/editorStore'
import { loadSettings, saveSettings, getKeyFor, type AppSettings, DEFAULT_SETTINGS } from '../state/settings'
import { setImageProxy } from '../core/ai/pipeline'
import { setUserChannels, makeCustomChannel, getChannel } from '../core/ai/channels'
import { loadImageFile } from '../core/render/load'
import { renderDoc } from '../core/render/pipeline'
import { createDoc } from '../core/doc/document'
import { encodeCanvas, downloadBlob, suggestFilename, DEFAULT_EXPORT } from '../core/render/export'
import './App.css'

/** 把持久化的用户渠道配置转成运行时 Channel */
function toChannels(s: AppSettings) {
  return (s.userChannels || []).map((uc) =>
    makeCustomChannel({
      id: uc.id,
      label: uc.label || '自定义渠道',
      apiUrl: uc.apiUrl || 'https://example.invalid',
      models: uc.models.split(',').map((m) => m.trim()).filter(Boolean),
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
  )
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showLayers, setShowLayers] = useState(false)
  const [showAdjust, setShowAdjust] = useState(false)
  const [toast, setToast] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const doc = useEditor((s) => s.doc)
  const setDoc = useEditor((s) => s.setDoc)

  // 载入设置
  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s)
      setUserChannels(toChannels(s))
      // 结果图代理需要尽早生效，否则取图时才设就晚了
      setImageProxy(s.imageProxy || '')
      setSettingsLoaded(true)
    })
  }, [])

  // 设置里改了代理地址要立刻生效，不必重开应用
  useEffect(() => {
    setImageProxy(settings.imageProxy || '')
  }, [settings.imageProxy])

  // 用户自建渠道变化时同步到渠道注册表，让 AI 面板能立刻看到
  useEffect(() => {
    setUserChannels(toChannels(settings))
  }, [settings.userChannels])

  const persist = useCallback((s: AppSettings) => {
    setSettings(s)
    saveSettings(s)
  }, [])

  /**
   * 切换渠道
   * 记住每个渠道各自用过的模型，切回来时自动恢复 ——
   * 用户不必每次修图都重选一遍渠道和模型
   */
  const handlePickChannel = useCallback((id: string, model?: string) => {
    const ch = getChannel(id)
    const remembered = settings.lastModelByChannel?.[id]
    const next = model || remembered || ch?.defaultModel || ''
    persist({
      ...settings,
      activeChannelId: id,
      activeModel: next,
      lastModelByChannel: { ...(settings.lastModelByChannel || {}), [id]: next },
    })
  }, [settings, persist])

  /** 选中一个已保存的工作流 */
  const handlePickWorkflow = useCallback((webappId: string) => {
    persist({ ...settings, activeWorkflowId: webappId, runningHubWorkflowId: webappId })
  }, [settings, persist])

  /** 保存一个工作流（名称可能暂时未知，拉到详情后会回填） */
  const handleSaveWorkflow = useCallback((webappId: string, name?: string, coverUrl?: string) => {
    if (settings.savedWorkflows.some((w) => w.webappId === webappId)) {
      handlePickWorkflow(webappId)
      return
    }
    const next = [
      ...settings.savedWorkflows,
      { webappId, name: name || '未命名工作流', coverUrl, savedAt: Date.now() },
    ]
    persist({ ...settings, savedWorkflows: next, activeWorkflowId: webappId, runningHubWorkflowId: webappId })
  }, [settings, persist, handlePickWorkflow])

  /** 删除一个工作流 */
  const handleRemoveWorkflow = useCallback((webappId: string) => {
    const next = settings.savedWorkflows.filter((w) => w.webappId !== webappId)
    const stillActive = settings.activeWorkflowId === webappId
    persist({
      ...settings,
      savedWorkflows: next,
      activeWorkflowId: stillActive ? (next[0]?.webappId || '') : settings.activeWorkflowId,
      runningHubWorkflowId: stillActive ? (next[0]?.webappId || '') : settings.runningHubWorkflowId,
    })
  }, [settings, persist])

  /** 拉到详情后回填真实名称与封面，方便下次一眼认出 */
  const handleLearnWorkflow = useCallback((webappId: string, name: string, coverUrl?: string) => {
    const cur = settings.savedWorkflows.find((w) => w.webappId === webappId)
    if (cur && cur.name === name && cur.coverUrl === coverUrl) return
    if (!cur) {
      handleSaveWorkflow(webappId, name, coverUrl)
      return
    }
    persist({
      ...settings,
      savedWorkflows: settings.savedWorkflows.map((w) =>
        w.webappId === webappId ? { ...w, name, coverUrl } : w
      ),
    })
  }, [settings, persist, handleSaveWorkflow])

  /** 切换模型，同时记到当前渠道名下 */
  const handlePickModel = useCallback((model: string) => {
    persist({
      ...settings,
      activeModel: model,
      lastModelByChannel: {
        ...(settings.lastModelByChannel || {}),
        [settings.activeChannelId]: model,
      },
    })
  }, [settings, persist])

  const toastTimer = useRef<number | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2600)
  }, [])

  const handlePick = useCallback(async (file: File) => {
    try {
      const loaded = await loadImageFile(file)
      const d = createDoc(loaded.width, loaded.height, file.name.replace(/\.[^.]+$/, ''))
      d.layers[0].source = { bitmap: loaded.bitmap }
      setDoc(d, loaded.bitmap)
      showToast(loaded.downsampled ? '图片较大，已自动降采样以保证流畅' : '图片已导入')
    } catch (e) {
      showToast('导入失败：' + ((e as Error).message || '未知错误'))
    }
  }, [setDoc, showToast])

  const handleExport = useCallback(async () => {
    if (!doc) return
    try {
      showToast('正在导出')
      // 导出时按原图全分辨率重放操作链
      const bitmap = await renderDoc(doc, doc.width, doc.height)
      const blob = await encodeCanvas(bitmap, DEFAULT_EXPORT)
      downloadBlob(blob, suggestFilename(doc, DEFAULT_EXPORT))
      showToast('已导出')
    } catch (e) {
      showToast('导出失败：' + ((e as Error).message || '未知错误'))
    }
  }, [doc, showToast])

  const apiKey = useMemo(
    () => getKeyFor(settings, settings.activeChannelId),
    [settings]
  )

  if (!settingsLoaded) return <div className="boot" />

  return (
    <div className="app">
      {doc && <CanvasStage />}

      {!doc && (
        <div className="empty">
          <img className="empty-logo" src="./icons/icon-192.png" alt="SM烧麦麦修图" />
          <h1 className="empty-title">SM烧麦麦修图</h1>
          <p className="empty-sub">导入一张照片开始</p>
          <Button variant="primary" size="lg" icon={<ImagePlus size={20} />} onClick={() => fileRef.current?.click()}>
            选择图片
          </Button>
        </div>
      )}

      {doc && <Toolbar
        onPickImage={() => fileRef.current?.click()}
        onExport={handleExport}
        onOpenSettings={() => setShowSettings(true)}
        onOpenLayers={() => setShowLayers(true)}
        onOpenAI={() => setShowAI(true)}
        onOpenAdjust={() => setShowAdjust(true)}
      />}

      <AIDialog
        open={showAI}
        onClose={() => setShowAI(false)}
        settings={settings}
        apiKey={apiKey}
        onNeedKey={(id) => {
          showToast('请先在设置中填写该渠道的 API Key')
          setShowSettings(true)
        }}
        onPickChannel={handlePickChannel}
        onPickModel={handlePickModel}
        onAddChannel={() => {
          setShowAI(false)
          setShowSettings(true)
        }}
        savedWorkflows={settings.savedWorkflows}
        onPickWorkflow={handlePickWorkflow}
        onSaveWorkflow={handleSaveWorkflow}
        onRemoveWorkflow={handleRemoveWorkflow}
        onLearnWorkflow={handleLearnWorkflow}
      />

      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onChange={persist}
      />

      <LayersDialog open={showLayers} onClose={() => setShowLayers(false)} />
      <AdjustDialog open={showAdjust} onClose={() => setShowAdjust(false)} />

      {toast && <div className="toast">{toast}</div>}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handlePick(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
