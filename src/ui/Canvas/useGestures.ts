/**
 * 手势：双指缩放、单指平移、长按看原图、双击放大
 *
 * 手机端这是核心交互。要做到"丝滑"，关键在于：
 *  1. 缩放围绕手指中点，而不是画布中心 —— 否则图片会跑掉
 *  2. zoom 与 pan 必须作为一次原子更新提交，否则两者互相覆盖
 *  3. 手势期间暂停长按/点击判定，避免误触发
 *  4. 松手后有惯性，符合物理直觉
 */
import { useEffect, useRef, useCallback } from 'react'

export interface GestureState {
  zoom: number
  panX: number
  panY: number
}

/** 围绕某点缩放时的位移补偿 */
export interface ZoomAtPoint {
  zoom: number
  factor: number
  /** 缩放锚点（相对元素左上角） */
  cx: number
  cy: number
}

interface Options {
  /** 平移增量 */
  onPan?: (dx: number, dy: number) => void
  /** 围绕锚点缩放 */
  onZoomAt?: (z: ZoomAtPoint) => void
  /** 双击（传点击位置） */
  onDoubleTap?: (x: number, y: number) => void
  onLongPress?: () => void
  onLongPressEnd?: () => void
  onTap?: (x: number, y: number) => void
  enabled?: boolean
}

export function useGestures(
  el: HTMLElement | null,
  { onPan, onZoomAt, onDoubleTap, onLongPress, onLongPressEnd, onTap, enabled = true }: Options
) {
  // 回调放进 ref，避免每次重渲染都重建事件监听（这是卡顿的主因之一）
  const cb = useRef({ onPan, onZoomAt, onDoubleTap, onLongPress, onLongPressEnd, onTap })
  cb.current = { onPan, onZoomAt, onDoubleTap, onLongPress, onLongPressEnd, onTap }

  const state = useRef({
    pointers: new Map<number, { x: number; y: number }>(),
    lastDist: 0,
    lastCenter: { x: 0, y: 0 },
    longPressTimer: 0,
    didLongPress: false,
    moved: false,
    // 惯性
    vx: 0,
    vy: 0,
    lastT: 0,
    lastTapT: 0,
    lastTapX: 0,
    lastTapY: 0,
    raf: 0,
  })

  const reset = useCallback(() => {
    const s = state.current
    s.pointers.clear()
    s.lastDist = 0
    s.moved = false
    s.didLongPress = false
    if (s.longPressTimer) window.clearTimeout(s.longPressTimer)
  }, [])

  useEffect(() => {
    if (!el || !enabled) return

    const s = state.current

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y)
    const center = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    })

    /** 相对元素左上角的坐标，用于计算缩放锚点 */
    const local = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect()
      return { x: clientX - r.left, y: clientY - r.top }
    }

    const stopInertia = () => {
      if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0 }
      s.vx = 0; s.vy = 0
    }

    const onDown = (e: PointerEvent) => {
      stopInertia()
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      s.moved = false
      s.lastT = performance.now()

      if (s.pointers.size === 1) {
        // 长按看原图
        s.didLongPress = false
        s.longPressTimer = window.setTimeout(() => {
          if (!s.moved) {
            s.didLongPress = true
            cb.current.onLongPress?.()
          }
        }, 380)
      }

      if (s.pointers.size === 2) {
        if (s.longPressTimer) window.clearTimeout(s.longPressTimer)
        s.didLongPress = false
        const [a, b] = [...s.pointers.values()]
        s.lastDist = dist(a, b)
        s.lastCenter = center(a, b)
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!s.pointers.has(e.pointerId)) return
      const prev = s.pointers.get(e.pointerId)!
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y

      if (Math.hypot(dx, dy) > 2) {
        s.moved = true
        if (s.longPressTimer && !s.didLongPress) {
          window.clearTimeout(s.longPressTimer)
        }
      }

      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()]
        const d = dist(a, b)
        const c = center(a, b)

        if (s.lastDist > 0 && d > 0) {
          // 缩放围绕手指中点：把锚点换算成元素内坐标，
          // 由上层按 (锚点 - 中心) * (1 - factor) 补偿位移
          const p = local(c.x, c.y)
          cb.current.onZoomAt?.({
            zoom: d / s.lastDist,
            factor: d / s.lastDist,
            cx: p.x,
            cy: p.y,
          })
        }
        // 双指平移：中点也在动，一并提交
        if (s.lastCenter.x || s.lastCenter.y) {
          const mdx = c.x - s.lastCenter.x
          const mdy = c.y - s.lastCenter.y
          if (mdx || mdy) cb.current.onPan?.(mdx, mdy)
        }
        s.lastDist = d
        s.lastCenter = c
      } else if (s.pointers.size === 1 && s.moved) {
        cb.current.onPan?.(dx, dy)
        // 记录速度用于惯性
        const now = performance.now()
        const dt = Math.max(1, now - s.lastT)
        s.vx = dx / dt * 16
        s.vy = dy / dt * 16
        s.lastT = now
      }
    }

    /** 松手惯性：速度衰减到停 */
    const startInertia = () => {
      if (Math.hypot(s.vx, s.vy) < 0.6) return
      const step = () => {
        s.vx *= 0.94
        s.vy *= 0.94
        if (Math.hypot(s.vx, s.vy) < 0.3) { s.raf = 0; return }
        cb.current.onPan?.(s.vx, s.vy)
        s.raf = requestAnimationFrame(step)
      }
      s.raf = requestAnimationFrame(step)
    }

    const onUp = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId)
      if (s.longPressTimer) window.clearTimeout(s.longPressTimer)

      if (s.didLongPress) {
        cb.current.onLongPressEnd?.()
        s.didLongPress = false
      } else if (!s.moved && s.pointers.size === 0) {
        // 双击判定：两次点击间隔 300ms 内且位置接近
        const now = performance.now()
        const isDouble = now - s.lastTapT < 300 &&
          Math.hypot(e.clientX - s.lastTapX, e.clientY - s.lastTapY) < 30

        if (isDouble) {
          cb.current.onDoubleTap?.(e.clientX, e.clientY)
          s.lastTapT = 0
        } else {
          s.lastTapT = now
          s.lastTapX = e.clientX
          s.lastTapY = e.clientY
          cb.current.onTap?.(e.clientX, e.clientY)
        }
      }

      if (s.pointers.size < 2) s.lastDist = 0
      if (s.pointers.size === 0) {
        s.moved = false
        // 单指快速滑动后松手 —— 走惯性
        if (Math.hypot(s.vx, s.vy) > 1) startInertia()
      }
    }

    // touch-action 必须由 CSS/属性设为 none，否则浏览器会先做原生滚动
    el.addEventListener('pointerdown', onDown, { passive: true })
    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)

    return () => {
      stopInertia()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      reset()
    }
  }, [el, enabled, reset])
}
