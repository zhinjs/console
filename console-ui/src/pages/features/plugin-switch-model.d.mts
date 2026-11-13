import type { StatusReading, TransactionFailure, TransactionFailureOutcome } from '../../components/status-state-model.mjs'

type Translate = (message: string, values?: readonly unknown[]) => string

export const GLOBAL_PLUGIN_SWITCH_PERMISSION: 'plugin.manage'
export const FEATURE_TOGGLE_PERMISSION: 'feature.toggle'
export function featureSwitchPermission(level: string): 'plugin.manage' | 'feature.toggle'
export function isGlobalFeatureSwitch(message: unknown): boolean
export function pluginSwitchRequestBody<T extends Record<string, unknown>>(request: T, requestId: number): T & { requestId: number }
export function transactionFailureCopy(outcome: TransactionFailureOutcome, t?: Translate): { title: string; description: string }
export function transactionNeedsInstanceCheck(transaction: TransactionFailure | null | undefined): boolean
export function transactionDetailText(reading: StatusReading | null | undefined, t?: Translate): string
export function switchPermissionNote(access: { global: boolean; lower: boolean; hasLower: boolean }, t?: Translate): string | null
export function globalSwitchDeniedTitle(t?: Translate): string
export function globalSwitchPlanCopy(enabled: boolean, name: string, t?: Translate): { title: string; summary: string; confirmLabel: string }
