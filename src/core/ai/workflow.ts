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
  /** 全部封面图，用于工作流卡片画廊 */
  covers?: string[]
  params: WorkflowParam[]
  /** 历史成功率（百分比字符串） */
  successRate?: string
  /** 平均耗时（秒） */
  avgSeconds?: string
  tags?: string[]
  /** 作者，来自 owner 字段 */
  author?: string
  /** 累计运行次数 */
  runCount?: string
  /** 发布时间 */
  publishedAt?: string
  /** 应用是否可用（webappState / workflowState 都为 1 才算正常） */
  available?: boolean
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

/** 把封面数组规整成 URL 列表 */
function coverList(d: any): string[] {
  const out: string[] = []
  for (const k of ['covers', 'chineseCovers', 'englishCovers']) {
    const arr = d?.[k]
    if (!Array.isArray(arr)) continue
    for (const c of arr) {
      const url = typeof c === 'string' ? c : (c?.url || c?.coverUrl || c?.imageUrl)
      if (url && !out.includes(String(url))) out.push(String(url))
    }
    // 优先用主 covers，拿到了就不必再收其他语言版本
    if (out.length) break
  }
  return out
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
  const covers = coverList(d)

  return {
    webappId: String(d.id ?? id),
    // 部分工作流没有独立的 workflowId（值为 null），
    // 这类应用直接以 webappId 提交，不能退回用户手填的 ID，否则会跑错工作流
    workflowId: d.workflowId ? String(d.workflowId) : '',
    name: String(d.name ?? '未命名工作流'),
    description: typeof d.description === 'string'
      ? d.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : undefined,
    coverUrl: covers[0],
    covers,
    params,
    successRate: d.runningSuccessRate != null ? String(d.runningSuccessRate) : undefined,
    avgSeconds: d.avgRunningSeconds != null ? String(d.avgRunningSeconds) : undefined,
    tags: Array.isArray(d.tags) ? d.tags.map((t: any) => t?.name).filter(Boolean) : undefined,
    author: d.owner?.name || d.owner?.nickName || d.owner?.userName || undefined,
    /**
     * 运行次数藏在 statisticsInfo 里，字段名各版本不一致，逐个兜底。
     * 拿不到就不显示，不要编一个数字出来。
     */
    runCount: (() => {
      const s = d.statisticsInfo || {}
      const v = s.runCount ?? s.runningCount ?? s.useCount ?? s.totalRunCount ?? s.viewCount
      return v == null ? undefined : String(v)
    })(),
    publishedAt: typeof d.publishTime === 'string'
      ? d.publishTime.slice(0, 10)
      : undefined,
    /**
     * 应用是否可用
     *
     * 只认 webappState，不看 workflowState。
     * workflowState 并不可靠：同一个工作流，从 Node 直接请求返回 1，
     * 从浏览器请求却返回 0 —— 而它明明能正常出图（已实测跑通）。
     * 按它判断会把好用的工作流标成"已下架"，吓得用户不敢点。
     * 宁可漏报也不要误报：误报会直接挡住用户干活。
     */
    available: d.webappState === 1,
  }
}

/**
 * 组装提交用的 nodeInfoList
 *
 * 三条规则：
 *  1. 全部参数都要提交 —— 不能只交"用户改动过的"。
 *     用户看不出哪些值被自己动过，界面显示的就是他期望生效的全套值；
 *     漏交则工作流用它自己的默认跑，界面与结果对不上。
 *  2. 图片字段只传上传得到的 token，绝不传 base64。
 *  3. 数值按类型真正转成 number / boolean，字符串化的数字节点可能不认。
 */
export function buildNodeInfoList(
  params: WorkflowParam[],
  overrides: Record<string, string | undefined>,
  imageFilename?: string,
): Array<{ nodeId: string; fieldName: string; fieldValue: any }> {
  const out: Array<{ nodeId: string; fieldName: string; fieldValue: any }> = []
  for (const p of params) {
    // 界面上没有这一项时退回工作流默认值
    const raw = overrides[p.nodeId] ?? p.value

    // 图片字段传上传返回的文件标识，真实像素由上传接口单独处理
    if (isImageParam(p)) {
      const v = imageFilename || String(raw ?? '')
      if (v) out.push({ nodeId: p.nodeId, fieldName: p.fieldName, fieldValue: v })
      continue
    }

    if (raw === undefined) continue
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

/**
 * 工作流里哪一项是"要改什么"的说明
 *
 * 这类后端的 Klein / Qwen 编辑流普遍如此：一个 PrimitiveStringMultiline 节点
 * 承载用户指令，字段名是 value 而不是 prompt —— 所以不能靠字段名去猜。
 * 判据同样是类型：STRING（含多行）就是编辑指令。
 *
 * 匹配优先级：中文说明像提示词 → 字段名像提示词 → 排第一个的多行文本
 */
const PROMPT_LABEL_HINT = /提示词|prompt|指令|描述|编辑/i

export function promptParamOf(params: WorkflowParam[]): WorkflowParam | null {
  const textParams = params.filter(
    (p) => p.fieldType.toUpperCase() === 'STRING' && !isImageParam(p),
  )
  if (!textParams.length) return null

  const excluded = /^(value|参考|reference)$/i
  const byLabel = textParams.find((p) => PROMPT_LABEL_HINT.test(p.label) && !excluded.test(p.label))
  if (byLabel) return byLabel

  const byName = textParams.find((p) => /prompt|text|instruction/i.test(p.fieldName))
  if (byName) return byName

  // 没有线索时取第一个非"版权声明"之类的文本参数
  return textParams.find((p) => !excluded.test(p.label)) || textParams[0]
}

/** 参数默认值表，供界面初始化 */
export function defaultParamValues(params: WorkflowParam[]): Record<string, string> {
  const v: Record<string, string> = {}
  for (const p of params) v[p.nodeId] = p.value
  return v
}
