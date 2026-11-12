/**
 * Management gateway RPC (ADR 0054 §4 / §5) and Console terminal (ADR 0051) payload types.
 *
 * Constants come from `./console-protocol-mirror.mjs`, the single hand copy of
 * `@zhin.js/console-protocol` that `scripts/check-protocol-mirror.mjs` compares with the protocol
 * source. The payload types below follow `packages/console/protocol/src/gateway.ts`; switch them to
 * the package's types once it is published. The pages tolerate a Host that does not know these RPCs
 * ("Unknown RPC type" / `unmapped`) and show "需要新版网关".
 *
 * Request envelope assumed for `POST {base}/console/request`:
 *   `{ type, requestId, data }`; reply `{ success: true, data }` or `{ success: false, error, code? }`
 *   (the gateway's own `{ ok, data | error: { code, message, status } }` is accepted as well).
 * Progress of a package transaction arrives on the Console event stream as
 * `gateway.packages.progress` with a {@link GatewayPackageEvent} as `data`.
 */

export {
  GATEWAY_PACKAGES_RPC, GATEWAY_INSTANCE_RPC, GATEWAY_PLUGINS_RPC, GATEWAY_RPC, GATEWAY_RPC_PERMISSIONS,
  GATEWAY_PACKAGES_PROGRESS, GATEWAY_PACKAGES_PROGRESS_PATH, GATEWAY_INSTANCE_ERROR, GATEWAY_HEALTH_PATH,
} from './console-protocol-mirror.mjs'
import { GATEWAY_INSTANCE_RPC, GATEWAY_PACKAGES_RPC, GATEWAY_RPC_PERMISSIONS } from './console-protocol-mirror.mjs'

/** Permissions the pages gate on (values of `GATEWAY_RPC_PERMISSIONS`). There is no `ops.instance`. */
export const GATEWAY_PERMISSIONS = Object.freeze({
  INSTANCE_READ: GATEWAY_RPC_PERMISSIONS[GATEWAY_INSTANCE_RPC.STATUS],
  INSTANCE_CONTROL: GATEWAY_RPC_PERMISSIONS[GATEWAY_INSTANCE_RPC.RESTART],
  PACKAGES_READ: GATEWAY_RPC_PERMISSIONS[GATEWAY_PACKAGES_RPC.LIST],
  PACKAGES_MANAGE: GATEWAY_RPC_PERMISSIONS[GATEWAY_PACKAGES_RPC.INSTALL],
  TERMINAL: 'ops.terminal',
} as const)

// ---- gateway.packages.* ----

export type GatewayPackageOperation = 'install' | 'uninstall' | 'update'
/** Every gateway transaction: package operations plus `declare` (`gateway.plugins.declare`). */
export type GatewayTransactionOperation = GatewayPackageOperation | 'declare'
export type GatewayPackageSource = 'database-driver' | 'adapter' | 'ai' | 'market' | 'npm'

export interface GatewayPackagesInstallRequest {
  readonly packages: readonly string[]
  readonly enable?: boolean
  readonly startInstance?: boolean
}
/**
 * `gateway.plugins.declare` (`plugin.manage`): declare an installed plugin package as
 * `plugins.<instanceKey>` with its first configuration (validated against the plugin schema,
 * written atomically, instance restarted, rolled back when it does not come up). Refused with
 * `invalid_input` when the key is already declared or the configuration does not validate.
 */
export interface GatewayPluginsDeclareRequest {
  /** Installed plugin package name, without a version. */
  readonly package: string
  /** Default: derived from the package name (`@zhin.js/adapter-sandbox` → `sandbox`). */
  readonly instanceKey?: string
  /** The instance's configuration section; default `{}`. */
  readonly config?: Readonly<Record<string, unknown>>
  readonly startInstance?: boolean
}

/** An installed plugin left undeclared because its configuration is incomplete. */
export interface GatewayPluginConfigurationNeed {
  readonly name: string
  readonly instanceKey: string
  /** Config paths to fill or fix, relative to the instance section (`endpoints`, `endpoints.0.id`). */
  readonly missing: readonly string[]
  /** Environment variables referenced by defaults that are not set. */
  readonly missingEnv: readonly string[]
}

export interface GatewayPackagesUninstallRequest {
  readonly packages: readonly string[]
  /** Also remove the npm dependency when nothing else references it (default true). */
  readonly removeDependency?: boolean
  readonly startInstance?: boolean
}
export interface GatewayPackagesUpdateRequest {
  readonly packages: readonly string[] | 'all'
  readonly startInstance?: boolean
}
export interface GatewayPackagesPlanRequest {
  readonly operation: GatewayPackageOperation
  readonly packages: readonly string[] | 'all'
}

export interface GatewayAuthorizedPackage {
  readonly name: string
  readonly version?: string
  readonly spec: string
  readonly source: GatewayPackageSource
}

