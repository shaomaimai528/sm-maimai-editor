/**
 * 预置渠道
 *
 * 数据来源：HHPS 插件（Hybrid Hub PS）的用户配置
 *   %APPDATA%\Adobe\UXP\PluginsStorage\PHSP\22\Hybrid Hub PS\PluginData\settings.json
 * 其中 nb_gem_channels 字段保存了用户已配置好的渠道（地址 + Key + 模型清单）。
 *
 * 这里只预置「地址与协议」，**不预置 Key**。
 * 原因：本仓库会发布到公开的静态托管，源码里写密钥等于公开泄露额度。
 * Key 由 local-keys.ts 提供，该文件已被 .gitignore 排除，只存在于开发者本机。
 *
 * 已用真实浏览器实测跨域（从 https://example.com 源发起）：
 *   墨墨  GET /v1/models → HTTP 200，返回 51 个模型
 *   二狗  GET /v1/models → HTTP 200，返回 4 个模型
 * 两条都可直连，无需服务端中转。
 *
 * apiFormat 区别：
 *   'openai' —— 走 /v1/images/generations，请求体 { model, prompt, image }
 *   'gemini' —— 走 Gemini 原生 generateContent，请求体结构不同
 * 两者不能混用。
 */

import type { CustomSpec } from './types'
import { LOCAL_KEYS, LOCAL_RUNNINGHUB } from './local-keys'

export interface ChannelPreset {
  /** 稳定标识，用于生成渠道 id */
  key: string
  label: string
  apiUrl: string
  /** 默认模型，用户可在界面改；模型列表会自动从对方拉取 */
  defaultModel: string
  /** 本机 Key，来自 gitignore 的 local-keys.ts；仓库里始终为空 */
  apiKey?: string
  spec: CustomSpec
}

/** OpenAI 兼容协议：/v1/images/generations */
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

/** Gemini 原生协议：generateContent，图片以 inline_data 传入 */
const GEMINI_NATIVE: CustomSpec = {
  mode: 'sync',
  submitPath: '/v1beta/models/{model}:generateContent',
  imageField: 'inline_data',
  promptField: 'text',
  modelField: 'model',
  taskIdField: 'taskId',
  imageAsDataUrl: true,
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
}

export const CHANNEL_PRESETS: ChannelPreset[] = [
  {
    key: 'momo',
    label: '墨墨',
    apiUrl: 'https://api.momoapi.icu',
    defaultModel: 'gpt-image-2',
    apiKey: LOCAL_KEYS.momo,
    spec: OPENAI_COMPAT,
  },
  {
    key: 'ergouzi',
    label: '二狗',
    apiUrl: 'https://ergouzi.life',
    defaultModel: 'gpt-image-2',
    apiKey: LOCAL_KEYS.ergouzi,
    spec: OPENAI_COMPAT,
  },
  {
    key: 'aipais',
    label: 'AIPais',
    apiUrl: 'https://aipais.de',
    defaultModel: 'gpt-image-2.5-sunburst',
    apiKey: LOCAL_KEYS.aipais,
    spec: OPENAI_COMPAT,
  },
  {
    key: 't8star',
    label: 'T8Star',
    apiUrl: 'https://ai.t8star.cn',
    defaultModel: 'gpt-image-2',
    apiKey: LOCAL_KEYS.t8star,
    spec: OPENAI_COMPAT,
  },
  {
    key: 'grs-cn',
    label: 'GRS 国内',
    apiUrl: 'https://grsai.dakka.com.cn',
    defaultModel: 'nano-banana-pro',
    apiKey: LOCAL_KEYS.grsCn,
    spec: OPENAI_COMPAT,
  },
  {
    key: 'grs-global',
    label: 'GRS 国际',
    apiUrl: 'https://grsaiapi.com',
    defaultModel: 'nano-banana-pro',
    apiKey: LOCAL_KEYS.grsGlobal,
    spec: OPENAI_COMPAT,
  },
  {
    key: 'zhongmo',
    label: '中墨',
    apiUrl: 'https://apinb.zhongmodinb.com',
    defaultModel: 'nano-banana-pro',
    apiKey: LOCAL_KEYS.zhongmo,
    spec: OPENAI_COMPAT,
  },
  {
    key: 'sillydream',
    label: 'SillyDream',
    apiUrl: 'https://want.sillydream.top',
    defaultModel: 'nano-banana-pro',
    apiKey: LOCAL_KEYS.sillydream,
    spec: OPENAI_COMPAT,
  },
  {
    key: 'xiangongyun',
    label: '仙宫云',
    apiUrl: 'https://api.xiangongyun.com/open',
    defaultModel: 'nano-banana-pro',
    apiKey: LOCAL_KEYS.xiangongyun,
    spec: OPENAI_COMPAT,
  },
  {
    key: 'aji',
    label: '阿吉 Aji',
    apiUrl: 'https://ai.ajiai.top',
    defaultModel: 'nano-banana-pro',
    apiKey: LOCAL_KEYS.aji,
    spec: OPENAI_COMPAT,
  },
  {
    key: 'openai',
    label: 'OpenAI 官方',
    apiUrl: 'https://api.openai.com',
    defaultModel: 'gpt-image-1',
    apiKey: LOCAL_KEYS.openai,
    spec: OPENAI_COMPAT,
  },
]

/** RunningHub 的本机配置（Key 同样来自 local-keys.ts） */
export const RUNNINGHUB_DEFAULTS = LOCAL_RUNNINGHUB

/** Gemini 原生协议，供用户按需选择 */
export const GEMINI_SPEC = GEMINI_NATIVE

/** 预设 key 对应的渠道 id 前缀，避免与内置渠道冲突 */
export const PRESET_ID_PREFIX = 'preset-'
