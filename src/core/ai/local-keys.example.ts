/**
 * 本机密钥的示例文件
 *
 * 使用方式：复制为 local-keys.ts 并填入你自己的 Key。
 *   copy src\core\ai\local-keys.example.ts src\core\ai\local-keys.ts
 *
 * local-keys.ts 已被 .gitignore 排除，不会进入版本库，
 * 因此你的密钥不会被推送到 Gitee / GitHub / Vercel。
 *
 * 留空的项不会生成对应渠道，界面里也随时可以手填。
 */

export const LOCAL_KEYS = {
  momo: '',
  ergouzi: '',
  aipais: '',
  t8star: '',
  grsCn: '',
  grsGlobal: '',
  zhongmo: '',
  sillydream: '',
  xiangongyun: '',
  aji: '',
  openai: '',
} as Record<string, string>

export const LOCAL_RUNNINGHUB = {
  apiKey: '',
  workflowId: '',
}
