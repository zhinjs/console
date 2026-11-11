import { getStoredApiBase, reconcileAuthWithApiBase } from "@console/utils/auth";
import { consumeLoginLink, normalizeHostAddress, type LoginLink } from "@console/pages/login-model.mjs";

/**
 * 启动时最先调用：读取 `?apiBaseUrl=` / `?token=`，并立即用 history.replaceState 从地址栏移除，
 * 无论之后登录成功与否，token 都不会留在地址栏或历史记录里。
 */
export function takeLoginLink(): LoginLink {
  if (typeof window === "undefined") return { apiBase: null, token: null };
  return consumeLoginLink(window.location, window.history);
}

/**
 * 处理登录链接：预填 Host（若与已缓存 token 的 Host 不一致则登出）；
 * 带 token 时总是进入登录页，由登录页用该 token 尝试登录。
 */
export function runQueryPrefillMiddleware(link: LoginLink): {
  authed: boolean;
  loginApiBase: string | null;
  loginToken: string | null;
} {
  let incoming = link.apiBase;
  if (incoming) {
    const normalized = normalizeHostAddress(incoming);
    if (normalized.ok) incoming = normalized.value;
  }
  const session = reconcileAuthWithApiBase(incoming);
  if (!link.token) return { ...session, loginToken: null };
  return { authed: false, loginApiBase: session.loginApiBase ?? getStoredApiBase(), loginToken: link.token };
}
