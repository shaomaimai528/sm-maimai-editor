# AI 修图

手机浏览器直接打开就能用的 AI 修图应用。支持选区、蒙版与多渠道 AI 生成，**纯静态部署，不需要服务器和域名**。

## 特性

- **选区与蒙版**：自由套索、魔术棒、蒙版笔刷（可擦可补）、羽化、反选、扩张收缩
- **非破坏性编辑**：所有操作存为参数，可反复修改；撤销重做完整
- **图层体系**：蒙版是图层属性，AI 结果永远作为新图层插入，不覆盖原像素
- **多渠道 AI**：RunningHub、GRS、阿吉 Aji、墨墨 Momo、OpenAI 共 7 个内置渠道，一套 UI 无感切换
- **自定义渠道**：界面里直接接入你自己的接口，支持 OpenAI 兼容格式与私有协议，同步直出或轮询取结果都可
- **无缝贴回**：AI 结果按选区蒙版合成，支持羽化与颜色匹配
- **PWA**：可安装到手机主屏，离线可用

## 快速开始

```bash
npm install
npm run dev -- --host
```

终端会打印局域网地址（形如 `http://192.168.x.x:5173`）。**手机连同一 WiFi，浏览器打开该地址即可实测。**

## 使用流程

1. 点「导入」选择照片
2. 用「套索」或「魔术棒」框选要修改的区域
3. 点右下角蓝色 **AI** 按钮
4. 选渠道、填提示词、点「开始生成」
5. 预览确认后点「插入为新图层」
6. 点右上角下载图标导出

## 配置 API Key

点右上角齿轮进设置页，逐个渠道填写 Key。

> **Key 只保存在本机浏览器（IndexedDB），不会上传到任何服务器。**
> 但静态托管没有服务端保管密钥，这是本架构的固有取舍：
> - 换手机或清缓存需要重新填写
> - 可用设置页的「导出配置」备份，换设备时「导入配置」恢复
> - **切勿把 Key 写进代码提交到公开仓库**

### RunningHub

**只需要填工作流 ID**（在 RunningHub 打开你的工作流，从网址里取那段数字），配合 API Key 就能调用：

```
POST /task/openapi/create
{ "apiKey": "...", "workflowId": "1234567890", "nodeParams": { "prompt": "...", "image": "..." } }
```

应用 ID（appId）是可选的高级项，不填也能用。

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

| 渠道 | Base URL | 说明 |
|---|---|---|
| RunningHub 国内 | `www.runninghub.cn` | 任务制，需轮询；需 appId |
| RunningHub 国际 | `www.runninghub.ai` | 同上 |
| GRS 国内 | `grsai.dakka.com.cn` | Gemini / Banana 系图像模型 |
| GRS 国际 | `grsaiapi.com` | 同上 |
| 阿吉 Aji | `ai.ajiai.top` | NewAPI 中转 |
| 墨墨 Momo | `api.momoapi.icu` | 含两个备用地址，自动回退 |
| OpenAI | `api.openai.com` | gpt-image 系 |

所有渠道的路径、字段名与状态枚举均从两个 Photoshop 插件的代码中核实取得，非推测。

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
