/**
 * 密钥统一入口
 *
 * 这里始终 re-export local-keys：
 *   - 本机开发时，vite.config.ts 会把 './local-keys' 别名到真实文件
 *   - 没有该文件的环境（CI、公开部署），别名指向 local-keys.fallback（全空）
 *
 * 业务代码只 import 本文件，不直接引用 local-keys，
 * 这样就不需要为「文件是否存在」写任何运行时判断。
 */

export * from './local-keys'
