import { maskFromRect, type MaskBuffer } from './mask'

/**
 * 矩形选框
 *
 * 从起点拖到终点，松手生成矩形选区。
 * 与套索共用同一套 MaskBuffer 表示，因此羽化/反选/扩张等功能全部通用。
 *
 * 支持比例锁定：选定 1:1 / 16:9 等比例后，拖出来的框始终符合该比例，
 * 适合"我要生成一张方图""这块区域要按 16:9 出图"这类明确诉求 ——
 * 手拖很难拖准比例，锁定之后 AI 那边收到的宽高比也就稳定了。
 */

/** 比例锁：null 为自由框选 */
export type AspectLock = number | null

export class RectTool {
  private start: { x: number; y: number } | null = null
  private end: { x: number; y: number } | null = null
  /** 当前比例锁，1 表示正方形 */
  private lock: AspectLock = null

  setAspectLock(lock: AspectLock) {
    // 非法比例直接落回自由模式，避免算出 NaN 尺寸
    this.lock = lock && Number.isFinite(lock) && lock > 0 ? lock : null
  }

  getAspectLock(): AspectLock {
    return this.lock
  }

  begin(x: number, y: number) {
    this.start = { x, y }
    this.end = { x, y }
  }

  move(x: number, y: number) {
    if (!this.start) return
    this.end = { x, y }
  }

  /**
   * 按比例锁修正终点
   *
   * 以拖动的主方向为准反推另一边，这样手感是"跟着手指的这个方向走"，
   * 而不是两个方向互相打架。
   */
  private lockedEnd(): { x: number; y: number } | null {
    const s = this.start
    const e = this.end
    if (!s || !e || !this.lock) return e

    const dx = e.x - s.x
    const dy = e.y - s.y
    const signX = dx < 0 ? -1 : 1
    const signY = dy < 0 ? -1 : 1
    const w = Math.abs(dx)
    const h = Math.abs(dy)

    // 以较长的那条边为准，保证框不会缩到比手指划的还小
    if (w / Math.max(1e-6, h) >= this.lock) {
      return { x: e.x, y: s.y + signY * (w / this.lock) }
    }
    return { x: s.x + signX * (h * this.lock), y: e.y }
  }

  /** 当前矩形（用于绘制预览），无拖动时返回 null */
  getRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.start || !this.end) return null
    const e = this.lockedEnd()!
    const x = Math.min(this.start.x, e.x)
    const y = Math.min(this.start.y, e.y)
    const w = Math.abs(e.x - this.start.x)
    const h = Math.abs(e.y - this.start.y)
    // 过小的拖动视为误触，不生成选区
    if (w < 3 || h < 3) return null
    return { x, y, w, h }
  }

  finish(width: number, height: number): MaskBuffer | null {
    const r = this.getRect()
    this.start = null
    this.end = null
    if (!r) return null
    return maskFromRect(r.x, r.y, r.w, r.h, width, height)
  }

  getStart() { return this.start }
  isEmpty() { return !this.start }
  cancel() { this.start = null; this.end = null }
}
