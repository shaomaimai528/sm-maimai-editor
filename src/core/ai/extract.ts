/**
 * 四族协议共用的"脏活"工具
 *
 * 这些逻辑全部从两个 PS 插件的压缩 bundle 中逆向提取。
 * 各 AI 平台的返回结构极不稳定（字段名漂移、容器层层嵌套），
 * 原插件之所以能长期可用，靠的就是这种"宽进严出"的容错解析。
 * 直接照搬这套策略，不自行发明。
 */

import { AIError } from './types'

/* ------------------------------------------------------------------
 * 状态归一化
 * 注意：状态值同时存在数字与字符串两种形态，必须先转字符串再大写比对
 * ------------------------------------------------------------------ */

const PENDING = ['0', 'PENDING', 'RUNNING', 'PROCESSING', 'QUEUED', 'QUEUE', 'WAITING',
  'IN_PROGRESS', 'CREATED', 'SUBMITTED', '待处理', '运行中', '排队', '处理中', '等待中', '未完成']
const SUCCESS = ['1', 'SUCCESS', 'SUCCEEDED', 'SUCCEED', 'OK', 'DONE', 'COMPLETE', 'COMPLETED',
  'FINISHED', '成功', '请求成功']
const FAILED = ['-1', '2', 'FAIL', 'FAILED', 'FAILURE', 'ERROR', 'EXCEPTION', 'CANCELLED',
  'CANCELED', 'REJECTED', 'TIMEOUT', 'TIMED_OUT', '失败', '错误', '异常', '取消']

export type NormStatus = 'pending' | 'success' | 'failed' | 'unknown'

export function normalizeStatus(raw: unknown): NormStatus {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s) return 'unknown'
  if (SUCCESS.includes(s)) return 'success'
  if (FAILED.includes(s)) return 'failed'
  if (PENDING.includes(s)) return 'pending'
  return 'unknown'
}

/** 状态字段候选名（各平台叫法不一） */
const STATUS_KEYS = ['status', 'state', 'taskStatus', 'task_status', 'runStatus', 'run_status',
  'executeStatus', 'execute_status', 'jobStatus', 'job_status', 'nodeStatus', 'node_status']

