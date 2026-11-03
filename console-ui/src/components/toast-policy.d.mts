import type { Toast } from './toast.js'

export function toastDuration(variant?: Toast['variant'], duration?: number): number
export const MAX_TOASTS: 5
export function appendToast(previous: readonly Toast[], next: Toast): Toast[]