export interface GatewayPackagePlan {
  readonly operation: GatewayPackageOperation
  readonly packages: readonly GatewayAuthorizedPackage[]
  readonly all: boolean
  readonly packageManager: string
  readonly instanceState: GatewayInstanceState | 'unmanaged'
  readonly restartsInstance: boolean
}

export interface GatewayInstalledPackage {
  readonly name: string
  readonly range: string
  readonly dependencyType: 'dependencies' | 'optionalDependencies' | 'devDependencies'
  readonly installedVersion: string | null
  readonly catalog?: Exclude<GatewayPackageSource, 'npm'>
}

export interface GatewayPackageList {
  readonly packageManager: string
  readonly packages: readonly GatewayInstalledPackage[]
}

export type GatewayPackagePhase =
  | 'snapshot' | 'stop-instance' | 'package-manager' | 'configure' | 'start-instance'
  | 'rollback' | 'restore-files' | 'reinstall' | 'restart-instance' | 'done'

export type GatewayPackageTransactionStatus = 'succeeded' | 'rolledBack' | 'rollbackFailed'

export interface GatewayPackageTransactionResult {
  readonly id: string
  readonly operation: GatewayTransactionOperation
  readonly packages: readonly GatewayAuthorizedPackage[]
  readonly ok: boolean
  readonly status: GatewayPackageTransactionStatus
  readonly failedPhase?: GatewayPackagePhase
  readonly error?: string
  readonly rollbackError?: string
  readonly logTail?: readonly string[]
  /** `install` only: plugins installed but left undeclared because their configuration is incomplete. */
  readonly needsConfiguration?: readonly GatewayPluginConfigurationNeed[]
  readonly instance: Readonly<{ before: GatewayInstanceState | 'unmanaged'; after: GatewayInstanceState | 'unmanaged' }>
  readonly startedAt: number
  readonly finishedAt: number
}

export type GatewayPackageEvent =
  | Readonly<{ type: 'start'; id: string; operation: GatewayTransactionOperation; packages: readonly GatewayAuthorizedPackage[] }>
  | Readonly<{ type: 'phase'; id: string; phase: GatewayPackagePhase }>
  | Readonly<{ type: 'output'; id: string; stream: 'stdout' | 'stderr'; chunk: string }>
  | Readonly<{ type: 'result'; id: string; result: GatewayPackageTransactionResult }>

// ---- gateway.instance.* ----

export type GatewayInstanceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'backoff' | 'crashed'

export interface GatewayInstanceFailure {
  readonly reason: string
  readonly message: string
  readonly at: number
  readonly exitCode: number | null
  readonly signal: string | null
  readonly logTail: readonly string[]
}

export interface GatewayInstanceStatus {
  readonly instanceId: string
  readonly state: GatewayInstanceState
  readonly pid?: number
  readonly startedAt?: number
  readonly generation?: number
  readonly protocolVersion?: number
  readonly lastExitCode: number | null
  readonly lastExitSignal: string | null
  readonly lastFailure?: GatewayInstanceFailure
  readonly recentRestarts: number
}

export interface GatewayInstanceLogsRequest {
  /** 1–1000, default 200. */
  readonly lines?: number
}

export interface GatewayInstanceLogLine {
  readonly seq: number
  readonly time: number
  readonly stream: 'stdout' | 'stderr'
  readonly line: string
}

export interface GatewayInstanceLogs {
  readonly lines: readonly GatewayInstanceLogLine[]
}

// ---- Console terminal (ADR 0051) ----

export interface TerminalTarget {
  readonly id: string
  readonly kind: 'local' | 'ssh'
  readonly label: string
  readonly available: boolean
  readonly reason?: string
  /** SSH target configured with `insecureAcceptAnyHostKey`: the host key is not verified. */
  readonly insecureHostKey?: true
}

export interface TerminalTicket {
  readonly ticket: string
  readonly expiresAt: number
}

export type TerminalEndReason = 'disconnect' | 'idle-timeout' | 'process-exit' | 'revoked' | 'disabled' | 'error'

/** Server → client text frames. Output is binary frames. */
export type TerminalServerControl =
  | Readonly<{ type: 'ready'; sessionId: string; target: string; kind: 'local' | 'ssh'; cols: number; rows: number }>
  | Readonly<{ type: 'exit'; reason: TerminalEndReason; code: number | null; signal?: string | number }>
  | Readonly<{ type: 'error'; code: string; message: string }>
  | Readonly<{ type: 'pong' }>

/** Client → server text frames. Input is binary frames. */
export type TerminalClientControl =
  | Readonly<{ type: 'resize'; cols: number; rows: number }>
  | Readonly<{ type: 'ping' }>

/** WebSocket close codes the terminal uses. */
export const TERMINAL_CLOSE_CODES = Object.freeze({
  normal: 1000,
  abnormal: 1006,
  startFailed: 1011,
  badRequest: 4400,
  invalidTicket: 4401,
  forbidden: 4403,
  tooManySessions: 4429,
} as const)
