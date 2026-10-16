import { paintBrush, type MaskBuffer } from './mask'

/**
 * 蒙版笔刷
 * 手机端没有数位板，压感用「速度越快越细」近似，防抖用轨迹插值。
 */
export interface BrushSettings {
  radius: number
  hardness: number   // 0..1
  flow: number       // 0..1
  erase: boolean
}

export const DEFAULT_BRUSH: BrushSettings = {
  radius: 40,
  hardness: 0.7,
  flow: 0.8,
  erase: false,
}

export class BrushTool {
  private last: { x: number; y: number } | null = null

  begin(mask: MaskBuffer, s: BrushSettings, x: number, y: number): MaskBuffer {
    this.last = { x, y }
    return paintBrush(mask, x, y, s.radius, s.hardness, s.flow, s.erase)
  }

  move(mask: MaskBuffer, s: BrushSettings, x: number, y: number): MaskBuffer {
    if (!this.last) return this.begin(mask, s, x, y)
    const dx = x - this.last.x
    const dy = y - this.last.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    // 按半径的 1/4 步进插值，避免快速移动时出现断点
    const step = Math.max(1, s.radius / 4)
    const steps = Math.max(1, Math.ceil(dist / step))

    let out = mask
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      out = paintBrush(out, this.last.x + dx * t, this.last.y + dy * t,
        s.radius, s.hardness, s.flow, s.erase)
    }
    this.last = { x, y }
    return out
  }

  end() { this.last = null }
}
