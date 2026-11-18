import type { ReceiptPlan } from '../../components/action-receipt-model.mjs'
import type { ApplyOutcome } from '../../components/apply-outcome-model.mjs'

export interface AdapterSwitchPayload {
  readonly body: Record<string, unknown> & { type: string }
  readonly change: { readonly kind: 'enabled'; readonly enabled: boolean }
}
export function featureReceiptKey(level: string, levelKey: string, plugin: string): string
export function adapterSwitchPayload(input: { plugin: string; adapter: string; enabled: boolean; revision?: string }): AdapterSwitchPayload
export function adapterSwitchHandlers(input: {
  plugin: string
  adapter: string
  request: (body: Record<string, unknown> & { type: string }) => Promise<unknown>
  reload: () => void
  t?: (message: string, values?: readonly unknown[]) => string
}): {
  submit: (plan: ReceiptPlan) => Promise<unknown>
  verify: (plan: ReceiptPlan) => Promise<{ applied: boolean; apply?: ApplyOutcome } | undefined>
}
