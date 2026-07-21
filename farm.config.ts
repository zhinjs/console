import type { IncomingMessage } from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@farmfe/core";
import farmPostcss from "@farmfe/js-plugin-postcss";
import react from "@farmfe/plugin-react";
const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const consoleApiTarget = process.env.VITE_DEV_API ?? "http://127.0.0.1:8086";

function forwardDevHostToApi(
  proxyReq: { setHeader: (n: string, v: string) => void },
  req: IncomingMessage,
) {
  const host = req.headers.host;
  if (host) proxyReq.setHeader("x-forwarded-host", host);
  const raw = req.headers["x-forwarded-proto"];
  const first = Array.isArray(raw) ? raw[0] : typeof raw === "string" ? raw.split(",")[0]?.trim() : "";
  proxyReq.setHeader("x-forwarded-proto", first === "https" ? "https" : "http");
}

const consoleApiProxy = {
  target: consoleApiTarget,
  changeOrigin: true,
  onProxyReq(
    proxyReq: { setHeader: (n: string, v: string) => void },
    req: IncomingMessage,
  ) {
    forwardDevHostToApi(proxyReq, req);
  },
} as const;

const consoleDevProxy = {
  "/entries": consoleApiProxy,
  "/@dev": consoleApiProxy,
  "/@assets": consoleApiProxy,
  "/api": consoleApiProxy,
  "/zhin": consoleApiProxy,
} as const;

const pagesBase = (process.env.CONSOLE_PAGES_BASE ?? "").replace(/\/$/, "");
const assetPublicPath = pagesBase ? `${pagesBase}/` : "/";

const demoBuildEnv = {
  "import.meta.env.VITE_DEMO_MODE": JSON.stringify(process.env.VITE_DEMO_MODE ?? ""),
  "import.meta.env.VITE_API_BASE": JSON.stringify(process.env.VITE_API_BASE ?? ""),
  "import.meta.env.VITE_API_TOKEN": JSON.stringify(process.env.VITE_API_TOKEN ?? ""),
  "import.meta.env.VITE_CONSOLE_SHELL_PATH": JSON.stringify(
    process.env.VITE_CONSOLE_SHELL_PATH ?? "",
  ),
};

export default defineConfig({
  root: path.join(siteRoot, "client"),
  plugins: [react({ runtime: "automatic" }), farmPostcss()],
  compilation: {
    presetEnv: false,
    lazyCompilation: false,
    define: demoBuildEnv,
    partialBundling: {
      enforceResources: [
        { name: "lucide-react", test: ["[\\\\/]lucide-react[\\\\/]", "lucide-react"] },
        { name: "radix-ui", test: ["[\\\\/]radix-ui[\\\\/]", "radix-ui"] },
      ],
    },
    input: { index: "./index.html" },
    output: {
      path: path.join(siteRoot, "dist"),
      publicPath: assetPublicPath,
    },
    resolve: {
      dedupe: ["lucide-react"],
      // npm 发布的 @zhin.js/* 包不含 src/，exports 的 development 条件会指到不存在的文件
      conditions: ["module", "import", "browser", "default"],
      alias: {
        "@console": path.join(siteRoot, "console-ui/src"),
        react: path.resolve(siteRoot, "node_modules/react"),
        "react-dom": path.resolve(siteRoot, "node_modules/react-dom"),
        "react-router-dom": path.resolve(siteRoot, "node_modules/react-router-dom"),
        "react-router": path.resolve(
          siteRoot,
          "node_modules/react-router-dom/node_modules/react-router",
        ),
        "react-refresh": path.resolve(siteRoot, "node_modules/react-refresh"),
        "lucide-react": path.resolve(siteRoot, "node_modules/lucide-react"),
        "radix-ui": path.resolve(siteRoot, "node_modules/radix-ui"),
        "class-variance-authority": path.resolve(siteRoot, "node_modules/class-variance-authority"),
        clsx: path.resolve(siteRoot, "node_modules/clsx"),
        "tailwind-merge": path.resolve(siteRoot, "node_modules/tailwind-merge"),
        yaml: path.resolve(siteRoot, "node_modules/yaml"),
        // npm 发布的 @zhin.js/ai 不含 src/，其 exports development 条件悬空；
        // dev 模式 farm 强制 development 条件，子路径解析必挂，这里指到 lib 产物
        "@zhin.js/ai/agent-stream": path.resolve(
          siteRoot, "node_modules/@zhin.js/ai/lib/agent-stream.js",
        ),
        "@zhin.js/ai/agent-stream-consumer": path.resolve(
          siteRoot, "node_modules/@zhin.js/ai/lib/agent-stream-consumer.js",
        ),
      },
    },
  },
  server: {
    spa: true,
    proxy: consoleDevProxy,
  },
});
