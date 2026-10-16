/**
 * 协议族 D：OpenAI 官方兼容接口
 *
 * 路径来自 HHPS 插件逆向核实：
 *   POST /v1/images/generations
 *   模型 gpt-image-2 / gpt-image-2-mini
 *
 * ⚠️ 重要说明：/v1/images/edits（带 mask 的图生图）在两个插件里均未出现，
 * 无法证实其可用性。因此本实现：
 *   - 默认走 generations（已验证存在）
 *   - 若配置了 edits 开关则尝试 edits，失败自动回退 generations
 * 而"贴回"的契合度主要靠本地的蒙版合成保证，不依赖服务端 mask。
 */

import type { Provider, SubmitRequest, SubmitOutcome, PollResult, Balance } from './types'
import { AIError } from './types'
import { fetchJson, extractImageUrl, extractMessage, tryEach, dataUrlToBlob } from './extract'

async function submit(req: SubmitRequest, apiKey: string, baseUrl: string): Promise<SubmitOutcome> {
  const { prompt, imageDataUrl, model } = req
  const useEdits = req.extra?.useEdits === true

  const attempts: Array<() => Promise<SubmitOutcome>> = []

  // 路径 1：图生图（edits）—— 实验性，失败即回退
  if (useEdits && imageDataUrl) {
    attempts.push(async () => {
      const form = new FormData()
      form.append('model', model)
      form.append('prompt', prompt)
      form.append('image', dataUrlToBlob(imageDataUrl), 'image.png')
      const res = await fetchJson(`${baseUrl}/v1/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      }, 180_000, 'OpenAI')
      const url = extractImageUrl(res)
      if (!url) throw new AIError(extractMessage(res) || 'edits 未返回图片')
      return { kind: 'image', imageUrl: url } as SubmitOutcome
    })
  }

  // 路径 2：文生图（generations）—— 已验证存在
  attempts.push(async () => {
    const res = await fetchJson(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: req.aspectRatio && req.aspectRatio !== 'auto' ? req.aspectRatio : '1024x1024',
      }),
    }, 180_000, 'OpenAI')
    const url = extractImageUrl(res)
    if (!url) throw new AIError(extractMessage(res) || '未返回图片地址')
    return { kind: 'image', imageUrl: url } as SubmitOutcome
  })

  return tryEach(attempts, (i, e) => console.warn('[OpenAI] 变体失败', i, (e as Error)?.message))
}

async function poll(): Promise<PollResult> {
  return { status: 'failed', message: '该渠道为同步返回，不应进入轮询' }
}

async function fetchBalance(): Promise<Balance> {
  return { balance: null, currency: 'USD' }
}

/** 拉取可用图片模型：GET /v1/models，只保留能出图的 */
export async function listImageModels(apiKey: string, baseUrl: string): Promise<string[]> {
  const res = await fetchJson(`${baseUrl}/v1/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  }, 30000, 'OpenAI')

  return pickImageModels(res)
}

/**
 * 从 /v1/models 的返回里挑出图片模型
 * 各家中转返回的 id 命名不一，用关键词宽松匹配
 */
export function pickImageModels(res: any): string[] {
  const list = res?.data ?? res?.models ?? res?.result ?? []
  if (!Array.isArray(list)) return []

  const ids = list
    .map((m: any) => (typeof m === 'string' ? m : m?.id ?? m?.model ?? m?.name ?? ''))
    .filter((s: unknown): s is string => typeof s === 'string' && !!s)

  // 先找明确带 image 的
  const imageish = ids.filter((id) =>
    /gpt-image|dall-?e|image|flux|sd|stable|banana|seedream|qwen-image|kolors|doubao.*image|wanx|midjourney|mj_/i.test(id)
  )
  // 若一个都没有，说明可能是专做图片的中转，全部返回
  return (imageish.length ? imageish : ids).sort()
}

export const openaiProvider: Provider = {
  family: 'openai',
  submit,
  poll,
  fetchBalance,
  listImageModels,
}
