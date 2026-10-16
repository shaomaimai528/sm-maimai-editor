/**
 * 画布对话框：自定义画布的像素尺寸与底图方式
 *
 * 三个用途：
 *  1. 导入的图太大/太小，想按目标平台的标准尺寸重做一张
 *  2. 想把图放进更大的画布留白（比如做海报、加边距）
 *  3. 纯色/透明底上从零开始拼图
 *
 * 底图处理三种模式，对齐设计工具的惯用说法：
 *  适配   等比缩放铺满画布，不裁切不拉伸（可能留白）
 *  填充   等比放大到盖满画布，多出来的裁掉（不留白）
 *  拉伸   直接拉伸到画布尺寸（会变形，但位置最"满"）
 */
import { useEffect, useMemo, useState } from 'react'
import { Frame, Lock, Unlock, AlertCircle } from 'lucide-react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { useEditor } from '../../state/editorStore'
import { uid, type Doc, type Layer } from '../../core/doc/types'
import { loadImageFile } from '../../core/render/load'
import './CanvasDialog.css'

interface Props { open: boolean; onClose: () => void }

type FitMode = 'contain' | 'cover' | 'stretch'

/** 常用尺寸预设，省得每次手输 */
const PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: '原图', w: 0, h: 0 },
  { label: '1:1', w: 2048, h: 2048 },
  { label: '4:3', w: 2048, h: 1536 },
  { label: '3:4', w: 1536, h: 2048 },
  { label: '16:9', w: 2560, h: 1440 },
  { label: '9:16', w: 1440, h: 2560 },
]

const MAX_EDGE = 8192
const MIN_EDGE = 16

