import { getStoredApiBase, reconcileAuthWithApiBase } from "@console/utils/auth";
import { consumeLoginLink, normalizeHostAddress, type LoginLink } from "@console/pages/login-model.mjs";

/**
 * 启动时最先调用：读取 `#token=`、`#apiBaseUrl=` / `?apiBaseUrl=`，并立即用 history.replaceState
 * 从地址栏移除；无论之后登录成功与否，token 都不会留在地址栏或历史记录里。
 * token 只能放在 # 片段中：`?token=` 同样会被立即移除，但不会被使用。
 */
export function takeLoginLink(): LoginLink {
  if (typeof window === "undefined") return { apiBase: null, token: null, queryTokenRejected: false };
  return consumeLoginLink(window.location, window.history);
}

export interface InitialSession {
  authed: boolean;
  loginApiBase: string | null;
  /** 链接 token：只用于一次登录尝试，用完由调用方置空。 */
  loginToken: string | null;
  queryTokenRejected: boolean;
}

/**
 * 处理登录链接：预填 Host（若与已缓存 token 的 Host 不一致则登出）；
 * 带 `#token=` 时总是进入登录页，由登录页（未保存的 Host 需先确认）用该 token 尝试登录。
 */
export function runQueryPrefillMiddleware(link: LoginLink): InitialSession {
  let incoming = link.apiBase;
  if (incoming) {
    const normalized = normalizeHostAddress(incoming);
    if (normalized.ok) incoming = normalized.value;
  }
  const session = reconcileAuthWithApiBase(incoming);
  const queryTokenRejected = link.queryTokenRejected;
  if (!link.token) return { ...session, loginToken: null, queryTokenRejected };
  return { authed: false, loginApiBase: session.loginApiBase ?? getStoredApiBase(), loginToken: link.token, queryTokenRejected };
}
