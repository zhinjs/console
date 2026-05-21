import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";

/** Host 插件清单（OpenAPI: GET /entries） */
export const ENTRIES_PATH = "/entries";

/** 插件 dev/prod 模块前缀（相对 Host 根，如 /@dev/{id}.mjs） */
export const CONSOLE_ASSET_PREFIXES = ["/@dev", "/@assets"] as const;

/** 旧版 UI 路由前缀（侧栏注册路径可能带 /console/…，用于剥离相对 path） */
export const CONSOLE_UI_LEGACY_PREFIX = DEFAULT_CONSOLE_BASE_PATH;
