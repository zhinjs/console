/**
 * MCP 服务的状态与「测试连接」契约（zhinjs/zhin #1250 第 28 批，PR #1294）。
 *
 * `@zhin.js/console-protocol` 1.9 起导出这些类型与常量（`status.ts`），这里只再导出，
 * 不再保留本地声明（`tests/mcp-status-model.test.mjs` 核对字段与路径）。
 */
export {
  CONSOLE_MCP_TEST_PATH,
  type ConsoleMcpConnectTestResult,
  type ConsoleMcpFailure,
  type ConsoleMcpFailureCategory,
  type ConsoleMcpServerRow,
  type ConsoleMcpServerStatus,
} from '@zhin.js/console-protocol'

import type { ConsoleMcpFailureCategory as ProtocolFailureCategory, ConsoleMcpServerStatus as ProtocolServerStatus } from '@zhin.js/console-protocol'
import type { MCP_FAILURE_CATEGORIES, MCP_SERVER_STATUSES } from '../pages/introspection/mcp-status-model.mjs'

/**
 * Compile-time check that the model's runtime lists (declared as literal tuples in
 * `mcp-status-model.d.mts`) name exactly the protocol's categories and statuses; the test checks
 * the `.mjs` values against those tuples and against the protocol's declaration.
 */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
export const MCP_CONTRACT_MATCHES: {
  readonly failureCategories: Same<(typeof MCP_FAILURE_CATEGORIES)[number], ProtocolFailureCategory>
  readonly serverStatuses: Same<(typeof MCP_SERVER_STATUSES)[number], ProtocolServerStatus>
} = { failureCategories: true, serverStatuses: true }
