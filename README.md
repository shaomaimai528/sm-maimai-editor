# SM烧麦麦修图

手机浏览器直接打开就能用的 AI 修图应用。支持选区、蒙版与多渠道 AI 生成，**纯静态部署，不需要服务器和域名**。

## 特性

- **选区与蒙版**：矩形框选、自由套索、魔术棒、蒙版笔刷（可擦可补）、羽化、反选、扩张收缩
- **笔刷**：大小、硬度、流量、不透明度四项可调，手感对齐 PS；可涂选区，也可涂图层蒙版
- **图层体系**：缩略图预览、不透明度、9 种混合模式、重命名、复制、增删蒙版
- **非破坏性编辑**：所有操作存为参数，可反复修改；撤销重做完整
- **RunningHub**：工作流可保存与切换，参数从工作流详情实时拉取，无需手抄
- **自定义渠道**：界面里接入任意 OpenAI 兼容接口，模型列表从对方站点自动获取
- **无缝贴回**：AI 结果按选区蒙版合成，支持羽化与颜色匹配，宽高比不一致时居中裁切不变形
- **丝滑缩放**：双指缩放围绕手指锚点，双击在适应窗口与 2 倍间切换
- **PWA**：可安装到手机主屏，离线可用

## 快速开始

```bash
npm install
npm run dev -- --host
```

终端会打印局域网地址（形如 `http://192.168.x.x:5173`）。**手机连同一 WiFi，浏览器打开该地址即可实测。**

## 使用流程

1. 点「导入」选择照片
2. 用「矩形」「套索」或「魔术棒」框选要修改的区域
3. 点右下角蓝色 **AI** 按钮
4. 选渠道；若是 RunningHub，再选工作流并调参数
5. 填提示词，点「开始生成」
6. 预览确认后点「插入为新图层」
7. 点右上角下载图标导出

需要精修边缘时，用「蒙版」笔刷在选区或图层蒙版上涂抹，再重新生成。

## 配置 API Key

点右上角齿轮进设置页，逐个渠道填写 Key。

> **Key 只保存在本机浏览器（IndexedDB），不会上传到任何服务器。**
> 但静态托管没有服务端保管密钥，这是本架构的固有取舍：
> - 换手机或清缓存需要重新填写
> - 可用设置页的「导出配置」备份，换设备时「导入配置」恢复
> - **切勿把 Key 写进代码提交到公开仓库**

### RunningHub

**只需要填 API Key**，然后在 AI 面板的「工作流」下拉里粘贴工作流 ID 并保存。

- 工作流 ID 从 RunningHub 工作流页面的网址里取那段数字
- 保存后会记住，可在下拉里随时切换
- 选中后应用会自动拉取该工作流的全部参数（含中文说明、成功率、平均耗时）
- 参数拉取失败时不放行提交，避免白跑一次扣算力

> 注意区分两个 ID：网址里的 **应用 ID**（appId，用于查询工作流详情）
> 与提交任务用的 **工作流 ID**（workflowId）不一定相同。
> 部分应用没有独立的 workflowId，此时直接以 appId 提交，应用会自动处理。

### 自定义渠道

设置页底部「自定义渠道」→ 添加，可接入任意服务：

| 配置项 | 说明 |
|---|---|
| 接口地址 | 基础地址，如 `https://api.example.com` |
| 模型名 | 多个用英文逗号分隔 |
| 返回方式 | **同步直出图片** 或 **返回任务号需轮询** |
| 提交路径 | 默认 `/v1/images/generations` |
| 轮询路径 | 选了轮询模式时填 |
| 高级 | 字段名映射（图片/提示词/模型/任务号）、鉴权头、dataURL 或表单 |

保存后点「测试连接」可验证地址是否可达、鉴权是否被接受。

模型列表通过 `GET /v1/models` 从对方站点实时获取，不再本地写死 —— 对方上新模型时无需改代码。

### 图片代理

个别渠道生成正常，但把结果图放在**未开放跨域的图床**上，浏览器取不回来（实测 aipais.de 的图在 `disk.aipais.de`）。

在设置页「图片代理」里填一个自建转发地址（如 Cloudflare Worker）即可兜底：

