import { maskFromPolygon, type MaskBuffer } from './mask'

/** 自由套索：累积手指轨迹点，闭合后生成选区 */
export class LassoTool {
  private points: Array<{ x: number; y: number }> = []

  begin(x: number, y: number) {
    this.points = [{ x, y }]
  }

  move(x: number, y: number, minDist = 2) {
    const last = this.points[this.points.length - 1]
    if (!last) { this.points.push({ x, y }); return }
    // 抽稀：过密的点既无意义又拖慢渲染
    const dx = x - last.x
    const dy = y - last.y
    if (dx * dx + dy * dy >= minDist * minDist) this.points.push({ x, y })
  }

  /** 闭合路径并生成抗锯齿蒙版 */
  finish(width: number, height: number): MaskBuffer | null {
    if (this.points.length < 3) return null
    const m = maskFromPolygon(this.points, width, height)
    this.points = []
    return m
  }

  getPoints() { return this.points }
  isEmpty() { return this.points.length === 0 }
  cancel() { this.points = [] }
}