/** 在嵌套结构里递归找状态值 */
export function findStatus(obj: unknown, depth = 0): unknown {
  if (!obj || typeof obj !== 'object' || depth > 7) return undefined
  const o = obj as Record<string, unknown>
  for (const k of STATUS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(o, k)) {
      const v = o[k]
      if (v !== null && v !== undefined && v !== '') {
        // 只接受标量，避免把对象误当状态
        if (typeof v === 'string' || typeof v === 'number') return v
      }
    }
  }
  for (const k of ['data', 'result', 'results', 'output', 'outputs', 'task', 'job', 'items', 'list']) {
    const found = findStatus(o[k], depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/* ------------------------------------------------------------------
 * taskId 提取
 * 原插件写法：res.data.taskId || res.data.id || res.taskId || res.id
 * ------------------------------------------------------------------ */

export function extractTaskId(res: unknown): string {
  if (!res || typeof res !== 'object') return ''
  const r = res as Record<string, any>
  return String(r?.data?.taskId || r?.data?.id || r?.taskId || r?.id || '').trim()
}

/* ------------------------------------------------------------------
 * 结果图片 URL 提取
 * 容器名十几个、URL 字段十几个，且嵌套深度不定 —— 必须递归找
 * ------------------------------------------------------------------ */

const URL_KEYS = ['fileUrl', 'file_url', 'url', 'downloadUrl', 'download_url', 'imageUrl', 'image_url',
  'resultUrl', 'result_url', 'outputUrl', 'output_url', 'originUrl', 'origin_url', 'ossUrl', 'oss_url',
  'mediaUrl', 'media_url', 'response', 'taskResult']

const CONTAINER_KEYS = ['outputs', 'output', 'data', 'result', 'results', 'list', 'items', 'files',
  'fileList', 'images', 'imageList', 'nodeOutputs', 'nodeOutputList', 'media', 'urls']

function looksLikeImageUrl(s: string): boolean {
  if (!/^https?:\/\//i.test(s)) return false
  return /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(s) || /(image|img|media|output|result|cdn|file)/i.test(s)
}

/** 在任意嵌套结构里找出第一个像图片地址的 URL */
export function extractImageUrl(obj: unknown, depth = 0): string {
  if (obj == null || depth > 7) return ''

  if (typeof obj === 'string') {
    const s = obj.trim()
    if (looksLikeImageUrl(s)) return s
    // 可能是被序列化的 JSON，尝试再解析一层
    if (s.startsWith('{') || s.startsWith('[')) {
      try { return extractImageUrl(JSON.parse(s), depth + 1) } catch { return '' }
    }
    return ''
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractImageUrl(item, depth + 1)
      if (found) return found
    }
    return ''
  }

  if (typeof obj !== 'object') return ''

  const o = obj as Record<string, unknown>
  for (const k of URL_KEYS) {
    const found = extractImageUrl(o[k], depth + 1)
    if (found) return found
  }
  for (const k of CONTAINER_KEYS) {
    const found = extractImageUrl(o[k], depth + 1)
    if (found) return found
  }
  return ''
}

/* ------------------------------------------------------------------
 * 错误信息提取
 * ------------------------------------------------------------------ */

export function extractMessage(res: unknown): string {
  if (!res) return ''
  if (typeof res === 'string') return res
  if (typeof res !== 'object') return String(res)
  const r = res as Record<string, any>
  // 中英文都覆盖，且要能钻到 data/result 里
  const direct = r.message || r.msg || r.error || r.errorMessage || r.failedReason || r.reason
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  for (const k of ['data', 'result', 'error', 'failedReason']) {
    const nested = extractMessage(r[k])
    if (nested) return nested
  }
  return ''
}

/** 判断错误是否为「余额不足 / 内容违规」这类不该重试的硬失败 */
export function isHardFailure(msg: string): boolean {
  return /insufficient|forbidden|unauthorized|policy|safety|moderation|sensitive|blocked|violation|余额不足|欠费|违规|审核|内容安全|安全策略|内容政策|敏感/i.test(msg)
}

/** 判断 HTTP 状态码是否值得重试 */
export function isRetryableStatus(code: number): boolean {
  return code === 0 || code === 408 || code === 409 || code === 425 || code === 429 || code >= 500
}

/** 判断网络异常是否值得重试 */
export function isRetryableError(e: unknown): boolean {
  const s = String((e as any)?.message || e || '').toLowerCase()
  if (!s) return false
  return ['abort', 'timeout', 'timed out', 'network', 'fetch failed', 'failed to fetch',
    'load failed', 'econnreset', 'enotfound', 'etimedout', 'socket', 'temporarily unavailable']
    .some((k) => s.includes(k))
}

/* ------------------------------------------------------------------
 * 统一带超时的 fetch
 * ------------------------------------------------------------------ */

export async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30000,
  provider = 'AI'
): Promise<any> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  let aborted = false
  const timer = controller
    ? setTimeout(() => { aborted = true; try { controller.abort() } catch {} }, timeoutMs)
    : null
  try {
    const resp = await fetch(url, { ...init, signal: controller ? controller.signal : init.signal })
    const text = await resp.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { json = { rawText: text } }

    if (!resp.ok) {
      const msg = extractMessage(json) || `请求失败 HTTP ${resp.status}`
      throw new AIError(`[${provider}] ${msg}`, { httpStatus: resp.status, body: json })
    }
    return json
  } catch (e) {
    // 浏览器在 fetch 层面失败时只给一句 "Failed to fetch"，
    // 用户完全无从判断是地址写错、断网还是跨域被拦。这里翻译成人话。
    if (e instanceof AIError) throw e
    if (aborted) {
      throw new AIError(`[${provider}] 请求超时（${Math.round(timeoutMs / 1000)} 秒无响应）`)
    }
    const msg = (e as Error)?.message || String(e)
    if (/abort/i.test(msg)) {
      throw new AIError(`[${provider}] 请求已取消`)
    }
    const host = (() => { try { return new URL(url).host } catch { return url } })()
    throw new AIError(
      `[${provider}] 无法连接 ${host}\n` +
      '可能原因：地址写错／该服务未开放跨域（CORS）／网络不通。\n' +
      '排查顺序：①浏览器直接打开该地址能否访问 ②用「测试连接」按钮看具体报错',
    )
  } finally {
    if (timer) clearTimeout(timer)
    void aborted
  }
}

/** 依次尝试多个地址/变体，第一个成功即返回；全部失败则抛最后一个错误 */
export async function tryEach<T>(
  variants: Array<() => Promise<T>>,
  onWarn?: (label: number, e: unknown) => void
): Promise<T> {
  let lastErr: unknown = null
  for (let i = 0; i < variants.length; i++) {
    try {
      return await variants[i]()
    } catch (e) {
      lastErr = e
      onWarn?.(i, e)
    }
  }
  throw lastErr instanceof Error ? lastErr : new AIError('全部请求变体均失败')
}

/** base64 dataURL 转 Blob（上传用） */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/jpeg'
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
