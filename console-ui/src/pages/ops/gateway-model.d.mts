import type {
  GatewayAuthorizedPackage, GatewayInstalledPackage, GatewayInstanceLogLine, GatewayInstanceState, GatewayInstanceStatus,
  GatewayPackageOperation, GatewayPackagePhase, GatewayPackagePlan, GatewayPackageTransactionResult,
} from '../../contracts/gateway'

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
}>
export declare const GATEWAY_PACKAGES_PROGRESS: 'gateway.packages.progress'
export declare const INSTANCE_STATES: readonly GatewayInstanceState[]
export declare const PACKAGE_PHASES: readonly GatewayPackagePhase[]
export declare const MAX_PACKAGE_SPECS: number
export declare const MAX_LOG_LINES: number
export declare const MAX_PROGRESS_OUTPUT: number

export declare class GatewayRequestError extends Error {
  constructor(message: string, options?: { status?: number; code?: string; hostMessage?: string })
  readonly status: number
  readonly code: string
  readonly hostMessage: string
}
export type GatewayErrorKind = 'unsupported' | 'forbidden' | 'conflict' | 'unavailable' | 'failed'

export function gatewayRequestBody(type: string, data: unknown, requestId: number): { type: string; requestId: number; data: unknown }
export function readGatewayReply(status: number, json: unknown, t: Translate): unknown
export function gatewayErrorKind(error: unknown): GatewayErrorKind

export function readInstanceStatus(value: unknown): GatewayInstanceStatus | null
export function instanceStateLabel(state: string, t: Translate): string
export function instanceStateTone(state: string): 'success' | 'destructive' | 'warning' | 'secondary'
export function instanceActions(state: GatewayInstanceState): { start: boolean; stop: boolean; restart: boolean }
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
  readonly operation: GatewayPackageOperation | null
  readonly packages: readonly GatewayAuthorizedPackage[]
  readonly phases: readonly GatewayPackagePhase[]
  readonly output: string
  readonly result: (GatewayPackageTransactionResult & { logTail: readonly string[] }) | null
}
export declare const EMPTY_PROGRESS: PackageProgressState
export function reducePackageProgress(state: PackageProgressState, event: unknown): PackageProgressState
export function transactionSummary(result: GatewayPackageTransactionResult, t: Translate): { tone: 'success' | 'warning' | 'destructive'; title: string }
