/**
 * 协议族 E：用户自定义渠道
 *
 * 面向任意 OpenAI 兼容或私有接口。用户可指定：
 *  - 提交路径与轮询路径
 *  - 请求体里的字段名（图片/提示词/模型/任务号）
 *  - 鉴权头名称与前缀
 *  - 图片以 dataURL 内嵌 JSON，还是走 multipart 表单
 *
 * 返回解析复用 extract.ts 的容错逻辑（递归找 URL、状态归一化），
 * 因此即使对方返回结构不规范也能取到结果。
 */

import type { Provider, SubmitRequest, SubmitOutcome, PollResult, Balance, CustomSpec } from './types'
import { AIError } from './types'
import {
  fetchJson, extractTaskId, extractImageUrl, extractMessage,
  normalizeStatus, findStatus, dataUrlToBlob, extractBase64Image,
} from './extract'

/** 提取自定义配置，带默认值 */
function spec(req: SubmitRequest): CustomSpec {
  const s = (req.extra?.custom as CustomSpec) || ({} as CustomSpec)
  return {
    mode: s.mode || 'sync',
    submitPath: s.submitPath?.trim() || '/v1/images/generations',
    pollPath: s.pollPath?.trim() || '',
    imageField: s.imageField?.trim() || 'image',
    promptField: s.promptField?.trim() || 'prompt',
    modelField: s.modelField?.trim() || 'model',
    taskIdField: s.taskIdField?.trim() || 'taskId',
    imageAsDataUrl: s.imageAsDataUrl !== false,
    authHeader: s.authHeader?.trim() || 'Authorization',
    authPrefix: s.authPrefix ?? 'Bearer ',
    extraHeaders: s.extraHeaders || {},
  }
}

function buildHeaders(apiKey: string, s: CustomSpec, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...s.extraHeaders }
  if (apiKey) headers[s.authHeader!] = `${s.authPrefix ?? ''}${apiKey}`
  // 支持用户把 baseUrl 直接写进 header（如某些网关要求自定义域名头）
  void baseUrl
  return headers
}

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

async function submit(req: SubmitRequest, apiKey: string, baseUrl: string): Promise<SubmitOutcome> {
  const s = spec(req)
  const url = joinUrl(baseUrl, s.submitPath!)
  const headers = buildHeaders(apiKey, s, baseUrl)

  let res: any

  if (s.imageAsDataUrl !== false) {
    // 图片内嵌 JSON（最常见）
    const body: Record<string, unknown> = {
      [s.modelField!]: req.model,
      [s.promptField!]: req.prompt,
    }
    if (req.imageDataUrl) body[s.imageField!] = req.imageDataUrl
    if (req.aspectRatio && req.aspectRatio !== 'auto') body.aspect_ratio = req.aspectRatio
    if (req.resolution) body.resolution = req.resolution
    if (req.extra?.customBody && typeof req.extra.customBody === 'object') {
      Object.assign(body, req.extra.customBody as object)
    }
    res = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify(body) }, 180_000, '自定义渠道')
  } else {
    // multipart 表单
    const form = new FormData()
    form.append(s.modelField!, req.model)
    form.append(s.promptField!, req.prompt)
    if (req.imageDataUrl) {
      form.append(s.imageField!, dataUrlToBlob(req.imageDataUrl), 'image.png')
    }
    // FormData 不能手动设 Content-Type，需去掉让浏览器自动补 boundary
    const h = { ...headers }
    delete h['Content-Type']
    res = await fetchJson(url, { method: 'POST', headers: h, body: form }, 180_000, '自定义渠道')
  }

  // 图片可能以 URL 或 base64 两种形式返回，都要认
  const imgUrl = extractImageUrl(res) || extractBase64Image(res)
  const taskId = extractTaskId(res)

  // 轮询模式：优先认 taskId
  if (s.mode === 'poll') {
    if (!taskId) {
      if (imgUrl) return { kind: 'image', imageUrl: imgUrl }
      throw new AIError(extractMessage(res) || '未返回任务号，且未找到图片地址')
    }
    return { kind: 'task', taskId }
  }

  // 同步模式：优先认图片
  if (imgUrl) return { kind: 'image', imageUrl: imgUrl }
  if (taskId) return { kind: 'task', taskId }
  throw new AIError(extractMessage(res) || '未返回图片地址')
}

async function poll(taskId: string, apiKey: string, baseUrl: string): Promise<PollResult> {
  // 轮询需要知道路径与字段名，这里从调用方经 globalThis 传递（pipeline 会注入）
  const s: CustomSpec = (globalThis as any).__customPollSpec || {}
  const pollPath = s.pollPath?.trim()
  if (!pollPath) {
    return { status: 'failed', message: '未配置轮询路径' }
  }

  const headers = buildHeaders(apiKey, {
    ...s,
    authHeader: s.authHeader || 'Authorization',
    authPrefix: s.authPrefix ?? 'Bearer ',
    extraHeaders: s.extraHeaders || {},
  }, baseUrl)

  const url = joinUrl(baseUrl, pollPath)
  const res = await fetchJson(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ [s.taskIdField?.trim() || 'taskId']: taskId }),
  }, 30_000, '自定义渠道')

  const status = normalizeStatus(findStatus(res))
  const imgUrl = extractImageUrl(res) || extractBase64Image(res)

  if (status === 'failed') {
    return { status: 'failed', message: extractMessage(res) || '任务执行失败' }
  }
  if (imgUrl) return { status: 'done', imageUrl: imgUrl }
  if (status === 'success') {
    return { status: 'failed', message: '任务已完成但未找到结果图片' }
  }
  return { status: 'pending' }
}

async function fetchBalance(): Promise<Balance> {
  // 自定义渠道无从得知额度接口
  return { balance: null, currency: '' }
}

/**
 * 从对方网站拉取可用模型
 * 走标准的 GET /v1/models；若对方没实现该端点则返回空，界面退化为手填
 */
async function listImageModels(apiKey: string, baseUrl: string): Promise<string[]> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const res = await fetchJson(`${baseUrl.replace(/\/+$/, '')}/v1/models`, {
    method: 'GET', headers,
  }, 20000, '自定义渠道')

  const list = res?.data ?? res?.models ?? res?.result ?? []
  if (!Array.isArray(list)) return []

  const ids = list
    .map((m: any) => (typeof m === 'string' ? m : m?.id ?? m?.model ?? m?.name ?? ''))
    .filter((s: unknown): s is string => typeof s === 'string' && !!s)

  // 优先留下图像类模型；若一个都识别不出，说明可能专做图片，全部返回
  const imageish = ids.filter((id) =>
    /gpt-image|dall-?e|image|flux|sd|stable|banana|seedream|kolors|qwen|wanx|midjourney|mj_|doubao/i.test(id)
  )
  return (imageish.length ? imageish : ids).sort()
}

export const customProvider: Provider = {
  family: 'custom',
  submit,
  poll,
  fetchBalance,
  listImageModels,
}
