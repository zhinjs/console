import { readApiBaseUrlFromQuery, stripApiBaseUrlFromQuery } from "@console/utils/auth";

/**
 * 启动时处理 ?apiBaseUrl=...：只预填 Host 地址，token 须用户在登录页输入。
 * 读取后从地址栏移除 apiBaseUrl。
 */
export function runQueryPrefillMiddleware(): string | null {
  const apiBaseUrl = readApiBaseUrlFromQuery();
  if (!apiBaseUrl) return null;
  stripApiBaseUrlFromQuery();
  return apiBaseUrl;
}
