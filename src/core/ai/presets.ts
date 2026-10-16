/**
 * 预置渠道
 *
 * 这些都是 OpenAI 兼容接口，本质就是"自定义渠道"，
 * 只是把地址提前填好，用户拿到就能用，不必手抄域名。
 *
 * 已核实的接口形状（以 aipais.de 为例）：
 *   GET  /v1/models                 → 401 缺 Key（正常，说明端点存在）
 *   POST /v1/images/generations     → 405 GET 不允许（说明是 POST 端点）
 *   POST /v1/chat/completions       → 405 GET 不允许
 * 错误体为 {error:{code,message,type}} —— 标准 OpenAI 格式。
 *
 * 注意：Key 一律由用户自己填。这些平台不提供内置密钥，
 * 预置的只是地址与默认模型。
 */

import type { CustomSpec } from './types'

export interface ChannelPreset {
  /** 稳定标识，用于生成渠道 id */
  key: string
  label: string
  apiUrl: string
  /** 默认模型，用户可在界面改；模型列表会自动从对方拉取 */
  defaultModel: string
  spec: CustomSpec
}

/** OpenAI 兼容渠道的通用协议配置 */
const OPENAI_COMPAT: CustomSpec = {
  mode: 'sync',
  submitPath: '/v1/images/generations',
  imageField: 'image',
  promptField: 'prompt',
  modelField: 'model',
  taskIdField: 'taskId',
  imageAsDataUrl: true,
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
}

export const CHANNEL_PRESETS: ChannelPreset[] = [
  {
    key: 'aipais',
    label: 'AIPais',
    apiUrl: 'https://aipais.de',
    defaultModel: 'gpt-image-2.5-sunburst',
    spec: OPENAI_COMPAT,
  },
  {
    key: 't8star',
    label: 'T8Star',
    apiUrl: 'https://ai.t8star.cn',
    defaultModel: 'gpt-image-2',
    spec: OPENAI_COMPAT,
  },
  {
    key: 'zhongmo',
    label: '中墨',
    apiUrl: 'https://apinb.zhongmodinb.com',
    defaultModel: 'nano-banana-pro',
    spec: OPENAI_COMPAT,
  },
  {
    key: 'sillydream',
    label: 'SillyDream',
    apiUrl: 'https://want.sillydream.top',
    defaultModel: 'nano-banana-pro',
    spec: OPENAI_COMPAT,
  },
  {
    key: 'xiangongyun',
    label: '仙宫云',
    apiUrl: 'https://api.xiangongyun.com/open',
    defaultModel: 'nano-banana-pro',
    spec: OPENAI_COMPAT,
  },
  {
    key: 'grs-cn',
    label: 'GRS 国内',
    apiUrl: 'https://grsai.dakka.com.cn',
    defaultModel: 'nano-banana-pro',
    spec: OPENAI_COMPAT,
  },
  {
    key: 'grs-global',
    label: 'GRS 国际',
    apiUrl: 'https://grsaiapi.com',
    defaultModel: 'nano-banana-pro',
    spec: OPENAI_COMPAT,
  },
  {
    key: 'aji',
    label: '阿吉 Aji',
    apiUrl: 'https://ai.ajiai.top',
    defaultModel: 'nano-banana-pro',
    spec: OPENAI_COMPAT,
  },
  {
    key: 'momo',
    label: '墨墨 Momo',
    apiUrl: 'https://api.momoapi.icu',
    defaultModel: 'nano-banana-pro',
    spec: OPENAI_COMPAT,
  },
  {
    key: 'openai',
    label: 'OpenAI 官方',
    apiUrl: 'https://api.openai.com',
    defaultModel: 'gpt-image-1',
    spec: OPENAI_COMPAT,
  },
]

/** 预设 key 对应的渠道 id 前缀，避免与内置渠道冲突 */
export const PRESET_ID_PREFIX = 'preset-'
