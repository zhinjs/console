import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";

/** 与 zhin Host 一致：entries、@dev、esm 等 API 前缀 */
export const CONSOLE_API_PATH = DEFAULT_CONSOLE_BASE_PATH;

/**
 * 独立站点 UI 路由前缀。本仓库部署在单独域名（如 console.zhin.dev），页面在根路径。
 * 需要与 Host 一样挂在 /console 下时，构建前设 VITE_CONSOLE_SHELL_PATH=/console
 */
export const CONSOLE_SHELL_PATH = (
  import.meta as unknown as { env?: { VITE_CONSOLE_SHELL_PATH?: string } }
).env?.VITE_CONSOLE_SHELL_PATH ?? "";

export function normalizeShellBase(path: string): string {
  if (!path || path === "/") return "";
  return path.replace(/\/$/, "");
}
