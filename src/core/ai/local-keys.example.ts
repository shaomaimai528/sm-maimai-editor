/**
 * 私用密钥模板
 *
 * 使用方式：把本文件复制为同目录下的 local-keys.ts 并填入真实密钥。
 * local-keys.ts 已被 .gitignore 排除，不会入库。
 *
 * CI 与公开部署环境里没有 local-keys.ts，会走 local-keys.fallback.ts 的空值，
 * 因此构建照常通过，只是所有渠道的 Key 为空，需要用户在设置页自行填写。
 */

export interface LocalKeys {
  momo: string
  aipais: string
  banban: string
  bear: string
  xem: string
  t8star: string
  grsCn: string
  grsGlobal: string
  zhongmo: string
  sillydream: string
  xiangongyun: string
  aji: string
  openai: string
}

export const LOCAL_KEYS: LocalKeys = {
  momo: '',
  aipais: '',
  banban: '',
  bear: '',
  xem: '',
  t8star: '',
  grsCn: '',
  grsGlobal: '',
  zhongmo: '',
  sillydream: '',
  xiangongyun: '',
  aji: '',
  openai: '',
}

export const LOCAL_RUNNINGHUB = {
  apiKey: '',
  workflowId: '',
}

export const LOCAL_WORKFLOWS: Array<{ webappId: string; name: string }> = []
