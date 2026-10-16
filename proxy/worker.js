/**
 * SM烧麦麦修图 · 图片转发代理
 *
 * 用途：部分 AI 渠道生成的图片放在没有跨域头的图床上（如 disk.aipais.de），
 *       浏览器直接取不回来。这个 Worker 负责代为取回并补上跨域头。
 *
 * 部署方式（免费，无需域名）：
 *   1. 打开 https://workers.cloudflare.com/ 用邮箱注册登录
 *   2. 点 Create Worker，把本文件内容全部粘贴进去，Deploy
 *   3. 拿到形如 https://xxx.yyy.workers.dev 的地址
 *   4. 填进 App 的 设置 → 图片代理
 *
 * 用法：https://你的worker.workers.dev/?url=<经过 encodeURIComponent 的原图地址>
 *
 * 安全：只允许转发图片，且限制为 https，避免被当成任意流量的开放代理。
 */

// 允许转发的图片类型
const IMAGE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/avif', 'image/bmp', 'image/svg+xml',
]

/** 允许跨域访问的来源，* 表示不限制 */
const ALLOW_ORIGIN = '*'

function corsHeaders(contentType) {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    // 图片内容基本不变，允许浏览器缓存以省流量
    'Cache-Control': 'public, max-age=86400',
    ...(contentType ? { 'Content-Type': contentType } : {}),
  }
}

export default {
  async fetch(request) {
    // 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('只支持 GET', { status: 405, headers: corsHeaders('text/plain; charset=utf-8') })
    }

    const target = new URL(request.url).searchParams.get('url')
    if (!target) {
      return new Response(
        '缺少 url 参数。用法：/?url=<原图地址>',
        { status: 400, headers: corsHeaders('text/plain; charset=utf-8') },
      )
    }

    let targetUrl
    try {
      targetUrl = new URL(target)
    } catch {
      return new Response('url 参数不是合法地址', { status: 400, headers: corsHeaders('text/plain; charset=utf-8') })
    }

    // 只放行 https，避免明文传输与本地地址探测
    if (targetUrl.protocol !== 'https:') {
      return new Response('只允许转发 https 地址', { status: 400, headers: corsHeaders('text/plain; charset=utf-8') })
    }

    let upstream
    try {
      upstream = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: {
          // 带个常见 UA，个别图床会拦空 UA
          'User-Agent': 'Mozilla/5.0 (compatible; ImageProxy/1.0)',
          Accept: 'image/*,*/*;q=0.8',
        },
        redirect: 'follow',
      })
    } catch (e) {
      return new Response('取回原图失败：' + (e && e.message ? e.message : e), {
        status: 502,
        headers: corsHeaders('text/plain; charset=utf-8'),
      })
    }

    if (!upstream.ok) {
      return new Response('原图返回 HTTP ' + upstream.status, {
        status: upstream.status,
        headers: corsHeaders('text/plain; charset=utf-8'),
      })
    }

    const contentType = (upstream.headers.get('Content-Type') || '').toLowerCase()
    // 只放行图片，防止被当作通用代理滥用
    if (!IMAGE_TYPES.some((t) => contentType.startsWith(t))) {
      return new Response('目标不是图片（Content-Type: ' + contentType + '）', {
        status: 415,
        headers: corsHeaders('text/plain; charset=utf-8'),
      })
    }

    return new Response(upstream.body, {
      status: 200,
      headers: corsHeaders(contentType),
    })
  },
}
