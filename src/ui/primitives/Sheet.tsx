/**
 * 底部抽屉：出现/过渡/消失三态齐全
 * 用 CSS 驱动，退出时保留 DOM 直到动画结束
 *
 * two 变体说明：
 *  - 'blocking'（默认）：全宽遮罩 + 阻止穿透，用于设置、AI 生成这类"专注做一件事"的面板
 *  - 'peek'非遮挡：只占一条高度、不铺遮罩、背景还能点，
 *    用于图层/调整这类"必须一边看画布一边调"的面板。
 *    修图时最忌讳面板把图挡死 —— 看不到图就等于没法调。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
      >
        <div className="sheet-grip" />
        {title && <div className="sheet-title">{title}</div>}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
