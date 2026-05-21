import { readAuthFromQuery, verifyAndStoreCredentials } from "@console/utils/auth";

/**
 * URL 查询参数自动登录：?apiBaseUrl=...&token=...
 * 校验成功后写入 localStorage 并移除地址栏中的敏感参数。
 */
export async function runQueryAuthMiddleware(): Promise<boolean> {
  const creds = readAuthFromQuery();
  if (!creds) return false;

  const result = await verifyAndStoreCredentials(creds.apiBaseUrl, creds.token);
  return result.ok;
}
