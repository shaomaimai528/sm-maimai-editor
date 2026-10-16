/** AI 渠道层的统一抽象 —— UI 只认这套接口，不感知底层协议差异 */

export type Family = 'runninghub' | 'grs' | 'newapi' | 'openai' | 'custom'

/** 自定义渠道的协议配置 */
export interface CustomSpec {
  /** 返回方式：同步直出图片，或返回任务号需轮询 */
  mode: 'sync' | 'poll'
  /** 提交路径，默认 /v1/images/generations */
  submitPath: string
  /** 轮询路径（mode 为 poll 时必填） */
  pollPath?: string
  /** 请求体里的图片字段名，默认 image */
  imageField?: string
  /** 提示词字段名，默认 prompt */
  promptField?: string
  /** 模型字段名，默认 model */
  modelField?: string
  /** 轮询时用的任务号字段名，默认 taskId */
  taskIdField?: string
  /** 是否把图片以 dataURL 形式内嵌进 JSON（false 则用 multipart 表单） */
  imageAsDataUrl?: boolean
  /**
   * 是否要求对方以 base64 返回图片，默认 true
   *
   * 很多中转把结果图放在没开跨域的对象存储上，浏览器读不到，
   * 表现是「生成成功但取不回图」。要成 base64 就绕开了这个问题。
   * 不认该参数的站点会忽略它并照常返回 url，所以默认打开无副作用。
   */
  base64First?: boolean
  /** 鉴权头名称，默认 Authorization */
  authHeader?: string
  /** 鉴权值前缀，默认 "Bearer " */
  authPrefix?: string
  /** 额外请求头 */
  extraHeaders?: Record<string, string>
}

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
  /** 用户自定义渠道的协议细节 */
  custom?: CustomSpec
  /** 是否为用户自建渠道（可编辑、可删除） */
  isUserDefined?: boolean
}

export interface SubmitRequest {
  prompt: string
  /** 图片的 base64 dataURL（图生图用），可选 */
  imageDataUrl?: string
  /**
   * 待上传的图片本体
   *
   * 需要上传（needsUpload）的渠道直接给 Blob 更省事：
   * 走 dataURL 要先编码成 base64 再解码回来，一张 4K 图白耗上百毫秒与两倍内存，
   * 而这类渠道根本不需要 dataURL。
   * 与 imageDataUrl 二者给其一即可。
   */
  sourceBlob?: Blob
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
  /**
   * 拉取该渠道可用的图片模型列表
   * 有则界面上「模型」变为下拉可选，没有则退化为手填
   */
  listImageModels?(apiKey: string, baseUrl: string): Promise<string[]>
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
