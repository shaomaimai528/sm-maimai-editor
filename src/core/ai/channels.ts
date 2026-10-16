/**
 * 渠道注册表 —— 全部地址与模型目录来自两个 PS 插件逆向核实
 */

import type { Channel, Provider, Family } from './types'
import { runninghubProvider } from './runninghub'
import { grsProvider } from './grs'
import { newapiProvider } from './newapi'
import { openaiProvider } from './openai'

export const ASPECT_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']
export const RESOLUTIONS = ['1K', '2K', '4K']

/** GRS 族的图片模型目录（像素起子中核实） */
const GRS_IMAGE_MODELS = [
  'nano-banana-2', 'nano-banana-2-1k', 'nano-banana-2-2k', 'nano-banana-2-4k',
  'nano-banana-pro', 'nano-banana-pro-1k', 'nano-banana-pro-2k', 'nano-banana-pro-4k',
  'gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview',
  'gemini-3-pro-image-preview', 'gemini-3-pro-image-preview-1k',
  'gemini-3-pro-image-preview-2k', 'gemini-3-pro-image-preview-4k',
  'gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image-preview-1k',
  'gemini-3.1-flash-image-preview-2k', 'gemini-3.1-flash-image-preview-4k',
  'gemini-3.1-flash-lite-image',
  'banana-pro', 'banana-pro-1k', 'banana-pro-2k', 'banana-pro-4k',
  'AJbanana2', 'AJbanana3', 'Banana-pro-A-1k', 'Banana-pro-D-1k',
]

/** NewAPI 族模型名带渠道前缀标记，必须原样透传 */
const NEWAPI_IMAGE_MODELS = [
  '[c]gemini-3-pro-image-preview',
  '[c]gemini-3.1-flash-image-preview',
  '[m]gemini-3.1-flash-image-preview',
  '[yu]gemini-3-pro-image-preview',
  '[yu]gemini-3.1-flash-image-preview',
  '[yu]gemini-3.1-flash-lite-image',
  'mj_imagine',
]

const OPENAI_IMAGE_MODELS = ['gpt-image-2', 'gpt-image-2-mini']

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
  {
    id: 'grs-cn',
    label: 'GRS 国内',
    family: 'grs',
    apiUrl: 'https://grsai.dakka.com.cn',
    imageModels: GRS_IMAGE_MODELS,
    defaultModel: 'gemini-3.1-flash-image-preview',
    aspectRatios: ASPECT_RATIOS,
    resolutions: RESOLUTIONS,
    needsUpload: false,
  },
  {
    id: 'grs-global',
    label: 'GRS 国际',
    family: 'grs',
    apiUrl: 'https://grsaiapi.com',
    imageModels: GRS_IMAGE_MODELS,
    defaultModel: 'gemini-3.1-flash-image-preview',
    aspectRatios: ASPECT_RATIOS,
    resolutions: RESOLUTIONS,
    needsUpload: false,
  },
  {
    id: 'aji',
    label: '阿吉 Aji',
    family: 'newapi',
    apiUrl: 'https://ai.ajiai.top',
    imageModels: NEWAPI_IMAGE_MODELS,
    defaultModel: '[c]gemini-3.1-flash-image-preview',
    aspectRatios: ASPECT_RATIOS,
    resolutions: RESOLUTIONS,
    needsUpload: false,
  },
  {
    id: 'momo',
    label: '墨墨 Momo',
    family: 'newapi',
    apiUrl: 'https://api.momoapi.icu',
    altUrls: ['https://api1.momoapi.icu', 'https://api2.momoapi.icu'],
    imageModels: NEWAPI_IMAGE_MODELS,
    defaultModel: '[yu]gemini-3.1-flash-image-preview',
    aspectRatios: ASPECT_RATIOS,
    resolutions: RESOLUTIONS,
    needsUpload: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    family: 'openai',
    apiUrl: 'https://api.openai.com',
    imageModels: OPENAI_IMAGE_MODELS,
    defaultModel: 'gpt-image-2',
    aspectRatios: ['auto', '1:1', '16:9', '9:16'],
    resolutions: RESOLUTIONS,
    needsUpload: false,
  },
]

const PROVIDERS: Record<Family, Provider> = {
  runninghub: runninghubProvider,
  grs: grsProvider,
  newapi: newapiProvider,
  openai: openaiProvider,
}

export function getChannel(id: string): Channel | undefined {
  return CHANNELS.find((c) => c.id === id)
}

export function getProvider(family: Family): Provider {
  return PROVIDERS[family]
}

/** 指定渠道时，按主地址 + 备用地址依次尝试 */
export function urlsFor(channel: Channel): string[] {
  return [channel.apiUrl, ...(channel.altUrls || [])]
}
