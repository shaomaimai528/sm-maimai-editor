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
  /** RunningHub 专用 */
  runningHubAppId: string
  runningHubWorkflowId: string
  /** OpenAI 是否尝试 edits 路径 */
  openaiUseEdits: boolean
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
