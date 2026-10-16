/**
 * 空密钥兜底（入库）
 *
 * 当本机存在 local-keys.ts 时，vite 别名会把它替换成真实密钥；
 * 不存在时（CI、公开部署、别人克隆）就落到这里，全部为空。
 *
 * 这样既保证真实密钥永不入库，又保证任何环境都能正常构建。
 * 结构必须与 local-keys.example.ts 保持一致。
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
  momo: '', aipais: '', banban: '', bear: '', xem: '',
  t8star: '', grsCn: '', grsGlobal: '', zhongmo: '',
  sillydream: '', xiangongyun: '', aji: '', openai: '',
}

export const LOCAL_RUNNINGHUB = {
  apiKey: '',
  workflowId: '',
}

export const LOCAL_WORKFLOWS: Array<{ webappId: string; name: string }> = []
