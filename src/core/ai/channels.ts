/**
 * 渠道注册表 —— 全部地址与模型目录来自两个 PS 插件逆向核实
 */

/**
 * 渠道注册表
 *
 * 只保留两条路径：
 *  1. RunningHub —— 国内 / 国际两个区域，用户填工作流 ID 调用自己的工作流
 *  2. 自定义 —— 即 OpenAI 兼容格式，用户接入任意服务，模型从对方 /v1/models 自动拉取
 *
 * 曾经内置的 GRS / 阿吉 / 墨墨 / OpenAI 均已移除：
 * 它们本质上都是 OpenAI 兼容接口，用「自定义渠道」接入完全等价，且更灵活。
 */

import type { Channel, Provider, Family } from './types'
import { runninghubProvider } from './runninghub'
import { customProvider } from './custom'

export const ASPECT_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']
export const RESOLUTIONS = ['1K', '2K', '4K']

export const CHANNELS: Channel[] = [
  {
    id: 'rh-cn',
    label: 'RunningHub 国内',
    family: 'runninghub',
    apiUrl: 'https://www.runninghub.cn',
    imageModels: [],
    aspectRatios: ASPECT_RATIOS,
    resolutions: RESOLUTIONS,
    needsUpload: true,
  },
  {
    id: 'rh-global',
    label: 'RunningHub 国际',
    family: 'runninghub',
    apiUrl: 'https://www.runninghub.ai',
    imageModels: [],
    aspectRatios: ASPECT_RATIOS,
    resolutions: RESOLUTIONS,
    needsUpload: true,
  },
]

const PROVIDERS: Record<Family, Provider> = {
  runninghub: runninghubProvider,
  custom: customProvider,
  // 以下三族已不再作为内置渠道，但保留映射以兼容旧配置导入。
  // 它们都是 OpenAI 兼容格式，用「自定义渠道」接入完全等价。
  openai: customProvider,
  grs: customProvider,
  newapi: customProvider,
}

/** 用户自建渠道存放在设置里，这里做合并查询 */
let userChannels: Channel[] = []

export function setUserChannels(list: Channel[]) {
  userChannels = Array.isArray(list) ? list : []
}

export function getUserChannels(): Channel[] {
  return userChannels
}

/** 全部渠道 = 内置 + 用户自建 */
export function allChannels(): Channel[] {
  return [...CHANNELS, ...userChannels]
}

export function getChannel(id: string): Channel | undefined {
  return allChannels().find((c) => c.id === id)
}

/** 创建一条自定义渠道 */
export function makeCustomChannel(input: {
  id: string
  label: string
  apiUrl: string
  models: string[]
  custom: Channel['custom']
}): Channel {
  // models 可能为空（用户还没填模型列表），直接取 [0] 会抛异常把整个界面带崩
  const models = Array.isArray(input.models) ? input.models.filter(Boolean) : []
  return {
    id: input.id,
    label: input.label,
    family: 'custom',
    apiUrl: (input.apiUrl || '').replace(/\/+$/, ''),
    imageModels: models,
    defaultModel: models[0] || '',
    aspectRatios: ASPECT_RATIOS,
    resolutions: RESOLUTIONS,
    needsUpload: false,
    custom: input.custom,
    isUserDefined: true,
  }
}

export function getProvider(family: Family): Provider {
  return PROVIDERS[family]
}

/** 指定渠道时，按主地址 + 备用地址依次尝试 */
export function urlsFor(channel: Channel): string[] {
  return [channel.apiUrl, ...(channel.altUrls || [])]
}
