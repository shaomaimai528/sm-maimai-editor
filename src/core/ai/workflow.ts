/**
 * RunningHub 工作流参数获取
 *
 * 用户填工作流 ID，这里取回该工作流的可调参数（提示词、图片、数值滑杆等），
 * 供界面上直接编辑。接口路径与字段名从像素起子插件中核实取得。
 *
 * 端点候选顺序照搬插件：detail → getDetail → info → getInfo → query → get
 * 参数名依次尝试 workflowId / webappId / appId / id
 */

import { AIError } from './types'

/** 单个可调参数 */
export interface WorkflowParam {
  /** 提交时用的节点 ID */
  nodeId: string
  /** 参数字段名，如 text / image / seed */
  fieldName: string
  /** 界面显示名 */
  label: string
  /** 控件类型 */
  type: 'text' | 'image' | 'number' | 'select' | 'boolean'
  /** 当前值 */
  value: string | number | boolean
  /** number 类型的范围 */
  min?: number
  max?: number
  step?: number
  /** select 类型的可选项 */
  options?: string[]
  /** 是否必填 */
  required?: boolean
  /** 描述文字 */
  description?: string
}

export interface WorkflowInfo {
  id: string
  name: string
  description: string
  params: WorkflowParam[]
  /** 原始返回，便于排查 */
  raw: unknown
}

const DETAIL_PATHS = [
  '/api/webapp/detail',
  '/api/webapp/getDetail',
  '/api/webapp/info',
  '/api/webapp/getInfo',
  '/api/webapp/query',
  '/api/webapp/get',
  '/uc/openapi/app',
  '/uc/openapi/community/app',
]

const ID_KEYS = ['workflowId', 'webappId', 'appId', 'id']

/** 递归搜索指定键名的值 —— 各接口返回结构差异极大，只能宽进 */
function findDeep(obj: unknown, keys: string[], depth = 0): unknown {
  if (depth > 6 || !obj || typeof obj !== 'object') return undefined
  const o = obj as Record<string, unknown>
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]
  }
  for (const v of Object.values(o)) {
    const r = findDeep(v, keys, depth + 1)
    if (r !== undefined) return r
  }
  return undefined
}

/** 递归找出所有参数数组 —— 插件里列了十几种可能的容器路径 */
function findParamArrays(obj: unknown, depth = 0, out: unknown[][] = []): unknown[][] {
  if (depth > 6 || !obj || typeof obj !== 'object') return out
  const o = obj as Record<string, unknown>
  for (const key of [
    'nodeInfoList', 'inputs', 'params', 'inputParams', 'nodeList', 'nodes',
    'nodeInfo', 'nodeInfos', 'nodeInfoList', 'fields', 'parameters',
  ]) {
    const v = o[key]
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') out.push(v)
  }
  for (const v of Object.values(o)) findParamArrays(v, depth + 1, out)
  return out
}

/** 把控件类型字符串归一到我们支持的几种 */
function normalizeType(raw: unknown, fieldName: string): WorkflowParam['type'] {
  const t = String(raw ?? '').toLowerCase()
  const f = fieldName.toLowerCase()
  if (t.includes('image') || t.includes('file') || t.includes('img')) return 'image'
  if (f.includes('image') || f === 'img' || f.includes('photo')) return 'image'
  if (t.includes('number') || t.includes('int') || t.includes('float') || t.includes('slider')) return 'number'
  if (f.includes('seed') || f.includes('step') || f.includes('cfg') || f.includes('denoise')) return 'number'
  if (t === 'list' || t.includes('select') || t.includes('enum') || t.includes('option')) return 'select'
  if (t.includes('bool') || t.includes('checkbox') || t.includes('toggle')) return 'boolean'
  return 'text'
}

