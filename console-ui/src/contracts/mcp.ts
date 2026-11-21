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
