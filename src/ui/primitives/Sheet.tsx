/**
 * 底部抽屉：出现/过渡/消失三态齐全
 * 用 CSS 驱动，退出时保留 DOM 直到动画结束
 *
 * two 变体说明：
 *  - 'blocking'（默认）：全宽遮罩 + 阻止穿透，用于设置、AI 生成这类"专注做一件事"的面板
 *  - 'peek'非遮挡：只占一条高度、不铺遮罩、背景还能点，
 *    用于图层/调整这类"必须一边看画布一边调"的面板。
 *    修图时最忌讳面板把图挡死 —— 看不到图就等于没法调。
 *
 * 关闭方式（务必保持三条都可用）：
 *  1. 右上角关闭按钮 —— peek 没有遮罩可点，这是它唯一的显式出口，
 *     早期版本漏了这个按钮，面板一旦打开就再也关不掉
 *  2. 点遮罩（仅 blocking）
 *  3. Esc 键 —— 桌面端与带键盘的平板的习惯操作
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useEditor } from '../../state/editorStore'
import './Sheet.css'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** 抽屉高度，默认自适应 */
  maxHeight?: string
  /**
   * blocking = 铺满遮罩、独占交互（默认）
   * peek     = 不铺遮罩、不锁背景，可一边看画布一边操作
   */
  variant?: 'blocking' | 'peek'
}

export function Sheet({ open, onClose, title, children, maxHeight = '70vh', variant = 'blocking' }: Props) {
  const [visible, setVisible] = useState(open)
  const [state, setState] = useState<'entering' | 'entered' | 'exiting'>('entered')
  const timer = useRef<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const setBottomInset = useEditor((s) => s.setBottomInset)

  /**
   * peek 面板要把自己占的高度报给画布
   *
   * 用 ResizeObserver 而不是量一次：面板内容会变长变短（图层多了、加了蒙版行），
   * 高度跟着变，画布也必须跟着让位，否则多出来的那几行又会盖住图片。
   */
  useLayoutEffect(() => {
    if (variant !== 'peek') return
    const el = panelRef.current
    if (!el) return

    const report = () => {
      // 收起过程中面板仍在 DOM 里，但已经不该占位了
      const h = open && state !== 'exiting' ? el.getBoundingClientRect().height : 0
      setBottomInset(Math.round(h))
    }

    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => {
      ro.disconnect()
      setBottomInset(0)
    }
  }, [variant, open, state, setBottomInset, visible])

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)

    if (open) {
      setVisible(true)
      setState('entering')
      // 下一帧切到 entered，让 CSS 过渡真正发生
      timer.current = window.setTimeout(() => setState('entered'), 16)
    } else if (visible) {
      setState('exiting')
      // 等退出动画播完再卸载
      timer.current = window.setTimeout(() => {
        setVisible(false)
        setState('entered')
      }, 260)
    }
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [open, visible])

  // 打开时锁定背景滚动（peek 变体不锁，用户还要操作画布）
  useEffect(() => {
    if (!open || variant === 'peek') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open, variant])

  /**
   * Esc 关闭
   *
   * 只在最上层那一个面板上生效：多个面板同时开着时，
   * 若每个都监听，一次 Esc 会把它们全部关掉，用户只是想去掉最上面那层。
   * 用「最后打开的最先响应」判定，靠 DOM 顺序找出最靠后的 sheet。
   */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const roots = Array.from(document.querySelectorAll('.sheet-root'))
      const mine = panelRef.current?.closest('.sheet-root')
      if (!mine || roots[roots.length - 1] !== mine) return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!visible) return null

  return (
    <div className="sheet-root" data-state={state} data-variant={variant}>
      {/* peek 变体不铺遮罩，画布保持可见可点 */}
      {variant === 'blocking' && <div className="sheet-scrim" onClick={onClose} />}
      <div
        className="sheet-panel"
        ref={panelRef}
        style={{ maxHeight }}
        role="dialog"
        aria-modal={variant === 'blocking'}
        aria-label={title}
      >
        <div className="sheet-grip" />
        <div className="sheet-head">
          {title ? <div className="sheet-title">{title}</div> : <span />}
          {/*
            显式关闭按钮
            peek 变体没有遮罩可点，缺了它面板就永远关不掉；
            blocking 变体虽然有遮罩，但手机上误触遮罩容易关错，
            给一个明确的出口更稳妥。
          */}
          <button className="sheet-close" onClick={onClose} type="button" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
