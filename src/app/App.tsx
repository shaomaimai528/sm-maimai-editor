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
import { loadImageFile } from '../core/render/load'
import { makeProxy, renderDoc } from '../core/render/pipeline'
import { createDoc } from '../core/doc/document'
import { encodeCanvas, downloadBlob, suggestFilename, DEFAULT_EXPORT } from '../core/render/export'
import './App.css'

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
  const setProxy = useEditor((s) => s.setProxy)
  const proxy = useEditor((s) => s.proxy)

  // 载入设置
  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s)
      setSettingsLoaded(true)
    })
  }, [])

  const persist = useCallback((s: AppSettings) => {
    setSettings(s)
    saveSettings(s)
  }, [])

  // 暴露给 AIDialog 的渠道/模型切换（避免把 settings 全量透传下去）
  useEffect(() => {
    ;(window as any).__dshSetChannel = (id: string, model: string) => {
      persist({ ...settings, activeChannelId: id, activeModel: model })
    }
    ;(window as any).__dshSetModel = (model: string) => {
      persist({ ...settings, activeModel: model })
    }
  }, [settings, persist])

  // 文档变化时重建代理图（代理图只依赖源图，不依赖图层参数）
  useEffect(() => {
    if (!doc) return
    const base = doc.layers[0]?.source?.bitmap
    if (!base) return
    let cancelled = false
    makeProxy(base).then((p) => {
      if (!cancelled) setProxy(p)
    })
    return () => { cancelled = true }
  }, [doc?.layers[0]?.source?.bitmap, setProxy])

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
          <div className="empty-icon"><ImagePlus size={40} /></div>
          <h1 className="empty-title">AI 修图</h1>
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
