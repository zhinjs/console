import type { ConsoleAccess } from '../../utils/console-access.mjs'

type Translate = (message: string, values?: readonly unknown[]) => string

export type GlobalConfigView = 'source' | 'feature' | 'denied'
export const CONFIG_SOURCE_RPC: 'config:get-source'
export const CONFIG_SOURCE_READ_PERMISSION: string
export const CONFIG_SOURCE_WRITE_PERMISSION: string
export const GLOBAL_FEATURE_READ_PERMISSION: string
export function globalConfigView(access?: ConsoleAccess, options?: { sourceDenied?: boolean }): GlobalConfigView
export function globalFeatureReadRequest(plugin: string): { readonly type: 'feature.get'; readonly plugin: string; readonly level: 'global' }
export function globalConfigReadOnlyNote(t?: Translate): string
export function globalConfigDeniedMessage(t?: Translate): string
export function globalConfigUnsupportedMessage(t?: Translate): string
