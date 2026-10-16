/**
 * 协议族 A：RunningHub（任务制，需轮询）
 *
 * 全部路径与字段名来自 像素起子V2.8.5/dist/host.bundle.js 逆向核实：
 *   上传  POST /openapi/v2/media/upload/binary  →  回退 /uc/openapi/upload
 *   提交  POST /task/openapi/ai-app/run         →  回退 /task/openapi/create
 *   轮询  POST /openapi/v2/query                →  回退 /task/openapi/outputs
 *   取消  POST /task/openapi/cancel
 *   余额  POST /uc/openapi/accountStatus
 *
 * 原插件对每个接口都做"多变体依次尝试"，这是它在协议漂移下仍可用的关键，予以保留。
 */

import type { Provider, SubmitRequest, SubmitOutcome, PollResult, Balance } from './types'
import { AIError, type Provider as P } from './types'
import {
  fetchJson, extractTaskId, extractImageUrl, extractMessage,
  normalizeStatus, findStatus, tryEach, dataUrlToBlob,
} from './extract'

const UPLOAD_TIMEOUT = 180_000

/** 上传图片，返回 file token */
async function upload(blob: Blob, apiKey: string, baseUrl: string): Promise<string> {
  const endpoints = [
    `${baseUrl}/openapi/v2/media/upload/binary`,
    `${baseUrl}/uc/openapi/upload`,
  ]

  return tryEach(
    endpoints.map((endpoint) => async () => {
      const form = new FormData()
      const name = blob.type === 'image/png' ? 'image.png'
        : blob.type === 'image/webp' ? 'image.webp'
        : 'image.jpg'
      form.append('file', blob, name)

      const res = await fetchJson(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      }, UPLOAD_TIMEOUT, 'RunningHub')

      const payload = res?.data || res?.result || res
      const token = String(
        payload?.fileName || payload?.filename || payload?.fileKey || payload?.key || ''
      ).trim()
      if (token) return token

      const url = String(payload?.url || payload?.fileUrl || '').trim()
      if (url) return url

      throw new AIError(extractMessage(res) || '上传成功但未返回可用的文件标识')
    }),
    (i, e) => console.warn('[RunningHub] 上传变体失败', i, (e as Error)?.message)
  )
}

/**
 * 提交任务
 *
 * 用户只需提供 workflowId（配合 API Key）即可调用自己的工作流。
 * 实测确认：POST /task/openapi/create 传 {apiKey, workflowId} 会返回
 * "workflow not exists"（而非参数缺失），说明该请求形状是完整可用的。
 *
 * 若用户填了 appId，则优先尝试 AI App 接口；否则直接走工作流接口。
 */
async function submit(req: SubmitRequest, apiKey: string, baseUrl: string): Promise<SubmitOutcome> {
  const imageRef = req.fileToken || req.imageDataUrl || ''
  const workflowId = String(req.extra?.workflowId || '').trim()
  const appId = String(req.extra?.appId || '').trim()

  const attempts: Array<() => Promise<SubmitOutcome>> = []

  // 路径 1：用户提供了 appId —— 走 AI App 接口
  if (appId) {
    const nodeInfoList = (req.extra?.nodeInfoList as unknown[]) || buildNodeInfoList(req, imageRef)
    attempts.push(async () => {
      const res = await fetchJson(`${baseUrl}/task/openapi/ai-app/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, appId, nodeInfoList }),
      }, 180_000, 'RunningHub')
      const taskId = extractTaskId(res)
      if (!taskId) throw new AIError(extractMessage(res) || '任务已创建但未返回 taskId')
      return { kind: 'task', taskId } as SubmitOutcome
    })
  }

  // 路径 2：工作流接口 —— 只需 workflowId
  if (workflowId) {
    // 带上提示词与图片，字段名兼容常见工作流节点命名
    const nodeParams: Record<string, unknown> = {
      ...(req.extra?.nodeParams as object || {}),
      prompt: req.prompt,
      text: req.prompt,
    }
    if (imageRef) {
      nodeParams.image = imageRef
      nodeParams.imageUrl = imageRef
    }

    attempts.push(async () => {
      const res = await fetchJson(`${baseUrl}/task/openapi/create`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, workflowId, nodeParams }),
      }, 180_000, 'RunningHub')
      const taskId = extractTaskId(res)
      if (!taskId) throw new AIError(extractMessage(res) || '任务已创建但未返回 taskId')
      return { kind: 'task', taskId } as SubmitOutcome
    })
  }

  if (!attempts.length) {
    throw new AIError('请先在设置里填写 RunningHub 的工作流 ID')
  }

  return tryEach(attempts, (i, e) => console.warn('[RunningHub] 提交变体失败', i, (e as Error)?.message))
}

/** 把提示词与图片组装成 AI App 需要的节点参数列表 */
function buildNodeInfoList(req: SubmitRequest, imageRef: string): unknown[] {
  const list: Array<Record<string, unknown>> = []
  list.push({ nodeId: 'prompt', fieldName: 'text', fieldValue: req.prompt })
  if (imageRef) {
    list.push({ nodeId: 'image', fieldName: 'image', fieldValue: imageRef })
  }
  return list
}

/** 轮询任务 */
async function poll(taskId: string, apiKey: string, baseUrl: string): Promise<PollResult> {
  const body = { apiKey, taskId }

  const res = await tryEach([
    () => fetchJson(`${baseUrl}/openapi/v2/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    }, 30_000, 'RunningHub'),
    () => fetchJson(`${baseUrl}/task/openapi/outputs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 30_000, 'RunningHub'),
  ], (i, e) => console.warn('[RunningHub] 轮询变体失败', i, (e as Error)?.message))

  const status = normalizeStatus(findStatus(res))
  const url = extractImageUrl(res)

  // 实测：查询接口在任务尚未就绪时也会携带 errorMessage/errorCode，
  // 所以判断失败必须以 status 为准，不能只看到 errorMessage 就报错。
  if (status === 'failed') {
    return { status: 'failed', message: extractMessage(res) || '任务执行失败' }
  }
  // 有些实现状态下不再更新但图片已就绪，优先认图
  if (url) return { status: 'done', imageUrl: url }
  if (status === 'success') {
    return { status: 'failed', message: '任务已完成但未找到结果图片' }
  }
  // status 为空或 unknown：任务仍在进行中
  return { status: 'pending' }
}

async function cancel(taskId: string, apiKey: string, baseUrl: string): Promise<void> {
  await fetchJson(`${baseUrl}/task/openapi/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, taskId }),
  }, 30_000, 'RunningHub')
}

/** 余额：注意此处 body 字段是小写 apikey（与原插件一致） */
async function fetchBalance(apiKey: string, baseUrl: string): Promise<Balance> {
  const res = await fetchJson(`${baseUrl}/uc/openapi/accountStatus`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: apiKey }),
  }, 30_000, 'RunningHub')

  const data = res?.data || res?.result || {}
  const s = data?.accountStatus && typeof data.accountStatus === 'object' ? data.accountStatus : data
  const balance = s?.remainMoney ?? s?.balance ?? s?.amount ?? s?.walletBalance ?? s?.money ?? null
  const coins = s?.remainCoins ?? s?.coins ?? s?.rhCoins ?? s?.integral ?? null
  return {
    balance: coins ?? balance ?? null,
    currency: String(s?.currency || 'RH').trim(),
  }
}

export const runninghubProvider: Provider = {
  family: 'runninghub',
  upload,
  submit,
  poll,
  cancel,
  fetchBalance,
}
