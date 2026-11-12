import type { ActionReceiptState, ReceiptEvent } from './action-receipt-model.mjs'

export interface ReceiptStore {
  get(key: string): ActionReceiptState
  dispatch(key: string, event: ReceiptEvent): ActionReceiptState
  subscribe(key: string, listener: () => void): () => void
  keys(): string[]
}
export function createReceiptStore(): ReceiptStore
export const sharedReceipts: ReceiptStore
