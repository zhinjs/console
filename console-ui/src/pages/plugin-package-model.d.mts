import type { ReceiptPlan } from '../components/action-receipt-model.mjs'
import type { GatewayPackageOperation, GatewayPackagePlan, GatewayPackageSource } from '../contracts/gateway'
import type { PackageProgressState } from './ops/gateway-model.mjs'

type Translate = (message: string, values?: readonly unknown[]) => string
type TransactionResult = NonNullable<PackageProgressState['result']>

export interface PackageListEntry {
  readonly name: string
  readonly range: string
  readonly dependencyType: 'dependencies' | 'optionalDependencies' | 'devDependencies'
  readonly installedVersion: string | null
  readonly catalog?: string
}

export declare const PACKAGE_OPERATION_RPC: Readonly<Record<GatewayPackageOperation, string>>
export function packageSpec(operation: GatewayPackageOperation, name: string, version?: string | null): string
export function packagePlanRequest(operation: GatewayPackageOperation, packages: readonly string[]): { operation: GatewayPackageOperation; packages: string[] }
export function packageTransactionRequest(operation: GatewayPackageOperation, options: {
  packages: readonly string[]; enable?: boolean; startInstance?: boolean; removeDependency?: boolean
}): { type: string; data: Record<string, unknown> }
export function packageReceiptPlan(operation: GatewayPackageOperation, plan: GatewayPackagePlan | null,
  subject: { name: string; version?: string; from?: string | null } | null, t: Translate): ReceiptPlan
export function sourceLabel(source: GatewayPackageSource | string | undefined, t: Translate): string
export function transactionReceiptValue(result: TransactionResult | null | undefined, t: Translate): {
  status: 'succeeded' | 'partial' | 'failed' | 'unknown'
  items?: { label: string; ok: boolean; message?: string }[]
  message?: string
}
export function installedPackage<T extends { name: string }>(list: { packages: readonly T[] } | null | undefined, name: string): T | null
export function verifyPackageState(operation: GatewayPackageOperation, name: string, version: string | undefined | null,
  list: { packages: readonly PackageListEntry[] } | null | undefined, t: Translate): { applied: boolean | undefined; message: string }
export function transactionBusy(error: unknown): boolean
export function defaultInstanceKey(name: string): string
