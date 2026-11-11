export interface PluginToggleSubject { name: string; features?: readonly { name: string; count?: number }[] }
export function disableConfirmation(plugin: PluginToggleSubject, locale?: 'zh-CN' | 'en'): { title: string; description: string; confirmLabel: string; variant: 'destructive' };
export function toggleFeedback(input: { name: string; enabled: boolean; result?: unknown; rpcError?: unknown; error?: unknown }, locale?: 'zh-CN' | 'en'): { variant: 'success' | 'error'; title?: string; description: string };
export function withPendingToggle(pending: ReadonlySet<string>, key: string, active: boolean): Set<string>;