```js
export default {
  async fetch(request) {
    const url = new URL(request.url).searchParams.get('url')
    const resp = await fetch(url)
    const r = new Response(resp.body, resp)
    r.headers.set('Access-Control-Allow-Origin', '*')
    return r
  },
}
```

留空则只用直连，不影响本来正常的渠道。

## 部署到 git（零成本）

代码已配置好 `base: './'` 相对路径，可部署到任意子路径。

### 方案一：Vercel（推荐）

1. 把仓库推到 GitHub
2. 打开 vercel.com，用 GitHub 登录，Import 该仓库
3. 框架选 Vite，直接 Deploy
4. 拿到 `https://xxx.vercel.app`，手机打开即用

### 方案二：Gitee Pages（国内访问最快）

1. 推到 Gitee 仓库
2. 仓库 → 服务 → Gitee Pages → 部署
3. 需实名认证；每次更新代码后要手动点「更新」

### 方案三：GitHub Pages

推送到 GitHub 后，仓库 Settings → Pages → Source 选 GitHub Actions，
新建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/deploy-pages@v4
```

> 实测提示：本机所在网络访问 `github.com` 与 `github.io` 会超时，
> 但 `api.github.com` 通。如果碰到打不开的情况，优先用 Vercel 或 Gitee Pages。

### 手机安装为 App

用手机浏览器打开部署地址 → 分享菜单 → 「添加到主屏幕」。
之后像原生 App 一样从桌面图标启动，全屏无浏览器地址栏。

## 支持的 AI 渠道

**内置渠道**（开箱可用，Key 放在 `src/core/ai/local-keys.ts`，该文件已 gitignore 不入库）：

| 渠道 | Base URL | 实测结果 |
|---|---|---|
| RunningHub 国内 | `www.runninghub.cn` | 已跑通，出图正常 |
| RunningHub 国际 | `www.runninghub.ai` | 同上 |
| 墨墨 | `api.momoapi.icu` | 跨域正常，返回 base64 |
| XEM | `image.xem8k5.top` | 跨域正常，返回 base64 |
| 办办 | `api.banban.plus` | 跨域正常 |
| AIPais | `aipais.de` | 接口通，但结果图在 `disk.aipais.de` 无跨域，需配代理 |
| bear | `ai.bearjia.cn` | 跨域被拦，需配代理 |

**自定义渠道**：任意 OpenAI 兼容接口，模型从 `/v1/models` 自动获取。

两条链路均已端到端实测通过：从选区、生成、预览到插入新图层。

### 实测结论

- `b64_json` 与 `url` 两种返回格式都支持 —— 早期只认 URL，会导致「生成成功但取不到图」
- RunningHub 提交用 `webappId`（传 `appId` 会报 301），轮询必须带 `Authorization` 头（否则报 1602）
- 多数模型会保持输入宽高比（实测输入 800×300 返回 2048×768），个别固定方形输出；贴回时对不一致的情况做居中裁切而非拉伸

## 技术栈

Vite + TypeScript + React 18 + Konva.js + Zustand

- 画布内核用 **Konva.js**（MIT）处理图层与变换
- 像素运算走 Worker + OffscreenCanvas，避免阻塞
- 双分辨率渲染：屏幕只画代理图（长边 1500），导出才按原图重放

## 项目结构

```
src/
├── core/            纯逻辑，无 UI 依赖
│   ├── doc/         数据模型、图层操作、撤销重做
│   ├── selection/   套索、魔术棒、蒙版笔刷、羽化
│   ├── render/      渲染管线、代理图、导出、贴回合成
│   ├── adjust/      曝光/对比/饱和/色温等算子
│   └── ai/          渠道层（7 渠道 + 4 协议族）
├── state/           全局状态与持久化
├── ui/              界面组件
└── styles/          设计令牌
```

## 已知限制

- 首版为单人使用，无账号体系与云同步
- 大图（超过 24MP）会自动降采样以保证流畅
- OpenAI 的图生图（`/v1/images/edits`）为实验性路径，默认关闭
- RunningHub 需自备 appId

## 许可

MIT