/** 从一条原始记录解析出统一的参数结构 */
function parseParam(item: unknown): WorkflowParam | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, any>

  const nodeId = String(o.nodeId ?? o.nodeID ?? o.node_id ?? o.id ?? '')
  const fieldName = String(o.fieldName ?? o.field ?? o.name ?? o.key ?? o.paramKey ?? '')
  if (!fieldName) return null

  // 界面名优先取中文描述
  const label = String(
    o.description ?? o.label ?? o.title ?? o.name ?? fieldName
  ).slice(0, 40)

  const type = normalizeType(o.fieldType ?? o.type ?? o.valueType, fieldName)

  let value: string | number | boolean = ''
  const raw = o.fieldValue ?? o.value ?? o.defaultValue ?? o.default ?? ''
  if (type === 'number') {
    const n = Number(raw)
    value = Number.isFinite(n) ? n : 0
  } else if (type === 'boolean') {
    value = raw === true || raw === 'true' || raw === 1 || raw === '1'
  } else {
    value = raw === undefined || raw === null ? '' : String(raw)
  }

  const p: WorkflowParam = { nodeId, fieldName, label, type, value }

  // 范围与选项
  const min = Number(o.min ?? o.minimum ?? o.minValue)
  const max = Number(o.max ?? o.maximum ?? o.maxValue)
  if (Number.isFinite(min)) p.min = min
  if (Number.isFinite(max)) p.max = max
  const step = Number(o.step ?? o.precision)
  if (Number.isFinite(step) && step > 0) p.step = step

  const opts = o.options ?? o.optionList ?? o.enumValues ?? o.values
  if (Array.isArray(opts)) {
    p.options = opts.map((x: any) =>
      typeof x === 'object' ? String(x?.label ?? x?.name ?? x?.value ?? '') : String(x)
    ).filter(Boolean)
  }

  if (o.required === true) p.required = true
  if (o.description && o.description !== label) p.description = String(o.description).slice(0, 100)

  return p
}

/** 构造带查询参数的 URL */
function buildUrl(base: string, path: string, key: string, id: string): string {
  const u = new URL(base.replace(/\/+$/, '') + path)
  u.searchParams.set(key, id)
  return u.toString()
}

/**
 * 获取工作流详情
 * 逐个尝试端点与参数名组合，第一个成功即返回。
 */
export async function fetchWorkflow(
  workflowId: string,
  apiKey: string,
  baseUrl: string,
): Promise<WorkflowInfo> {
  const id = String(workflowId || '').trim()
  if (!id) throw new AIError('请先填写工作流 ID')

  const errors: string[] = []

  for (const path of DETAIL_PATHS) {
    for (const key of ID_KEYS) {
      let url: string
      try { url = buildUrl(baseUrl, path, key, id) } catch { continue }

      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(15000),
        })

        const text = await resp.text()
        let json: any = null
        try { json = text ? JSON.parse(text) : null } catch { continue }
        if (!json) continue

        // 业务错误码：非 0 视为失败，继续试下一组合
        const code = json.code
        if (code !== undefined && code !== 0 && code !== 200) {
          errors.push(`${path} (${key}): ${json.msg || json.message || code}`)
          continue
        }

        const arrays = findParamArrays(json)
        if (!arrays.length) {
          errors.push(`${path} (${key}): 返回中未找到参数列表`)
          continue
        }

        // 取参数最多的一组，通常就是主节点列表
        const best = arrays.reduce((a, b) => (b.length > a.length ? b : a))
        const params = best.map(parseParam).filter((p): p is WorkflowParam => !!p)

        if (!params.length) {
          errors.push(`${path} (${key}): 参数列表为空`)
          continue
        }

        const name = String(
          findDeep(json, ['webappName', 'workflowName', 'appName', 'name', 'title']) ?? '工作流'
        )
        const description = String(
          findDeep(json, ['description', 'desc', 'summary']) ?? ''
        ).slice(0, 200)

        return { id, name, description, params, raw: json }
      } catch (e) {
        const m = (e as Error)?.message || ''
        if (/abort|timeout/i.test(m)) errors.push(`${path} (${key}): 超时`)
        else errors.push(`${path} (${key}): ${m}`)
      }
    }
  }

  throw new AIError(
    [
      `无法获取工作流 ${id} 的参数`,
      '已尝试的接口都不返回参数列表。常见原因：',
      '· 工作流 ID 不正确',
      '· 该工作流未公开或不属于当前账号',
      '· API Key 无效或无权限',
      '',
      '最近一次错误：' + (errors[0] || '未知'),
    ].join('\n')
  )
}

/** 把界面上的参数值组装成提交用的 nodeInfoList */
export function buildNodeInfoList(params: WorkflowParam[]): unknown[] {
  return params
    .filter((p) => p.value !== '' && p.value !== undefined && p.value !== null)
    .map((p) => ({
      nodeId: p.nodeId,
      fieldName: p.fieldName,
      fieldValue: p.value,
    }))
}
