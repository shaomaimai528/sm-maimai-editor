/**
 * 设置持久化 —— API Key 只存本机，绝不上传、绝不入库
 *
 * 静态托管没有服务端保管密钥，这是这套架构必须接受的取舍。
 * 缓解手段：支持导出/导入配置，换设备时不用重填。
 */

import { get, set } from 'idb-keyval'

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
  activeChannelId: 'grs-cn',
  activeModel: 'gemini-3.1-flash-image-preview',
  aspectRatio: 'auto',
  resolution: '1K',
  featherRadius: 12,
  colorMatch: true,
  runningHubAppId: '',
  runningHubWorkflowId: '',
  openaiUseEdits: false,
  userChannels: [],
}

const KEY = 'app-settings-v1'

export async function loadSettings(): Promise<AppSettings> {
  try {
    const saved = await get<Partial<AppSettings>>(KEY)
    return { ...DEFAULT_SETTINGS, ...(saved || {}) }
  } catch {
    return { ...DEFAULT_SETTINGS }
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
