/**
 * RunningHub 工作流
 *
 * 接口已用真实 Key 实测（webappId 2024785405106724865）：
 *   POST {base}/api/webapp/detail
 *   body { apiKey, webappId }
 *   → { code:0, data:{ id, workflowId, name, inputNodes[], description, ... } }
 *
 * 两个 ID 是不同的东西，容易混淆：
 *   webappId   —— 应用 ID，用户从浏览器地址栏复制的那个（detail 接口用它查询）
 *   workflowId —— 工作流 ID，提交任务时用
 *   例：webappId=2024785405106724865 对应 workflowId=2024776560175222785
 *
 * inputNodes 才是参数来源，字段为：
 *   nodeId / nodeName / fieldName / fieldType / fieldValue
 *   descriptionCn（中文说明）/ descriptionEn
 * fieldType 取值：IMAGE / FLOAT / INT / STRING / BOOLEAN
 */

import type { AIError as _AIError } from './types'
import { AIError } from './types'

export interface WorkflowParam {
  nodeId: string
  nodeName: string
  fieldName: string
  fieldType: string
  /** 默认值 */
  value: string
  /** 中文说明，优先展示 */
  label: string
  description?: string
}

export interface WorkflowInfo {
  webappId: string
  /** 提交任务时实际要用的 ID，与 webappId 不同 */
  workflowId: string
  name: string
  description?: string
  coverUrl?: string
  params: WorkflowParam[]
  /** 历史成功率（百分比字符串） */
  successRate?: string
  /** 平均耗时（秒） */
  avgSeconds?: string
  tags?: string[]
}

/** fieldData 里标记为图片上传的字段 */
const IMAGE_TYPES = new Set(['IMAGE'])

export function isImageParam(p: WorkflowParam): boolean {
  return IMAGE_TYPES.has(p.fieldType.toUpperCase())
}

/** 把 detail 返回的节点转成界面用的参数 */
function toParams(nodes: any[]): WorkflowParam[] {
  if (!Array.isArray(nodes)) return []
  return nodes.map((n) => ({
    nodeId: String(n?.nodeId ?? ''),
    nodeName: String(n?.nodeName ?? ''),
    fieldName: String(n?.fieldName ?? ''),
    fieldType: String(n?.fieldType ?? 'STRING').toUpperCase(),
    value: n?.fieldValue == null ? '' : String(n.fieldValue),
    label: String(n?.descriptionCn || n?.description || n?.fieldName || ''),
    description: n?.descriptionEn ? String(n.descriptionEn) : undefined,
  })).filter((p) => p.nodeId && p.fieldName)
}

/** 从封面数组里取第一张 */
function firstCover(d: any): string | undefined {
  for (const k of ['covers', 'chineseCovers', 'englishCovers']) {
    const arr = d?.[k]
    if (Array.isArray(arr) && arr.length) {
      const c = arr[0]
      const url = typeof c === 'string' ? c : (c?.url || c?.coverUrl || c?.imageUrl)
      if (url) return String(url)
    }
  }
  return undefined
}

/**
 * 拉取工作流详情
 *
 * @param webappId 用户在 RunningHub 页面地址里复制的 ID
 */
export async function fetchWorkflow(
  webappId: string,
  apiKey: string,
  baseUrl: string,
): Promise<WorkflowInfo> {
  const id = String(webappId || '').trim()
  if (!id) throw new AIError('请先填写工作流 ID')
  if (!apiKey) throw new AIError('请先填写 RunningHub 的 API Key')

  const url = `${baseUrl.replace(/\/+$/, '')}/api/webapp/detail`

  let res: any
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, webappId: id }),
    })
    const text = await resp.text()
    try {
      res = JSON.parse(text)
    } catch {
      throw new AIError(`工作流接口返回的不是 JSON（HTTP ${resp.status}）`)
    }
    if (!resp.ok) {
      throw new AIError(`工作流查询失败 HTTP ${resp.status}：${text.slice(0, 160)}`)
    }
  } catch (e) {
    if (e instanceof AIError) throw e
    const msg = (e as Error)?.message || String(e)
    throw new AIError(
      msg.includes('Failed to fetch')
        ? `连接 RunningHub 失败。请检查网络能否访问 ${baseUrl}，以及 Key 是否有效。`
        : `工作流查询出错：${msg}`,
    )
  }

  if (res?.code !== 0 || !res?.data) {
    const m = res?.msg || res?.errorMessages || '未知错误'
    throw new AIError(`查询工作流失败：${m}。请确认工作流 ID 正确、且该应用对你可见。`)
  }

  const d = res.data
  const params = toParams(d.inputNodes)

  return {
    webappId: String(d.id ?? id),
    // 部分工作流没有独立的 workflowId（值为 null），
    // 这类应用直接以 webappId 提交，不能退回用户手填的 ID，否则会跑错工作流
    workflowId: d.workflowId ? String(d.workflowId) : '',
    name: String(d.name ?? '未命名工作流'),
    description: typeof d.description === 'string'
      ? d.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : undefined,
    coverUrl: firstCover(d),
    params,
    successRate: d.runningSuccessRate != null ? String(d.runningSuccessRate) : undefined,
    avgSeconds: d.avgRunningSeconds != null ? String(d.avgRunningSeconds) : undefined,
    tags: Array.isArray(d.tags) ? d.tags.map((t: any) => t?.name).filter(Boolean) : undefined,
  }
}

/**
 * 组装提交用的 nodeInfoList
 *
 * 只提交用户改动过的参数，未改的沿用工作流默认值 ——
 * 这样即便工作流后续加了新参数，也不会因为缺字段而失败。
 */
export function buildNodeInfoList(
  params: WorkflowParam[],
  overrides: Record<string, string | undefined>,
  imageFilename?: string,
): Array<{ nodeId: string; fieldName: string; fieldValue: any }> {
  const out: Array<{ nodeId: string; fieldName: string; fieldValue: any }> = []
  for (const p of params) {
    const raw = overrides[p.nodeId]
    if (raw === undefined) continue

    // 图片字段传文件名，真实像素由上传接口单独处理
    if (isImageParam(p)) {
      const v = imageFilename || String(raw)
      if (v) out.push({ nodeId: p.nodeId, fieldName: p.fieldName, fieldValue: v })
      continue
    }

    const t = p.fieldType.toUpperCase()
    let v: any = raw
    if (t === 'FLOAT') {
      const n = parseFloat(String(raw))
      v = Number.isFinite(n) ? n : raw
    } else if (t === 'INT') {
      const n = parseInt(String(raw), 10)
      v = Number.isFinite(n) ? n : raw
    } else if (t === 'BOOLEAN') {
      v = String(raw) === 'true' || String(raw) === '1'
    }
    out.push({ nodeId: p.nodeId, fieldName: p.fieldName, fieldValue: v })
  }
  return out
}

/** 参数默认值表，供界面初始化 */
export function defaultParamValues(params: WorkflowParam[]): Record<string, string> {
  const v: Record<string, string> = {}
  for (const p of params) v[p.nodeId] = p.value
  return v
}
