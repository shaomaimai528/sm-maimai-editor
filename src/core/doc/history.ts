import type { Doc } from './types'

/**
 * 撤销 / 重做 —— 命令模式 + 增量快照
 *
 * 为什么不存整图快照：手机上一张 4000x3000 的图仅一份 RGBA 就约 46MB，
 * 存 20 步历史会瞬间吃爆内存。所以：
 *  - 普通操作（改参数、增删图层、移动顺序）只存 Doc 的浅结构 diff
 *  - 像素类操作（笔刷、魔术棒）额外存"受影响矩形"快照，不存整图
 */

export interface HistoryEntry {
  label: string
  /** 应用后的文档状态 */
  after: Doc
  /** 应用前的文档状态 */
  before: Doc
}

export class History {
  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  private limit: number

  constructor(limit = 50) {
    this.limit = limit
  }

  push(entry: HistoryEntry) {
    this.past.push(entry)
    if (this.past.length > this.limit) this.past.shift()
    // 新操作产生后，原重做链失效
    this.future.length = 0
  }

  /** 撤销：返回应恢复到的文档；无历史则返回 null */
  undo(current: Doc): Doc | null {
    const entry = this.past.pop()
    if (!entry) return null
    this.future.push(entry)
    return entry.before
  }

  /** 重做：返回应恢复到的文档；无历史则返回 null */
  redo(current: Doc): Doc | null {
    const entry = this.future.pop()
    if (!entry) return null
    this.past.push(entry)
    return entry.after
  }

  canUndo(): boolean { return this.past.length > 0 }
  canRedo(): boolean { return this.future.length > 0 }
  undoLabel(): string | null { return this.past.length ? this.past[this.past.length - 1].label : null }
  redoLabel(): string | null { return this.future.length ? this.future[this.future.length - 1].label : null }

  clear() {
    this.past.length = 0
    this.future.length = 0
  }

  size(): number { return this.past.length }
}
