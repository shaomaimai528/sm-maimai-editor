/**
 * 按钮：三态动画齐全 + 微交互
 * 出现(enter) / 过渡(transition) / 消失(exit) 都不缺
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import './Button.css'

type Variant = 'primary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  children?: ReactNode
  /** 首次挂载时播放出现动画 */
  animateIn?: boolean
}

export function Button({
  variant = 'ghost',
  size = 'md',
  icon,
  children,
  animateIn = true,
  className = '',
  ...rest
}: Props) {
  const [mounted, setMounted] = useState(!animateIn)

  useEffect(() => {
    if (!animateIn) return
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [animateIn])

  return (
    <button
      {...rest}
      data-variant={variant}
      data-size={size}
      data-mounted={mounted ? 'true' : 'false'}
      className={`btn ${className}`}
    >
      {icon && <span className="btn-icon">{icon}</span>}
      {children && <span className="btn-label">{children}</span>}
    </button>
  )
}
