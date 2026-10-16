/**
 * 设置持久化 —— API Key 只存本机，绝不上传、绝不入库
 *
 * 静态托管没有服务端保管密钥，这是这套架构必须接受的取舍。
 * 缓解手段：支持导出/导入配置，换设备时不用重填。
 */

import { get, set } from 'idb-keyval'
import { CHANNEL_PRESETS, PRESET_ID_PREFIX, RUNNINGHUB_DEFAULTS, WORKFLOW_DEFAULTS } from '../core/ai/presets'

export interface ChannelCredential {
  channelId: string
  apiKey: string
}

/** 用户自建渠道的持久化结构 */
export interface UserChannelConfig {
  id: string
  label: string
  apiUrl: string
  models: string
  mode: 'sync' | 'poll'
  submitPath: string
  pollPath: string
  imageField: string
  promptField: string
  modelField: string
  taskIdField: string
  imageAsDataUrl: boolean
  authHeader: string
  authPrefix: string
}

export interface AppSettings {
  credentials: ChannelCredential[]
  activeChannelId: string
  activeModel: string
  aspectRatio: string
  resolution: string
  /** 贴回时的羽化半径 */
  featherRadius: number
  /** 贴回时是否做颜色匹配 */
  colorMatch: boolean
  /** RunningHub 专用：只需工作流 ID */
  runningHubWorkflowId: string
  /** RunningHub 可选：应用 ID（通常不用填） */
  runningHubAppId: string
  /** OpenAI 是否尝试 edits 路径 */
  openaiUseEdits: boolean
  /** 用户自建渠道列表 */
  userChannels: UserChannelConfig[]
  /** 各渠道上次选中的模型，切回自动恢复 */
  lastModelByChannel: Record<string, string>
  /** 各渠道缓存的模型列表（拉取过一次就记住，避免重复请求） */
  modelCacheByChannel: Record<string, string[]>
  /** 是否每次打开都回到默认渠道，false 则沿用上次用的 */
  rememberLastChannel: boolean
  /** 保存的 RunningHub 工作流，可切换 */
  savedWorkflows: SavedWorkflow[]
  /** 当前选中的工作流 ID */
  activeWorkflowId: string

  /**
   * 结果图代理前缀（可选）
   * 部分渠道生成的图片放在不带跨域头的图床上，浏览器取不回来。
   * 填一个自建转发地址即可兜底，留空则只用直连。
   */
  imageProxy: string
}

/** 用户保存的 RunningHub 工作流 */
export interface SavedWorkflow {
  webappId: string
  name: string
  coverUrl?: string
  savedAt: number
}

/**
 * 取某渠道当前应使用的模型
 * 优先用记住的，其次用渠道默认，最后取列表第一个
 */
export function resolveModel(
  s: AppSettings,
  channelId: string,
  channelDefault?: string,
  channelModels?: string[],
): string {
  const remembered = s.lastModelByChannel?.[channelId]
  // 记住的模型若已不在列表里（渠道调整过），则弃用
  if (remembered && (!channelModels?.length || channelModels.includes(remembered))) {
    return remembered
  }
  if (s.activeChannelId === channelId && s.activeModel) return s.activeModel
  return channelDefault || channelModels?.[0] || ''
}

