/** No schema is not evidence of a successful empty configuration read. */
export function pluginConfigFormState({ loading, error, connected, schema }) {
  if (loading) return 'loading'
  if (error) return 'error'
  if (!connected) return 'disconnected'
  const fields = schema?.object || schema?.properties || schema?.dict || {}
  return Object.keys(fields).length ? 'ready' : 'no-schema'
}
