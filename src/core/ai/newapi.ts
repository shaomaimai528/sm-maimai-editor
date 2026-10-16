/**
 * 协议族 C：NewAPI 中转（阿吉 Aji / 墨墨 Momo）
 *
 * 路径来自 像素起子 逆向核实：
 *   生图    POST /v1/images/generations
 *   对话    POST /v1/chat/completions
 *   模型    GET  /v1/models
 *   额度    GET  /api/usage/token/{apiKey}   (newapi-token-usage)
 *   日志    GET  /api/log/token/{apiKey}     (按 request_id 查单次扣费)
 *
 * 注意：模型名带渠道前缀（[c]/[m]/[yu]/[文本]/[Yz] 等），
 * 必须原样透传，绝不能清洗方括号 —— 那是渠道的选路标记。
 */

import type { Provider, SubmitRequest, SubmitOutcome, PollResult, Balance } from './types'
import { AIError } from './types'
import { fetchJson, extractImageUrl, extractMessage, tryEach } from './extract'

const AUTH = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
})

async function submit(req: SubmitRequest, apiKey: string, baseUrl: string): Promise<SubmitOutcome> {
  const { prompt, imageDataUrl, model } = req
  const base: Record<string, unknown> = { model, prompt, n: 1 }

  const bodies: Array<Record<string, unknown>> = []
  if (imageDataUrl) {
    bodies.push({ ...base, image: imageDataUrl })
    bodies.push({ ...base, image_url: imageDataUrl })
    bodies.push({ ...base, images: [imageDataUrl] })
  } else {
    bodies.push(base)
  }

  const res = await tryEach(
    bodies.map((body) => () => fetchJson(`${baseUrl}/v1/images/generations`, {
      method: 'POST', headers: AUTH(apiKey), body: JSON.stringify(body),
    }, 180_000, 'NewAPI')),
    (i, e) => console.warn('[NewAPI] 提交变体失败', i, (e as Error)?.message)
  )

  const url = extractImageUrl(res)
  if (!url) throw new AIError(extractMessage(res) || '未返回图片地址')
  return { kind: 'image', imageUrl: url }
}

/** NewAPI 系生图通常同步返回，poll 仅为接口完整性保留 */
async function poll(): Promise<PollResult> {
  return { status: 'failed', message: '该渠道为同步返回，不应进入轮询' }
}

async function fetchBalance(apiKey: string, baseUrl: string): Promise<Balance> {
  const res = await fetchJson(`${baseUrl}/api/usage/token/${encodeURIComponent(apiKey)}`, {
    method: 'GET', headers: { Authorization: `Bearer ${apiKey}` },
  }, 20_000, 'NewAPI')

  const d = res?.data
  if (!d || res?.code === false || res?.success === false) {
    throw new AIError(extractMessage(res) || '渠道未返回可用的额度信息')
  }
  const unlimited = d.unlimited_quota === true
  const available = Number(d.total_available)
  return {
    balance: unlimited ? null : (Number.isFinite(available) ? available : null),
    currency: 'QUOTA',
    unlimited,
  }
}

/** 拉取该渠道的可用模型列表 */
export async function listModels(apiKey: string, baseUrl: string): Promise<string[]> {
  try {
    const res = await fetchJson(`${baseUrl}/v1/models`, {
      method: 'GET', headers: { Authorization: `Bearer ${apiKey}` },
    }, 20_000, 'NewAPI')
    const arr = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []
    return arr.map((m: any) => String(m?.id || m?.name || '')).filter(Boolean)
  } catch {
    return []
  }
}

/** 只保留图片模型；NewAPI 的渠道前缀必须原样保留 */
export async function listImageModels(apiKey: string, baseUrl: string): Promise<string[]> {
  const all = await listModels(apiKey, baseUrl)
  const imageish = all.filter((id) =>
    /\[.*?\]|gpt-image|dall-?e|image|flux|banana|seedream|kolors|mj_|midjourney/i.test(id)
  )
  return imageish.length ? imageish.sort() : all.sort()
}

export const newapiProvider: Provider = {
  family: 'newapi',
  submit,
  poll,
  fetchBalance,
  listImageModels,
}
