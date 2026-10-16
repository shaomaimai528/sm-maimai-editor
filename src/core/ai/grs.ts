/**
 * 协议族 B：GRS（Gemini / Banana 系图像模型的 OpenAI 风格接口）
 *
 * 路径与模型目录来自 像素起子 逆向核实：
 *   POST /v1/draw/nano-banana     ← 主用
 *   POST /v1/api/generate         ← 回退
 *   POST /v1/draw/completions     ← 回退
 *   POST /v1/draw/result          ← 结果查询
 *   POST /v1/chat/completions     ← 文本
 *
 * 该族的返回结构比 RunningHub 更宽松，且常直接返回图片 URL，无需轮询。
 */

import type { Provider, SubmitRequest, SubmitOutcome, PollResult, Balance } from './types'
import { AIError } from './types'
import {
  fetchJson, extractTaskId, extractImageUrl, extractMessage,
  normalizeStatus, findStatus, tryEach,
} from './extract'

const AUTH = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
})

/** 组装请求体：不同变体字段名略有差异，逐个尝试 */
function buildBodies(req: SubmitRequest): Array<Record<string, unknown>> {
  const { prompt, imageDataUrl, model, aspectRatio, resolution } = req
  const base: Record<string, unknown> = { model, prompt }

  if (aspectRatio && aspectRatio !== 'auto') base.aspectRatio = aspectRatio
  if (resolution) base.resolution = resolution

  const bodies: Array<Record<string, unknown>> = []

  if (imageDataUrl) {
    // 图生图：字段名各实现不一，全部带上，服务端忽略不认识的即可
    bodies.push({ ...base, image: imageDataUrl })
    bodies.push({ ...base, imageUrl: imageDataUrl })
    bodies.push({ ...base, images: [imageDataUrl] })
  } else {
    bodies.push(base)
  }

  return bodies
}

async function submit(req: SubmitRequest, apiKey: string, baseUrl: string): Promise<SubmitOutcome> {
  const bodies = buildBodies(req)
  const endpoints = ['/v1/draw/nano-banana', '/v1/api/generate', '/v1/draw/completions']

  const attempts: Array<() => Promise<SubmitOutcome>> = []

  for (const path of endpoints) {
    for (const body of bodies) {
      attempts.push(async () => {
        const res = await fetchJson(`${baseUrl}${path}`, {
          method: 'POST',
          headers: AUTH(apiKey),
          body: JSON.stringify(body),
        }, 180_000, 'GRS')

        // 可能直接返回图片
        const directUrl = extractImageUrl(res)
        const taskId = extractTaskId(res)
        const status = normalizeStatus(findStatus(res))

        if (status === 'failed') {
          throw new AIError(extractMessage(res) || 'GRS 任务失败')
        }
        if (taskId) return { kind: 'task', taskId } as SubmitOutcome
        if (directUrl) return { kind: 'image', imageUrl: directUrl } as SubmitOutcome

        throw new AIError(extractMessage(res) || '未返回 taskId 或图片地址')
      })
    }
  }

  return tryEach(attempts, (i, e) => console.warn('[GRS] 提交变体失败', i, (e as Error)?.message))
}

async function poll(taskId: string, apiKey: string, baseUrl: string): Promise<PollResult> {
  const res = await tryEach([
    () => fetchJson(`${baseUrl}/v1/draw/result`, {
      method: 'POST', headers: AUTH(apiKey), body: JSON.stringify({ taskId }),
    }, 30_000, 'GRS'),
    () => fetchJson(`${baseUrl}/v1/api/result`, {
      method: 'POST', headers: AUTH(apiKey), body: JSON.stringify({ id: taskId }),
    }, 30_000, 'GRS'),
  ], (i, e) => console.warn('[GRS] 轮询变体失败', i, (e as Error)?.message))

  const status = normalizeStatus(findStatus(res))
  const url = extractImageUrl(res)

  if (status === 'failed') return { status: 'failed', message: extractMessage(res) || '任务执行失败' }
  if (url) return { status: 'done', imageUrl: url }
  if (status === 'success') return { status: 'failed', message: '任务已完成但未找到结果图片' }
  return { status: 'pending' }
}

async function fetchBalance(apiKey: string, baseUrl: string): Promise<Balance> {
  // 该族额度接口不统一，尽力而为
  const res = await fetchJson(`${baseUrl}/v1/health`, {
    method: 'GET', headers: { Authorization: `Bearer ${apiKey}` },
  }, 20_000, 'GRS').catch(() => null)

  const d = res?.data || res || {}
  const n = Number(d?.credits ?? d?.balance ?? d?.remainCredits ?? NaN)
  return { balance: Number.isFinite(n) ? n : null, currency: 'CREDIT' }
}

/** GRS 的模型列表与其他 OpenAI 兼容渠道一致 */
async function listImageModels(apiKey: string, baseUrl: string): Promise<string[]> {
  try {
    const res = await fetchJson(`${baseUrl}/v1/models`, {
      method: 'GET', headers: { Authorization: `Bearer ${apiKey}` },
    }, 20000, 'GRS')
    const arr = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []
    const ids = arr.map((m: any) => String(m?.id || m?.name || '')).filter(Boolean)
    return ids.sort()
  } catch {
    return []
  }
}

export const grsProvider: Provider = {
  family: 'grs',
  submit,
  poll,
  fetchBalance,
  listImageModels,
}
