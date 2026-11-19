/**
 * `/features/global/:plugin`: which view an identity gets.
 *
 * - `source`: the Schema form over the raw configuration source (`config:get-source`, editing
 *   through `config:replace-source`) — unchanged for identities holding its read permission;
 * - `feature`: read-only effective global configuration from `feature.get { level: 'global' }`
 *   (secrets masked by the Host), for identities with only `feature.view` / `feature.configure`;
 * - `denied`: neither.
 *
 * Permissions come from `@zhin.js/console-protocol` (`CONSOLE_RPC_PERMISSIONS`,
 * `FEATURE_RPC_PERMISSIONS`), never hard-coded. Pure: the page and the tests share it.
 */
import { CONSOLE_RPC_PERMISSIONS, FEATURE_RPC, FEATURE_RPC_PERMISSIONS } from '@zhin.js/console-protocol'
import { hasConsolePermission } from '../../utils/console-access.mjs'

/** RPC that reads the raw configuration source. */
export const CONFIG_SOURCE_RPC = 'config:get-source'
/** Permission of `config:get-source` (`ops.config.read`). */
export const CONFIG_SOURCE_READ_PERMISSION = CONSOLE_RPC_PERMISSIONS[CONFIG_SOURCE_RPC]
/** Permission of `config:replace-source` (`ops.config.write`): what editing the global configuration needs. */
export const CONFIG_SOURCE_WRITE_PERMISSION = CONSOLE_RPC_PERMISSIONS['config:replace-source']
/** Permission of `feature.get` (`feature.view`). */
export const GLOBAL_FEATURE_READ_PERMISSION = FEATURE_RPC_PERMISSIONS[FEATURE_RPC.GET]

/**
 * The view for `access`. `sourceDenied`: the Host refused `config:get-source` (403) although the
 * session's permissions allowed it; the page then falls back to the read-only view when it can.
 */
export function globalConfigView(access, { sourceDenied = false } = {}) {
  if (!sourceDenied && hasConsolePermission(CONFIG_SOURCE_READ_PERMISSION, access)) return 'source'
  if (hasConsolePermission(GLOBAL_FEATURE_READ_PERMISSION, access)) return 'feature'
  return 'denied'
}

/** `feature.get` body of the read-only view: the plugin's effective global configuration. */
export function globalFeatureReadRequest(plugin) {
  return { type: FEATURE_RPC.GET, plugin, level: 'global' }
}

const identity = value => value

/** Note above the read-only view. */
export function globalConfigReadOnlyNote(t = identity) {
  return t('当前身份只能查看全局配置的生效值，敏感值已隐藏。修改全局配置需要 ops.config.write 权限。')
}

/** Message for an identity that may read neither the configuration source nor the feature. */
export function globalConfigDeniedMessage(t = identity) {
  return t('当前身份无权查看全局配置：需要 feature.view 或 ops.config.read 权限。')
}

/** Message when the Host does not serve `feature.get` (older Host): only the source view works there. */
export function globalConfigUnsupportedMessage(t = identity) {
  return t('当前 Host 不支持只读查看全局配置。查看和修改原始配置需要 ops.config.read 权限。')
}
