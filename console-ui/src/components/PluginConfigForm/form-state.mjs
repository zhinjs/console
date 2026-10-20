/** No schema is not evidence of a successful empty configuration read. */
export function pluginConfigFormState({ loading, error, connected, schema }) {
  if (loading) return 'loading'
  if (error) return 'error'
  if (!connected) return 'disconnected'
  return schema && (typeof schema.type === 'string' || schema.object) ? 'ready' : 'no-schema'
}
