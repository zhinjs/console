import type {
  GatewayAuthorizedPackage, GatewayInstalledPackage, GatewayInstanceLogLine, GatewayInstanceState, GatewayInstanceStatus,
  GatewayPackagePhase, GatewayPackagePlan, GatewayPackageTransactionResult,
  GatewayPluginConfigurationNeed, GatewayPluginsDeclareRequest, GatewayTransactionOperation,
} from '../../contracts/gateway'

import type { SchemaField } from '../../components/PluginConfigForm/types'

type Translate = (message: string, values?: readonly unknown[]) => string

export declare const GATEWAY_RPC: Readonly<{
  PACKAGES_LIST: 'gateway.packages.list'
  PACKAGES_PLAN: 'gateway.packages.plan'
  PACKAGES_INSTALL: 'gateway.packages.install'
  PACKAGES_UNINSTALL: 'gateway.packages.uninstall'
  PACKAGES_UPDATE: 'gateway.packages.update'
  INSTANCE_STATUS: 'gateway.instance.status'
  INSTANCE_START: 'gateway.instance.start'
  INSTANCE_STOP: 'gateway.instance.stop'
  INSTANCE_RESTART: 'gateway.instance.restart'
  INSTANCE_LOGS: 'gateway.instance.logs'
  PLUGINS_DECLARE: 'gateway.plugins.declare'
}>
export declare const GATEWAY_PACKAGES_PROGRESS: 'gateway.packages.progress'
export declare const INSTANCE_STATES: readonly GatewayInstanceState[]
export declare const PACKAGE_PHASES: readonly GatewayPackagePhase[]
export declare const TRANSACTION_OPERATIONS: readonly GatewayTransactionOperation[]
export declare const MAX_PACKAGE_SPECS: number
export declare const MAX_LOG_LINES: number
export declare const MAX_PROGRESS_OUTPUT: number

export declare class GatewayRequestError extends Error {
  constructor(message: string, options?: { status?: number; code?: string; hostMessage?: string; details?: GatewayErrorDetails; retryAfter?: number; requestOutcome?: string; transaction?: unknown })
  readonly status: number
  readonly code: string
  readonly hostMessage: string
  readonly retryAfter?: number
  readonly details?: GatewayErrorDetails
}
export interface GatewayErrorDetails {
  readonly errors?: readonly { readonly path: string; readonly message: string }[]
  readonly missingEnv?: readonly string[]
  /** Instance forward outcome (`instance_*`), read by `statusFromError`. */
  readonly serverCode?: string
  readonly requestOutcome?: string
  /** A refused transaction's result (global plugin switch: `failedPhase`, `logTail`). */
  readonly transaction?: unknown
}
export function readErrorDetails(value: unknown): GatewayErrorDetails | undefined
export type GatewayErrorKind = 'unsupported' | 'forbidden' | 'conflict' | 'database_busy' | 'instance' | 'unavailable' | 'failed'

export function gatewayRequestBody(type: string, data: unknown, requestId: number): { type: string; requestId: number; data: unknown }
export function readGatewayReply(status: number, json: unknown, t: Translate, retryAfterHeader?: string | null): unknown
export function gatewayErrorKind(error: unknown): GatewayErrorKind

export function readInstanceStatus(value: unknown): GatewayInstanceStatus | null
export function instanceStateLabel(state: string, t: Translate): string
export function instanceStateTone(state: string): 'success' | 'destructive' | 'warning' | 'secondary'
export function instanceActions(state: GatewayInstanceState): { start: boolean; stop: boolean; restart: boolean }
export function instanceLifecycleApplied(
  action: 'start' | 'stop' | 'restart',
  before: Partial<GatewayInstanceStatus> | null | undefined,
  after: Partial<GatewayInstanceStatus> | null | undefined,
): boolean | undefined
export function formatDuration(ms: number, t: Translate): string
export function uptimeMs(status: GatewayInstanceStatus | null | undefined, now: number): number | null
export function failureReasonLabel(reason: string, t: Translate): string

export function readLogLines(value: unknown): GatewayInstanceLogLine[]
export function mergeLogLines(existing: readonly GatewayInstanceLogLine[], incoming: readonly GatewayInstanceLogLine[], cap?: number): readonly GatewayInstanceLogLine[]

export function readPackageList(value: unknown): { packageManager: string; packages: GatewayInstalledPackage[] }
export function parsePackageSpecs(text: string, t: Translate): { specs: string[]; problem: string | null }
export function readPackagePlan(value: unknown): GatewayPackagePlan | null
export function readTransactionResult(value: unknown): (GatewayPackageTransactionResult & { logTail: readonly string[] }) | null
export function phaseLabel(phase: string, t: Translate): string
export function operationLabel(operation: string, t: Translate): string

export interface PackageProgressState {
  readonly id: string | null
  readonly operation: GatewayTransactionOperation | null
  readonly packages: readonly GatewayAuthorizedPackage[]
  readonly phases: readonly GatewayPackagePhase[]
  readonly output: string
  readonly result: (GatewayPackageTransactionResult & { logTail: readonly string[] }) | null
}
export declare const EMPTY_PROGRESS: PackageProgressState
export function reducePackageProgress(state: PackageProgressState, event: unknown): PackageProgressState
export function transactionSummary(result: GatewayPackageTransactionResult, t: Translate): { tone: 'success' | 'warning' | 'destructive'; title: string }

export function instanceKeyFromPackage(name: string): string
export function readConfigurationNeeds(value: unknown): GatewayPluginConfigurationNeed[]
export function instanceKeyProblem(key: string, t: Translate): string | null
export function declareRequestBody(input: { package: string; instanceKey?: string; config?: unknown; startInstance?: boolean }): GatewayPluginsDeclareRequest & { instanceKey: string; config: Record<string, unknown> }
export function relativeConfigPath(path: string): string
export interface DeclarationFieldError { readonly path: string; readonly message: string }
export interface DeclarationErrors {
  /** Set when the message is not a schema failure; shown above the form. */
  readonly general: string | null
  readonly fields: readonly DeclarationFieldError[]
  readonly missingEnv: readonly string[]
}
export function readDeclarationErrors(message: string, details?: GatewayErrorDetails): DeclarationErrors
export function fieldErrorsAt(errors: DeclarationErrors | null | undefined, path: string): DeclarationFieldError[]
export function declarationDraft(schema: SchemaField | null | undefined): Record<string, unknown>
export function declarationConfig(value: unknown, t: Translate): { config: Record<string, unknown> | null; problem: string | null }
export function parseDeclarationJson(text: string, t: Translate): { config: Record<string, unknown> | null; problem: string | null }
