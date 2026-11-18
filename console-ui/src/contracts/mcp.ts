/**
 * MCP 服务的状态与「测试连接」契约（zhinjs/zhin #1250 第 28 批，PR #1294）。
 *
 * 本地镜像 `@zhin.js/console-protocol` 的 `status.ts`：npm 上最新的 1.5.0 还没有
 * `CONSOLE_MCP_TEST_PATH` / `ConsoleMcpConnectTestResult`，`idle` 的含义也是旧口径。
 * zhin 发布带这两个导出的版本后，把依赖升到该版本，删除这里的声明，改为从
 * `@zhin.js/console-protocol` 再导出（`tests/mcp-status-model.test.mjs` 会核对字段）。
 */

/** Why an MCP client is not connected; written by the Agent. */
export type ConsoleMcpFailureCategory =
  | 'auth' | 'network' | 'timeout' | 'config' | 'process_exit' | 'sdk_missing' | 'unknown'

export interface ConsoleMcpFailure {
  readonly category: ConsoleMcpFailureCategory
  /** Short and redacted; ≤ 200 chars. */
  readonly message: string
  /** Exit code of a stdio server process that exited during start-up. */
  readonly exitCode?: number
  /** Epoch milliseconds of the failed attempt. */
  readonly at: number
}

/**
 * - `connected`: live connection;
 * - `failed`: last connect failed, see `lastError`; the only state reported in the attention inbox;
 * - `idle`: loaded by the Agent, not connected yet — "waiting to connect" (待连接), not a problem;
 * - `not_loaded`: configured but not loaded by the running Agent.
 */
export type ConsoleMcpServerStatus = 'connected' | 'failed' | 'idle' | 'not_loaded'

/** `POST {base}/introspection/mcp/test` with body `{ name }` (`agent.configure`). */
export const CONSOLE_MCP_TEST_PATH = '/introspection/mcp/test'

/** `data` of a {@link CONSOLE_MCP_TEST_PATH} response. */
export type ConsoleMcpConnectTestResult =
  | Readonly<{ ok: true; name: string; toolCount: number; durationMs: number }>
  | Readonly<{ ok: false; name: string; failure: ConsoleMcpFailure; durationMs: number }>

/** Row of `GET {base}/introspection/mcp`. `status` / `lastError` are absent on older instances. */
export interface ConsoleMcpServerRow {
  readonly name: string
  readonly connected: boolean
  readonly toolCount: number
  readonly transport?: string
  readonly status?: ConsoleMcpServerStatus
  readonly lastError?: ConsoleMcpFailure
}
