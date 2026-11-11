import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/contract";

/** 旧版 UI 路由前缀（侧栏注册路径可能带 /console/…，用于剥离相对 path） */
export const CONSOLE_UI_LEGACY_PREFIX = DEFAULT_CONSOLE_BASE_PATH;

/**
 * 独立站点 UI 路由前缀。默认根路径；与 Host 同挂 /console 时设 VITE_CONSOLE_SHELL_PATH=/console
 */
export const CONSOLE_SHELL_PATH = (
  import.meta as unknown as { env?: { VITE_CONSOLE_SHELL_PATH?: string } }
).env?.VITE_CONSOLE_SHELL_PATH ?? "";

export function normalizeShellBase(path: string): string {
  if (!path || path === "/") return "";
  return path.replace(/\/$/, "");
}
