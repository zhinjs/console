export function pluginConfigFormState(state: {
  loading: boolean; error?: string | null; connected: boolean; schema?: unknown
}): 'loading' | 'error' | 'disconnected' | 'ready' | 'no-schema'
