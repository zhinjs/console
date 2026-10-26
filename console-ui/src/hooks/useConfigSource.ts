import { useI18n } from '../i18n'
import { useCallback, useEffect, useRef, useState, useReducer } from 'react'
import { getWebSocketManager } from '@zhin.js/client'
import { configErrorReducer } from './config-error-state.mjs'
import { requestConsole } from '../utils/console-rpc'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../utils/inbox-cache'
import { createDiagnosticRequestGate } from '../pages/endpoint-detail/message-diagnostics.mjs'

export type ConfigSource = {
  source: string
  format: 'yaml' | 'json'
  revision: string
  configKeys: string[]
  configPaths?: Readonly<Record<string, readonly string[]>>
  /** Local opaque connection identity; never included in the Host RPC payload. */
  readonly connectionScope?: string
}

type ReplaceResult = {
  success: boolean
  revision: string
  restartRequired: boolean
  message?: string
}

export function useConfigSource({ autoLoad = true }: { autoLoad?: boolean } = {}) {
  const i18n = useI18n()
  const messages = useRef(i18n)
  messages.current = i18n
  const manager = getWebSocketManager()
  const scope = useInboxCacheScope()
  const [connected, setConnected] = useState(manager.isConnected())
  const [config, setConfig] = useState<ConfigSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [{ readError, saveError }, errorAction] = useReducer(configErrorReducer, { readError: null, saveError: null })
  const attempted = useRef(false)
  const operations = useRef(createDiagnosticRequestGate(getInboxCacheScope))
  const [feedbackScope, setFeedbackScope] = useState<string | undefined>(undefined)
  const [readErrorScope, setReadErrorScope] = useState<string | undefined>(undefined)
  const [saveErrorScope, setSaveErrorScope] = useState<string | undefined>(undefined)
  const active = isInboxCacheScopeActive(scope)
  const current = active && config?.connectionScope === scope ? config : null
  const currentReadError = active && readErrorScope === scope ? readError : null
  const currentSaveError = active && saveErrorScope === scope ? saveError : null

  useEffect(() => manager.onConnectionChange(setConnected), [manager])
  useEffect(() => {
    operations.current.cancel(); attempted.current = false; setConfig(null); setLoading(false)
    setFeedbackScope(undefined); errorAction({ type: 'read-start' }); errorAction({ type: 'discard-save' })
    return () => operations.current.cancel()
  }, [scope])

  const load = useCallback(async () => {
    if (!isInboxCacheScopeActive(scope)) throw new Error(messages.current.t("连接身份已变化，请在当前 Host 重新读取配置"))
    const request = operations.current.begin()
    setFeedbackScope(scope)
    setLoading(true)
    errorAction({ type: 'read-start' })
    try {
      const result = await requestConsole<ConfigSource>({ type: 'config:get-source' })
      if (!request.current() || !isInboxCacheScopeActive(scope)) throw new Error(messages.current.t("配置读取已过期，请在当前 Host 重新读取"))
      const bound = Object.freeze({ ...result, connectionScope: scope })
      setConfig(bound)
      return bound
    } catch (cause) {
      if (!request.current() || !isInboxCacheScopeActive(scope)) throw new Error(messages.current.t("配置读取已过期，请在当前 Host 重新读取"))
      setReadErrorScope(scope); errorAction({ type: 'read-failed', error: cause instanceof Error ? cause.message : messages.current.t("读取失败") })
      throw cause
    } finally {
      if (request.current() && isInboxCacheScopeActive(scope)) setLoading(false)
    }
  }, [scope])

  const saveBound = useCallback(async (source: string, config: ConfigSource) => {
    if (!config?.revision) throw new Error(messages.current.t("配置版本未知，请先刷新"))
    if (!isInboxCacheScopeActive(scope) || config.connectionScope !== scope) throw new Error(messages.current.t("配置属于旧连接，请在当前 Host 重新读取后保存"))
    const request = operations.current.begin()
    setFeedbackScope(scope)
    setLoading(true)
    errorAction({ type: 'save-start' })
    try {
      const result = await requestConsole<ReplaceResult>({
        type: 'config:replace-source',
        source,
        expectedRevision: config.revision,
      })
      if (!request.current() || !isInboxCacheScopeActive(scope)) throw new Error(messages.current.t("保存结果属于旧连接或已被替代，请到原 Host 核实；当前页面不会重试"))
      if (!result.success || !result.revision) throw new Error(result.message || messages.current.t("Host 未确认配置保存成功"))
      setConfig(current => current && current.connectionScope === scope && current.revision === config.revision ? { ...current, source, revision: result.revision } : current)
      errorAction({ type: 'save-succeeded' })
      return result
    } catch (cause) {
      if (!request.current() || !isInboxCacheScopeActive(scope)) throw new Error(messages.current.t("保存结果属于旧连接或已被替代，请到原 Host 核实；当前页面不会重试"))
      setSaveErrorScope(scope); errorAction({ type: 'save-failed', error: cause instanceof Error ? cause.message : 'Unknown error' })
      throw cause
    } finally {
      if (request.current() && isInboxCacheScopeActive(scope)) setLoading(false)
    }
  }, [scope])

  const save = useCallback(async (source: string) => {
    if (!current) throw new Error(messages.current.t("配置版本未知，请先在当前 Host 刷新"))
    return saveBound(source, current)
  }, [current, saveBound])

  useEffect(() => {
    if (!autoLoad || !active) return
    if (!connected) {
      attempted.current = false
      return
    }
    if (current || attempted.current) return
    attempted.current = true
    void load().catch(() => {})
  }, [autoLoad, connected, current, load, active])

  return {
    scope: active ? scope : undefined,
    loaded: current !== null,
    snapshot: current,
    source: current?.source ?? '',
    format: current?.format ?? 'yaml',
    configKeys: current?.configKeys ?? [],
    configPaths: current?.configPaths ?? {},
    revision: current?.revision ?? '',
    loading: active && feedbackScope === scope && loading,
    error: currentSaveError ?? currentReadError,
    errorOperation: currentSaveError ? 'save' as const : currentReadError ? 'read' as const : null,
    clearSaveError: () => errorAction({ type: 'discard-save' }),
    load,
    save,
    saveBound,
  }
}
