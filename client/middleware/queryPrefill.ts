import {
  readApiBaseUrlFromQuery,
  reconcileAuthWithApiBase,
  stripApiBaseUrlFromQuery,
} from "@console/utils/auth";

/**
 * 启动时处理 ?apiBaseUrl=...：预填 Host；若与已缓存 token 的 Host 不一致则登出。
 */
export function runQueryPrefillMiddleware(): {
  authed: boolean;
  loginApiBase: string | null;
} {
  const incoming = readApiBaseUrlFromQuery();
  if (incoming) stripApiBaseUrlFromQuery();
  return reconcileAuthWithApiBase(incoming);
}