export function CanvasDialog({ open, onClose }: Props) {
  const doc = useEditor((s) => s.doc)
  const commit = useEditor((s) => s.commit)
  const setSourceBitmap = useEditor((s) => s.setSourceBitmap)

  const [w, setW] = useState(0)
  const [h, setH] = useState(0)
  const [linked, setLinked] = useState(true)
  const [fit, setFit] = useState<FitMode>('contain')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // 每次打开都以当前画布尺寸为起点，不残留上次的输入
  useEffect(() => {
    if (!open || !doc) return
    setW(doc.width)
    setH(doc.height)
    setError('')
  }, [open, doc?.id, doc?.width, doc?.height])

  const ratio = useMemo(
    () => (doc && doc.width && doc.height ? doc.width / doc.height : 1),
    [doc?.width, doc?.height],
  )

  /**
   * 新尺寸相对原尺寸的映射，决定各图层内容怎么摆
   *
   * 注意：这个 useMemo 必须排在下面的 `if (!doc) return null` 之前。
   * 组件在"没有文档 → 导入图片后有文档"时会先少走一个 hook 再多走一个，
   * React 会直接抛 #310（hook 数量不一致）把整个界面打崩。
   */
  const plan = useMemo(() => {
    const dw0 = doc?.width || 1
    const dh0 = doc?.height || 1
    const sx = w / dw0
    const sy = h / dh0
    if (fit === 'stretch') return { dw: w, dh: h, dx: 0, dy: 0, scale: Math.max(sx, sy) }

    const s = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy)
    const dw = Math.round(dw0 * s)
    const dh = Math.round(dh0 * s)
    return {
      dw, dh,
      // 居中摆放：留白与裁切都对称，视觉上最安定
      dx: Math.round((w - dw) / 2),
      dy: Math.round((h - dh) / 2),
      scale: s,
    }
  }, [w, h, fit, doc?.width, doc?.height])

  if (!doc) return null

  /** 锁定比例时联动另一边，并夹到合法范围 */
  const change = (which: 'w' | 'h', value: number) => {
    const v = Math.round(value)
    if (which === 'w') {
      setW(v)
      if (linked) setH(Math.max(MIN_EDGE, Math.round(v / ratio)))
    } else {
      setH(v)
      if (linked) setW(Math.max(MIN_EDGE, Math.round(v * ratio)))
    }
  }

  const validate = (): string => {
    if (!Number.isFinite(w) || !Number.isFinite(h)) return '宽度和高度必须是数字'
    if (w < MIN_EDGE || h < MIN_EDGE) return `尺寸太小，最小 ${MIN_EDGE} 像素`
    if (w > MAX_EDGE || h > MAX_EDGE) return `尺寸太大，单边最多 ${MAX_EDGE} 像素`
    if (w * h > 40_000_000) return '总像素超过 4000 万，手机渲染会非常卡'
    return ''
  }

  const apply = async () => {
    const msg = validate()
    if (msg) { setError(msg); return }

    setBusy(true)
    setError('')
    try {
      // 原图（全分辨率）也要跟着换，否则贴回时按老尺寸裁切会错位
      const source = useEditor.getState().sourceBitmap
      let nextSource = source
      if (source) {
        const c = new OffscreenCanvas(w, h)
        const cx = c.getContext('2d')!
        cx.imageSmoothingEnabled = true
        cx.imageSmoothingQuality = 'high'
        cx.drawImage(source, 0, 0, source.width, source.height, plan.dx, plan.dy, plan.dw, plan.dh)
        nextSource = await createImageBitmap(c)
      }

      /**
       * 图层像素按同样的映射重摆
       * 每个图层都重新画一张 —— 直接改 doc.width/height 而不管像素，
       * 会让所有图层按新尺寸被拉伸，画面全毁。
       */
      const layers: Layer[] = []
      for (const l of doc.layers) {
        const bmp = l.source?.bitmap
        if (!bmp) { layers.push(l); continue }

        const c = new OffscreenCanvas(w, h)
        const cx = c.getContext('2d')!
        cx.imageSmoothingEnabled = true
        cx.imageSmoothingQuality = 'high'
        cx.drawImage(bmp, 0, 0, bmp.width, bmp.height, plan.dx, plan.dy, plan.dw, plan.dh)

        // 蒙版与图层同尺寸，一起重画，否则遮罩会对不上内容
        let mask = l.mask
        if (l.mask?.data) {
          const mc = new OffscreenCanvas(w, h)
          const mx = mc.getContext('2d')!
          // 先把灰度蒙版画成图，再由画布缩放，避免手写插值
          const tmp = new OffscreenCanvas(l.mask.width, l.mask.height)
          const tctx = tmp.getContext('2d')!
          const img = tctx.createImageData(l.mask.width, l.mask.height)
          for (let i = 0, p = 0; i < l.mask.data.length; i++, p += 4) {
            img.data[p] = img.data[p + 1] = img.data[p + 2] = l.mask.data[i]
            img.data[p + 3] = 255
          }
          tctx.putImageData(img, 0, 0)
          mx.drawImage(tmp, 0, 0, l.mask.width, l.mask.height, plan.dx, plan.dy, plan.dw, plan.dh)
          const out = mx.getImageData(0, 0, w, h).data
          const gray = new Uint8ClampedArray(w * h)
          for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = out[p]
          mask = { data: gray, width: w, height: h }
        }

        layers.push({ ...l, source: { ...l.source, bitmap: await createImageBitmap(c) }, mask })
      }

      const next: Doc = { ...doc, width: w, height: h, layers }
      commit('调整画布尺寸', next)
      /**
       * 基准图单独同步，不能走 setDoc
       * setDoc 是为"换一张图"准备的，它会清空历史与选区 ——
       * 用在这里会让上面刚 commit 的那一步立刻丢失，撤销按不动。
       */
      setSourceBitmap(nextSource)
      onClose()
    } catch (e) {
      setError('处理失败：' + ((e as Error)?.message || '未知错误'))
    } finally {
      setBusy(false)
    }
  }

  const scalePct = Math.round((plan.scale || 1) * 100)

  return (
    <Sheet open={open} onClose={onClose} title="画布" maxHeight="76vh">
      <div className="cv-dialog">
        <div className="cv-note">
          <Frame size={15} />
          <span>当前 {doc.width} × {doc.height} px</span>
        </div>

        <div className="cv-presets">
          {PRESETS.map((p) => {
            const pw = p.w || doc.width
            const ph = p.h || doc.height
            const on = pw === w && ph === h
            return (
              <button
                key={p.label}
                className="cv-preset"
                data-on={on}
                onClick={() => {
                  // 预设走的是"目标比例"，用原图长边推尺寸，避免把小图放大到糊
                  if (!p.w) { setW(doc.width); setH(doc.height); return }
                  const long = Math.max(doc.width, doc.height)
                  const s = long / Math.max(p.w, p.h)
                  setW(Math.round(p.w * s))
                  setH(Math.round(p.h * s))
                }}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        <div className="cv-fields">
          <label className="cv-field">
            <span>宽度</span>
            <input
              type="number"
              inputMode="numeric"
              value={w}
              min={MIN_EDGE}
              max={MAX_EDGE}
              onChange={(e) => change('w', Number(e.target.value))}
            />
          </label>

          <button
            className="cv-link"
            data-on={linked}
            onClick={() => setLinked((v) => !v)}
            aria-label={linked ? '解除比例锁定' : '锁定原图比例'}
            title={linked ? '已锁定原图比例' : '比例自由'}
          >
            {linked ? <Lock size={15} /> : <Unlock size={15} />}
          </button>

          <label className="cv-field">
            <span>高度</span>
            <input
              type="number"
              inputMode="numeric"
              value={h}
              min={MIN_EDGE}
              max={MAX_EDGE}
              onChange={(e) => change('h', Number(e.target.value))}
            />
          </label>
        </div>

        <div className="cv-fit">
          <span className="cv-fit-label">底图</span>
          <div className="cv-fit-opts">
            {([
              { id: 'contain' as const, label: '适配', hint: '等比缩放，不裁切' },
              { id: 'cover' as const, label: '填充', hint: '等比放大，裁掉多余' },
              { id: 'stretch' as const, label: '拉伸', hint: '直接贴合，会变形' },
            ]).map((o) => (
              <button
                key={o.id}
                className="cv-fit-opt"
                data-on={fit === o.id}
                onClick={() => setFit(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="cv-plan">
          内容按 {scalePct}% 缩放
          {fit === 'contain' && (plan.dx > 0 || plan.dy > 0) && '，四周留白'}
          {fit === 'cover' && '，超出部分裁掉'}
        </div>

        {error && (
          <div className="cv-error">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        <div className="cv-actions">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={apply} disabled={busy || w === doc.width && h === doc.height}>
            {busy ? '处理中' : '应用尺寸'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
