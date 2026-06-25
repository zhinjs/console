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

依赖 `@zhin.js/client` **≥ 1.1.0**（REST+SSE，不再连 `wss://…/server`）。

可通过 URL **仅预填** Host 地址（`token` 须在登录页手动输入，勿放在 URL 中）：

```
https://console.zhin.dev/?apiBaseUrl=http://127.0.0.1:8086
```

## Demo 站点（demo.zhin.dev）

**与 console.zhin.dev 不同**：Demo 构建预连 `demo-api.zhin.dev`，跳过登录，默认打开 **沙盒**，隐藏配置/文件/cron/env 等写操作页。

### 本地联调

```bash
# 终端 1：zhin 仓库 examples/demo-bot
pnpm dev

# 终端 2：Console Demo profile
pnpm dev:demo
# 或指定 Token（与 demo-bot .env DEMO_TOKEN 一致）
VITE_DEMO_MODE=1 VITE_API_BASE=http://127.0.0.1:8086 VITE_API_TOKEN=... pnpm dev
```

### 生产构建

```bash
cp .env.demo.example .env.demo
# 编辑 VITE_API_TOKEN 与 VPS .env DEMO_TOKEN 一致
set -a && source .env.demo && set +a && pnpm build:demo
pnpm pages:prepare   # CONSOLE_PAGES_CNAME=demo.zhin.dev
```

### 部署

- **分支 `demo`**：push 触发 [`.github/workflows/demo-pages.yml`](.github/workflows/demo-pages.yml)
- GitHub 仓库 Secrets：`DEMO_CONSOLE_TOKEN`（= VPS `DEMO_TOKEN`）
- 仓库 Variables（可选）：`DEMO_PAGES_CNAME=demo.zhin.dev`
- **Host 侧**：zhin 仓库 [`deploy/zhin-demo`](https://github.com/zhinjs/zhin/tree/main/deploy/zhin-demo) 部署 `demo-api.zhin.dev`（`examples/demo-bot`）

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
