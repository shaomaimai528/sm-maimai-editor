/**
 * 生成任务编排：提交 → （按需）轮询 → 取回图片
 *
 * 统一处理协议差异：
 *  - 自定义渠道多为同步直出图片
 *  - RunningHub 返回 taskId 需要轮询
 */

import type { Channel, SubmitRequest, PollResult } from './types'
import { AIError } from './types'
import { getProvider, urlsFor } from './channels'
import { dataUrlToBlob, isRetryableError, isHardFailure } from './extract'

export interface GenerateOptions {
  channel: Channel
  apiKey: string
  request: SubmitRequest
  /** 轮询回调，用于 UI 显示进度与剩余时间 */
  onProgress?: (info: { phase: string; elapsedMs: number; attempt: number }) => void
  signal?: AbortSignal
}

export interface GenerateResult {
  imageUrl: string
  taskId?: string
  elapsedMs: number
}

const POLL_BASE_MS = 2000
const POLL_MAX_MS = 10000
const POLL_TIMEOUT_MS = 5 * 60 * 1000

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new AIError('已取消'))
    }, { once: true })
  })
}

/** 主流程：提交并等待结果 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const { channel, apiKey, request, onProgress, signal } = opts
  const started = Date.now()
  const provider = getProvider(channel.family)
  const urls = urlsFor(channel)

  let lastErr: unknown = null

  // 主地址 + 备用地址依次尝试
  for (const baseUrl of urls) {
    try {
      onProgress?.({ phase: '提交任务', elapsedMs: Date.now() - started, attempt: 0 })

      const req: SubmitRequest = { ...request }

      // RunningHub 需要先上传图片换取 file token
      if (provider.upload && channel.needsUpload && req.imageDataUrl && !req.fileToken) {
        onProgress?.({ phase: '上传图片', elapsedMs: Date.now() - started, attempt: 0 })
        const blob = dataUrlToBlob(req.imageDataUrl)
        req.fileToken = await provider.upload(blob, apiKey, baseUrl)
      }

      const outcome = await provider.submit(req, apiKey, baseUrl)

      // 同步直出
      if (outcome.kind === 'image') {
        return { imageUrl: outcome.imageUrl, elapsedMs: Date.now() - started }
      }

      // 需要轮询
      const taskId = outcome.taskId
      let attempt = 0
      let delay = POLL_BASE_MS
      let consecutiveErrors = 0

      while (Date.now() - started < POLL_TIMEOUT_MS) {
        if (signal?.aborted) throw new AIError('已取消')
        await sleep(delay, signal)
        attempt++

        let result: PollResult
        try {
          result = await provider.poll(taskId, apiKey, baseUrl)
          consecutiveErrors = 0
        } catch (e) {
          // 网络抖动容忍：连续 5 次失败才放弃
          if (isRetryableError(e) && ++consecutiveErrors < 5) {
            onProgress?.({ phase: '网络重试中', elapsedMs: Date.now() - started, attempt })
            delay = Math.min(POLL_MAX_MS, delay * 1.5)
            continue
          }
          throw e
        }

        onProgress?.({
          phase: result.status === 'pending' ? '生成中' : '取回结果',
          elapsedMs: Date.now() - started,
          attempt,
        })

        if (result.status === 'done') {
          return { imageUrl: result.imageUrl, taskId, elapsedMs: Date.now() - started }
        }
        if (result.status === 'failed') {
          // 硬失败（余额/违规）不重试
          if (isHardFailure(result.message)) throw new AIError(result.message)
          throw new AIError(result.message)
        }

        // 指数退避到上限
        delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.4))
      }

      throw new AIError('生成超时（超过 5 分钟）')
    } catch (e) {
      lastErr = e
      // 取消 / 硬失败：直接抛，不再试备用地址
      const msg = (e as Error)?.message || ''
      if (msg === '已取消' || isHardFailure(msg)) throw e
      console.warn('[pipeline] 地址尝试失败', baseUrl, msg)
    }
  }

  throw lastErr instanceof Error ? lastErr : new AIError('全部渠道地址均失败')
}

/** 下载生成结果为 ImageBitmap */
export async function fetchResultBitmap(url: string): Promise<ImageBitmap> {
  const resp = await fetch(url)
  if (!resp.ok) throw new AIError(`下载结果失败 HTTP ${resp.status}`)
  const blob = await resp.blob()
  return createImageBitmap(blob)
}

/**
 * 拉取渠道可用模型
 *
 * 用户要求模型列表从对方网站自动获取，而不是本地写死 ——
 * 这样渠道上新模型时无需改代码。
 * 各 provider 自行决定用哪个端点与过滤规则。
 */
export async function fetchModels(channel: Channel, apiKey: string): Promise<string[]> {
  const provider = getProvider(channel.family)
  if (!provider.listImageModels) return []

  for (const baseUrl of urlsFor(channel)) {
    try {
      const list = await provider.listImageModels(apiKey, baseUrl)
      if (list.length) return list
    } catch (e) {
      console.warn('[pipeline] 模型拉取失败', baseUrl, (e as Error)?.message)
    }
  }
  return []
}

/** 查询渠道余额 */
export async function queryBalance(channel: Channel, apiKey: string) {
  const provider = getProvider(channel.family)
  if (!provider.fetchBalance) return null
  for (const baseUrl of urlsFor(channel)) {
    try {
      return await provider.fetchBalance(apiKey, baseUrl)
    } catch (e) {
      console.warn('[pipeline] 余额查询失败', baseUrl, (e as Error)?.message)
    }
  }
  return null
}
