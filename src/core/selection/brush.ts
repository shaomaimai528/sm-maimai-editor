import { paintBrush, type MaskBuffer } from './mask'

/**
 * 把整笔的结果按不透明度封顶
 *
 * PS 里 flow 决定单次浓度、opacity 决定整笔上限：
 * 来回涂抹可以靠 flow 叠加，但不会超过 opacity。
 * 这里的做法是：拿这一笔起始时的蒙版做底，
 * 笔迹结果按 opacity 在「底」与「当前」之间插值。
 */
function applyOpacityCap(
  current: MaskBuffer,
  base: MaskBuffer | null,
  s: BrushSettings,
): MaskBuffer {
  const op = Math.max(0, Math.min(1, s.opacity))
  if (!base || op >= 0.999) return current
  const out = new Uint8ClampedArray(current.data.length)
  const src = s.erase ? base.data : base.data
  for (let i = 0; i < out.length; i++) {
    if (s.erase) {
      // 擦除：以底的浓度为准，最多擦掉 opacity 的比例
      out[i] = src[i] * (1 - op) + current.data[i] * op
    } else {
      const limit = src[i] + (255 - src[i]) * op
      out[i] = Math.min(current.data[i], limit)
    }
  }
  return { data: out, width: current.width, height: current.height }
}

/**
 * 蒙版笔刷
 * 手机端没有数位板，压感用「速度越快越细」近似，防抖用轨迹插值。
 */
export interface BrushSettings {
  radius: number
  hardness: number   // 0..1
  flow: number       // 0..1，单次落笔的浓度
  /** 0..1，整笔能盖到的上限；与 flow 的区别同 PS：flow 可反复叠加，opacity 封顶 */
  opacity: number
  erase: boolean
  /**
   * 落笔推向的值
   *  255 = 涂白：选区语义为"选中"，蒙版语义为"显示"
   *    0 = 涂黑：选区语义为"排除"，蒙版语义为"遮住"
   */
  target?: 0 | 255
}

export const DEFAULT_BRUSH: BrushSettings = {
  radius: 40,
  hardness: 0.7,
  flow: 0.8,
  opacity: 1,
  erase: false,
}

export class BrushTool {
  private last: { x: number; y: number } | null = null

  /** 一笔开始时的蒙版快照，用来实现不透明度封顶 */
  private strokeBase: MaskBuffer | null = null

  begin(mask: MaskBuffer, s: BrushSettings, x: number, y: number): MaskBuffer {
    this.last = { x, y }
    this.strokeBase = { data: new Uint8ClampedArray(mask.data), width: mask.width, height: mask.height }
    return paintBrush(mask, x, y, s.radius, s.hardness, s.flow, s.erase, s.target ?? 255)
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
        s.radius, s.hardness, s.flow, s.erase, s.target ?? 255)
    }
    this.last = { x, y }
    return applyOpacityCap(out, this.strokeBase, s)
  }

  end() {
    this.last = null
    this.strokeBase = null
  }
}
