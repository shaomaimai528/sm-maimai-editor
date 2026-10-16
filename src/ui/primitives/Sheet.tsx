/**
 * 底部抽屉：出现/过渡/消失三态齐全
 * 用 CSS 驱动，退出时保留 DOM 直到动画结束
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import './Sheet.css'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** 抽屉高度，默认自适应 */
  maxHeight?: string
}

export function Sheet({ open, onClose, title, children, maxHeight = '70vh' }: Props) {
  const [visible, setVisible] = useState(open)
  const [state, setState] = useState<'entering' | 'entered' | 'exiting'>('entered')
  const timer = useRef<number | null>(null)

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

  // 打开时锁定背景滚动
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!visible) return null

  return (
    <div className="sheet-root" data-state={state}>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet-panel" style={{ maxHeight }} role="dialog" aria-modal="true">
        <div className="sheet-grip" />
        {title && <div className="sheet-title">{title}</div>}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