export function makeDefaultUserChannel(id: string): UserChannelConfig {
  return {
    id,
    label: '',
    apiUrl: '',
    models: '',
    mode: 'sync',
    submitPath: '/v1/images/generations',
    pollPath: '',
    imageField: 'image',
    promptField: 'prompt',
    modelField: 'model',
    taskIdField: 'taskId',
    imageAsDataUrl: true,
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  credentials: [],
  activeChannelId: 'runninghub-cn',
  activeModel: '',
  aspectRatio: 'auto',
  resolution: '1K',
  featherRadius: 12,
  colorMatch: true,
  runningHubAppId: '',
  runningHubWorkflowId: '',
  openaiUseEdits: false,
  userChannels: [],
  lastModelByChannel: {},
  modelCacheByChannel: {},
  rememberLastChannel: true,
  savedWorkflows: [],
  activeWorkflowId: '',
  /**
   * 结果图代理前缀（可选）
   * 部分渠道生成的图片放在不带跨域头的图床上，浏览器取不回来。
   * 填一个自建转发地址即可兜底，留空则只用直连。
   */
  imageProxy: '',
}

const KEY = 'app-settings-v1'

/**
 * 首次运行时预置用户已配置好的渠道与其 Key
 *
 * 数据来自用户自己的 HHPS 插件配置，
 * 目的是开箱即用 —— 不必把地址和 Key 重抄一遍。
 * 用户随时可在设置里改或删。
 */
function seedPresets(s: AppSettings): AppSettings {
  // 只补缺失的部分，不覆盖用户已有的配置。
  // 早期版本用 "已有数据就整体跳过"，会导致后来新增的预置渠道永远进不来。
  const have = new Set(s.userChannels.map((c) => c.id))
  const haveKey = new Set(s.credentials.filter((c) => c.apiKey).map((c) => c.channelId))

  const userChannels: UserChannelConfig[] = [...(s.userChannels || [])]
  const credentials: ChannelCredential[] = [...(s.credentials || [])]
  const lastModelByChannel: Record<string, string> = { ...(s.lastModelByChannel || {}) }

  for (const p of CHANNEL_PRESETS) {
    if (!p.apiKey) continue
    const id = PRESET_ID_PREFIX + p.key
    if (have.has(id)) {
      // 渠道已存在，只补 Key（用户可能清空过）
      if (!haveKey.has(id)) credentials.push({ channelId: id, apiKey: p.apiKey })
      continue
    }
    userChannels.push({
      id,
      label: p.label,
      apiUrl: p.apiUrl,
      models: p.defaultModel,
      mode: p.spec.mode,
      submitPath: p.spec.submitPath || '/v1/images/generations',
      pollPath: p.spec.pollPath || '',
      imageField: p.spec.imageField || 'image',
      promptField: p.spec.promptField || 'prompt',
      modelField: p.spec.modelField || 'model',
      taskIdField: p.spec.taskIdField || 'taskId',
      imageAsDataUrl: p.spec.imageAsDataUrl !== false,
      authHeader: p.spec.authHeader || 'Authorization',
      authPrefix: p.spec.authPrefix ?? 'Bearer ',
    })
    credentials.push({ channelId: id, apiKey: p.apiKey })
    lastModelByChannel[id] = p.defaultModel
  }

  // RunningHub 的 Key 与工作流也一并带入（来自同一份 HHPS 配置）
  if (RUNNINGHUB_DEFAULTS.apiKey && !haveKey.has('runninghub-cn')) {
    credentials.push({ channelId: 'runninghub-cn', apiKey: RUNNINGHUB_DEFAULTS.apiKey })
  }
  // 工作流列表：合并用户已有的与预置的，按 webappId 去重
  const seen = new Set((s.savedWorkflows || []).map((w) => w.webappId))
  const savedWorkflows: SavedWorkflow[] = [
    ...(s.savedWorkflows || []),
    ...WORKFLOW_DEFAULTS
      .filter((w) => !seen.has(w.webappId))
      .map((w) => ({ webappId: w.webappId, name: w.name, savedAt: Date.now() })),
  ]

  return {
    ...s,
    userChannels,
    credentials,
    lastModelByChannel,
    savedWorkflows,
    activeWorkflowId: s.activeWorkflowId || savedWorkflows[0]?.webappId || '',
    runningHubWorkflowId: s.runningHubWorkflowId || RUNNINGHUB_DEFAULTS.workflowId,
    // 只在用户还没选过渠道时才替他选第一个，避免覆盖已有偏好
    activeChannelId: s.activeChannelId || userChannels[0]?.id || DEFAULT_SETTINGS.activeChannelId,
    activeModel: s.activeModel || (userChannels.length ? lastModelByChannel[userChannels[0].id] : ''),
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const saved = await get<Partial<AppSettings>>(KEY)
    return seedPresets({ ...DEFAULT_SETTINGS, ...(saved || {}) })
  } catch {
    return seedPresets({ ...DEFAULT_SETTINGS })
  }
}

export async function saveSettings(s: AppSettings): Promise<void> {
  try {
    await set(KEY, s)
  } catch (e) {
    console.warn('设置保存失败', e)
  }
}

export function getKeyFor(s: AppSettings, channelId: string): string {
  return s.credentials.find((c) => c.channelId === channelId)?.apiKey || ''
}

export function setKeyFor(s: AppSettings, channelId: string, apiKey: string): AppSettings {
  const rest = s.credentials.filter((c) => c.channelId !== channelId)
  const credentials = apiKey ? [...rest, { channelId, apiKey }] : rest
  return { ...s, credentials }
}

/** 导出配置（含 key），供用户自行备份到可信位置 */
export function exportSettings(s: AppSettings): string {
  return JSON.stringify(s, null, 2)
}

export function importSettings(json: string): AppSettings {
  const parsed = JSON.parse(json)
  return { ...DEFAULT_SETTINGS, ...parsed }
}
