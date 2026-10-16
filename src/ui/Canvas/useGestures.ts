/**
 * 手势：双指缩放旋转、单指平移、长按看原图
 * 手机端这是核心交互，不是附属功能
 */
import { useEffect, useRef, useCallback } from 'react'

export interface GestureState {
  zoom: number
  panX: number
  panY: number
}

interface Options {
  onTransform: (s: Partial<GestureState>) => void
  onLongPress?: () => void
  onLongPressEnd?: () => void
  onTap?: (x: number, y: number) => void
  enabled?: boolean
}

export function useGestures(
  el: HTMLElement | null,
  { onTransform, onLongPress, onLongPressEnd, onTap, enabled = true }: Options
) {
  const state = useRef({
    pointers: new Map<number, { x: number; y: number }>(),
    lastDist: 0,
    lastCenter: { x: 0, y: 0 },
    longPressTimer: 0,
    didLongPress: false,
    moved: false,
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

    const onDown = (e: PointerEvent) => {
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      s.moved = false

      if (s.pointers.size === 1) {
        // 长按看原图
        s.didLongPress = false
        s.longPressTimer = window.setTimeout(() => {
          if (!s.moved) {
            s.didLongPress = true
            onLongPress?.()
          }
        }, 380)
      }

      if (s.pointers.size === 2) {
        if (s.longPressTimer) window.clearTimeout(s.longPressTimer)
        const [a, b] = [...s.pointers.values()]
        s.lastDist = dist(a, b)
        s.lastCenter = center(a, b)
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!s.pointers.has(e.pointerId)) return
      const prev = s.pointers.get(e.pointerId)!
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 2) {
        s.moved = true
        if (s.longPressTimer && !s.didLongPress) {
          window.clearTimeout(s.longPressTimer)
        }
      }

      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()]
        const d = dist(a, b)
        const c = center(a, b)

        if (s.lastDist > 0) {
          const scale = d / s.lastDist
          onTransform({
            zoom: scale,
            panX: c.x - s.lastCenter.x,
            panY: c.y - s.lastCenter.y,
          })
        }
        s.lastDist = d
        s.lastCenter = c
      } else if (s.pointers.size === 1 && s.moved) {
        onTransform({
          panX: e.clientX - prev.x,
          panY: e.clientY - prev.y,
        })
      }
    }

    const onUp = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId)
      if (s.longPressTimer) window.clearTimeout(s.longPressTimer)

      if (s.didLongPress) {
        onLongPressEnd?.()
        s.didLongPress = false
      } else if (!s.moved && s.pointers.size === 0) {
        onTap?.(e.clientX, e.clientY)
      }

      if (s.pointers.size < 2) s.lastDist = 0
      if (s.pointers.size === 0) s.moved = false
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      reset()
    }
  }, [el, enabled, onTransform, onLongPress, onLongPressEnd, onTap, reset])
}
