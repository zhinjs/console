import { useI18n } from '../../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfigSource, type ConfigSource } from '../../hooks/useConfigSource'
import { requestConsole } from '../../utils/console-rpc'
import type { Schema } from './types.js'
import { parseConfigDocument, configAtPath, configSourceForPlugin } from './source-model.mjs'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { createDiagnosticRequestGate } from '../../pages/endpoint-detail/message-diagnostics.mjs'

export function usePluginConfigDraft(pluginName: string) {
  const i18n = useI18n()
  const messages = useRef(i18n)
  messages.current = i18n
  const source = useConfigSource({ autoLoad: false })
  const scope = source.scope
  const [entry, setEntry] = useState<{ name: string; config: unknown; schema: Schema | null; snapshot: ConfigSource } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const reads = useRef(createDiagnosticRequestGate(getInboxCacheScope))
  const [feedbackScope, setFeedbackScope] = useState<string | undefined>(undefined)
  const loadSource = source.load
  const load = useCallback(async () => {
    if (!isInboxCacheScopeActive(scope)) return
    const request = reads.current.begin()
    setFeedbackScope(scope)
    setLoading(true); setError(null); setSchemaError(null)
    try {
      const [snapshot, schemaResult] = await Promise.all([loadSource(), requestConsole<Schema | null>({ type: 'schema:get', pluginName }).then(schema => ({ schema, error: null as string | null }), cause => ({ schema: null, error: cause instanceof Error ? cause.message : messages.current.t("字段定义读取失败") }))])
      if (!request.current() || !isInboxCacheScopeActive(scope) || snapshot.connectionScope !== scope) return
      const path = snapshot.configPaths?.[pluginName]
      const document = parseConfigDocument(snapshot.source, snapshot.format, messages.current.locale)
      setEntry({ name: pluginName, config: path ? configAtPath(document, path, messages.current.locale) : undefined, schema: schemaResult.schema, snapshot })
      setSchemaError(schemaResult.error)
      if (!path) setError(messages.current.t("Host 未提供此插件的正式配置路径，请刷新或打开完整源码；表单不会猜测保存位置。"))
    } catch (cause) { if (request.current() && isInboxCacheScopeActive(scope)) setError(cause instanceof Error ? cause.message : messages.current.t("配置读取失败")) }
    finally { if (request.current() && isInboxCacheScopeActive(scope)) setLoading(false) }
  }, [pluginName, loadSource, scope])
  useEffect(() => {
    reads.current.cancel(); setEntry(null); setError(null); setSchemaError(null); setLoading(false)
    void load(); return () => reads.current.cancel()
  }, [load])
  const current = isInboxCacheScopeActive(scope) && entry && entry.snapshot.connectionScope === scope && entry.name === pluginName ? entry : null
  const config = current?.config
  const schema = current?.schema ?? null
  const saveBound = source.saveBound
  const setConfig = useCallback(async (value: unknown, baseline?: ConfigSource) => {
    if (!isInboxCacheScopeActive(scope) || !current) throw new Error(messages.current.t("配置快照不属于当前连接，请刷新后重试"))
    const snapshot = baseline ?? current.snapshot
    if (snapshot.connectionScope !== scope) throw new Error(messages.current.t("草稿属于旧连接，请重新读取当前 Host 配置"))
    const path = snapshot.configPaths?.[pluginName]
    if (!path) throw new Error(messages.current.t("Host 配置路径未知，请刷新后重试"))
    return saveBound(configSourceForPlugin(snapshot.source, snapshot.format, path, value, messages.current.locale), snapshot)
  }, [pluginName, current, saveBound, scope])
  const feedbackCurrent = isInboxCacheScopeActive(scope) && feedbackScope === scope
  return { scope, config, schema, schemaError: feedbackCurrent ? schemaError : null,
    loading: feedbackCurrent && loading || source.loading, error: feedbackCurrent ? error ?? source.error : source.error,
    loaded: current !== null, snapshot: current?.snapshot, setConfig, load }
}
