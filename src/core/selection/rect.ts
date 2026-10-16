import { maskFromRect, type MaskBuffer } from './mask'

/**
 * 矩形选框
 *
 * 从起点拖到终点，松手生成矩形选区。
 * 与套索共用同一套 MaskBuffer 表示，因此羽化/反选/扩张等功能全部通用。
 */
export class RectTool {
  private start: { x: number; y: number } | null = null
  private end: { x: number; y: number } | null = null

  begin(x: number, y: number) {
    this.start = { x, y }
    this.end = { x, y }
  }

  move(x: number, y: number) {
    if (!this.start) return
    this.end = { x, y }
  }

  /** 当前矩形（用于绘制预览），无拖动时返回 null */
  getRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.start || !this.end) return null
    const x = Math.min(this.start.x, this.end.x)
    const y = Math.min(this.start.y, this.end.y)
    const w = Math.abs(this.end.x - this.start.x)
    const h = Math.abs(this.end.y - this.start.y)
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
