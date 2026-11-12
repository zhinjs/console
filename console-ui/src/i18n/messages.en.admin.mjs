/**
 * Console refactor phase 2 (B4b): sign-in, setup, onboarding, personal settings, access control and
 * operations pages. Kept apart from the other catalogs so parallel page work does not collide.
 */
export const adminMessages = Object.freeze({
  // Sign-in through the gateway (/auth/me answers while the instance is stopped)
  "网关的数据库正忙，暂时无法验证令牌。请在 {0} 秒后重试。": "The gateway database is busy and cannot check the token right now. Try again in {0} seconds.",
  "网关的数据库正忙，暂时无法验证令牌。请稍后重试。": "The gateway database is busy and cannot check the token right now. Try again shortly.",
  "此 Host 在实例未运行时无法验证令牌（网关版本较旧）。请先在服务器上运行 zhin start 启动实例，或升级网关。": "This Host cannot check tokens while the instance is stopped (older gateway). Start the instance on the server with zhin start, or upgrade the gateway.",
  "令牌无效。初始化时请使用启动日志中的初始化链接，或 .env 里的 HTTP_TOKEN。": "The token is not valid. For first-run setup, use the setup link from the startup log or HTTP_TOKEN in .env.",
  "令牌无效或已失效。初始化令牌在创建所有者后失效：请改用账号登录，或在个人设置里签发 API 令牌。": "The token is not valid or has expired. The setup token stops working once an owner exists: sign in with an account, or issue an API token in personal settings.",
  "网关的数据库正忙，请在 {0} 秒后重试。": "The gateway database is busy. Try again in {0} seconds.",
  "网关的数据库正忙，请稍后重试。": "The gateway database is busy. Try again shortly.",
  "Zhin 实例没有响应，这项操作需要实例在线。可以在「运维 → 实例」查看状态与日志。": "The Zhin instance is not answering, and this needs it online. Check its state and logs under Operations → Instance.",
  // Access control
  "插件权限：读取级": "Plugin permissions: read level",
  "插件权限：操作级": "Plugin permissions: operate level",
  "插件权限：管理级": "Plugin permissions: manage level",
})
