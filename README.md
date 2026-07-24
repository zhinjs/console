# Zhin Console

Remote Console 静态前端，独立仓库部署到 GitHub Pages（与 [zhin](https://github.com/zhinjs/zhin) 文档站分离）。

- **站点**：`https://console.zhin.dev`（Settings → Pages → Custom domain）
- **Host API**：用户自托管 Zhin（默认 `http://127.0.0.1:8086`），见 [console-remote](https://github.com/zhinjs/zhin/blob/main/docs/console-remote.md)

## 本地开发

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173 ，代理到 VITE_DEV_API（默认 8086）
pnpm build
pnpm preview
```

登录页填写 Host **API Base** + **Token**；Host 的 `corsOrigins` 需包含 Console 站点来源（如 `https://console.zhin.dev`）。

与 Host 对齐的 API（见 `{API Base}/pub/openapi.json`）：

- `GET /entries` — 插件清单
- `POST /api/console/request` — Console RPC（原 WebSocket `type` 信封）
- `GET /api/events` — SSE 推送（`@zhin.js/client` ≥ 1.1.0）
- `GET /api/system/status` — 登录校验

依赖 `@zhin.js/client` **≥ 2.0.5**、`@zhin.js/contract` **≥ 1.0.3**（REST+SSE，不再连 `wss://…/server`；含 agent-stream 与 runtime Token）。

可通过 URL **仅预填** Host 地址（`token` 须在登录页手动输入，勿放在 URL 中）：

```
https://console.zhin.dev/?apiBaseUrl=http://127.0.0.1:8086
```

Demo 构建会写入 `window.__ZHIN_API_TOKEN`（对齐 zhin `deploy/zhin-demo`），UI 与 SDK 均优先读该运行时 Token，避免仅依赖 localStorage。
## Demo 站点（demo.zhin.dev）

**与 console.zhin.dev 不同**：Demo 构建固定预连 `https://zhinjs-demo.hf.space`（Token `zhin-demo`），跳过登录，默认打开 **沙盒**；菜单与正式站一致，不再隐藏管理页。

### 本地联调

```bash
pnpm dev:demo
# 或覆盖为本机 Host
VITE_DEMO_MODE=1 VITE_API_BASE=http://127.0.0.1:8086 VITE_API_TOKEN=... pnpm dev
```

### 生产构建

```bash
cp .env.demo.example .env.demo   # 默认已指向 hf.space / zhin-demo
set -a && source .env.demo && set +a && pnpm build:demo
pnpm pages:prepare   # CONSOLE_PAGES_CNAME=demo.zhin.dev
```

### 部署

- **实际托管**：Cloudflare Pages 项目 `console`（自定义域 `demo.zhin.dev`），监听 **`main`**，构建命令 `pnpm run build:demo`
- push `main` 即自动部署；GitHub Actions `demo-pages.yml` 仅作备用（Pages 环境目前只允许 `main`）
- **Host 侧**：Hugging Face Space [`zhinjs-demo.hf.space`](https://zhinjs-demo.hf.space)（Token `zhin-demo`）

## 目录

| 路径 | 说明 |
|------|------|
| `client/` | 入口 `main.tsx`、Host 壳、`bootstrap/` |
| `console-ui/` | 内置 Console UI（`src/`），构建别名 `@console` |
| `farm.config.ts` | `@console` → `console-ui/src` |
| `client/paths.ts` | Host API 路径常量；UI 默认根路径 `/dashboard` |
| `scripts/prepare-github-pages.mjs` | Pages SPA 回退与 CNAME |

运行时依赖 [@zhin.js/client](https://www.npmjs.com/package/@zhin.js/client)（SDK）与 [@zhin.js/contract](https://www.npmjs.com/package/@zhin.js/contract)（契约常量/类型）。

## CI / Pages

`.github/workflows/pages.yml`：push `main` 即部署。

可选仓库变量：

- `CONSOLE_PAGES_CNAME` — 默认 `console.zhin.dev`
- `CONSOLE_PAGES_BASE` — 自定义域留空；仅 `*.github.io/<repo>/` 子路径时设为 `/console`
