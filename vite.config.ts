import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const localKeysPath = fileURLToPath(new URL('./src/core/ai/local-keys.ts', import.meta.url))
const fallbackPath = fileURLToPath(new URL('./src/core/ai/local-keys.fallback.ts', import.meta.url))

const hasLocalKeys = existsSync(localKeysPath)
if (!hasLocalKeys) {
  console.log('[vite] 未找到 local-keys.ts，使用空密钥构建（渠道需在设置页自行填 Key）')
}

/**
 * 把 './local-keys' 这个 import 解析到真实文件或空兜底。
 *
 * 真实密钥只存在于本机的 local-keys.ts（已 gitignore），
 * CI 与公开部署环境没有它，落到全空的 fallback，
 * 于是任何环境都能构建，而密钥永不入库。
 */
function localKeysPlugin(): Plugin {
  return {
    name: 'local-keys-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source !== './local-keys' || !importer) return null
      // 只接管 keys.ts 里那一处 import，避免误伤同名模块
      if (!importer.replace(/\\/g, '/').endsWith('/core/ai/keys.ts')) return null
      return hasLocalKeys ? localKeysPath : fallbackPath
    },
  }
}

// base 用相对路径 './'：部署到 GitHub Pages / Gitee Pages 子路径时
// 资源才不会 404 —— 这是静态部署最常见的翻车点
export default defineConfig({
  base: './',
  plugins: [
    localKeysPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'SM烧麦麦修图',
        short_name: '烧麦麦修图',
        description: '手机端 AI 修图，支持选区蒙版与多渠道生成',
        theme_color: '#FFFFFF',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024
      }
    })
  ],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') }
  },
  worker: { format: 'es' },
  server: { host: true }
})
