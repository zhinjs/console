import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfigSource, type ConfigSource } from '../../hooks/useConfigSource'
import { requestConsole } from '../../utils/console-rpc'
import type { Schema } from './types.js'
import { parseConfigDocument, configAtPath, configSourceForPlugin } from './source-model.mjs'

export function usePluginConfigDraft(pluginName: string) {
  const source = useConfigSource({ autoLoad: false })
  const [entry, setEntry] = useState<{ name: string; config: unknown; schema: Schema | null; snapshot: ConfigSource } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const sequence = useRef(0)
  const loadSource = source.load
  const load = useCallback(async () => {
    const current = ++sequence.current
    setLoading(true); setError(null); setSchemaError(null)
    try {
      const [snapshot, schemaResult] = await Promise.all([loadSource(), requestConsole<Schema | null>({ type: 'schema:get', pluginName }).then(schema => ({ schema, error: null as string | null }), cause => ({ schema: null, error: cause instanceof Error ? cause.message : '字段定义读取失败' }))])
      const path = snapshot.configPaths?.[pluginName]
      const document = parseConfigDocument(snapshot.source, snapshot.format)
      if (current !== sequence.current) return
      setEntry({ name: pluginName, config: path ? configAtPath(document, path) : undefined, schema: schemaResult.schema, snapshot })
      setSchemaError(schemaResult.error)
      if (!path) setError('Host 未提供此插件的正式配置路径，请刷新或打开完整源码；表单不会猜测保存位置。')
    } catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : '配置读取失败') }
    finally { if (current === sequence.current) setLoading(false) }
  }, [pluginName, loadSource])
  useEffect(() => { void load(); return () => { sequence.current++ } }, [load])
  const config = entry?.name === pluginName ? entry.config : undefined
  const schema = entry?.name === pluginName ? entry.schema : null
  const saveBound = source.saveBound
  const setConfig = useCallback(async (value: unknown, baseline?: ConfigSource) => {
    if (entry?.name !== pluginName) throw new Error('配置快照未知，请刷新后重试')
    const snapshot = baseline ?? entry.snapshot
    const path = snapshot.configPaths?.[pluginName]
    if (!path) throw new Error('Host 配置路径未知，请刷新后重试')
    return saveBound(configSourceForPlugin(snapshot.source, snapshot.format, path, value), snapshot)
  }, [pluginName, entry, saveBound])
  return { config, schema, schemaError, loading: loading || source.loading, error: error ?? source.error,
    loaded: entry?.name === pluginName, snapshot: entry?.name === pluginName ? entry.snapshot : undefined, setConfig, load }
}
