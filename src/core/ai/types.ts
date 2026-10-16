/** AI 渠道层的统一抽象 —— UI 只认这套接口，不感知底层协议差异 */

export type Family = 'runninghub' | 'grs' | 'newapi' | 'openai'

export interface Channel {
  id: string
  label: string
  family: Family
  /** 主地址 */
  apiUrl: string
  /** 备用地址，按序尝试 */
  altUrls?: string[]
  /** 需要 region 切换的渠道用这张表 */
  regions?: { cn: string; global: string }
  /** 可用的图片模型目录 */
  imageModels: string[]
  /** 默认选中模型 */
  defaultModel?: string
  aspectRatios: string[]
  resolutions: string[]
  /** 该渠道是否需要先上传图片拿 token */
  needsUpload: boolean
}

export interface SubmitRequest {
  prompt: string
  /** 图片的 base64 dataURL（图生图用），可选 */
  imageDataUrl?: string
  /** 已上传得到的 file token（RunningHub 用） */
  fileToken?: string
  model: string
  aspectRatio?: string
  resolution?: string
  /** 渠道相关的额外参数 */
  extra?: Record<string, unknown>
}

export type PollResult =
  | { status: 'pending'; progress?: number }
  | { status: 'done'; imageUrl: string }
  | { status: 'failed'; message: string }

export interface Balance {
  /** 余额数值；null 表示不限量或未知 */
  balance: number | null
  currency: string
  unlimited?: boolean
}

export interface Provider {
  family: Family
  /** 上传图片，返回 file token；不需要上传的渠道返回空串 */
  upload?(blob: Blob, apiKey: string, baseUrl: string): Promise<string>
  /** 提交任务，返回 taskId（或直出图片 URL） */
  submit(req: SubmitRequest, apiKey: string, baseUrl: string): Promise<SubmitOutcome>
  /** 轮询任务 */
  poll(taskId: string, apiKey: string, baseUrl: string): Promise<PollResult>
  cancel?(taskId: string, apiKey: string, baseUrl: string): Promise<void>
  fetchBalance?(apiKey: string, baseUrl: string): Promise<Balance>
}

/** 提交结果：可能是任务 id（需轮询），也可能直接返回图片 */
export type SubmitOutcome =
  | { kind: 'task'; taskId: string }
  | { kind: 'image'; imageUrl: string }

export class AIError extends Error {
  constructor(message: string, public detail?: unknown) {
    super(message)
    this.name = 'AIError'
  }
}
