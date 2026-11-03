import { useI18n } from '../i18n'
import { useCallback, useEffect, useRef, useState, useReducer } from 'react'
import { getWebSocketManager } from '@zhin.js/client'
import { configErrorReducer } from './config-error-state.mjs'
import { requestConsole } from '../utils/console-rpc'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../utils/inbox-cache'
import { createDiagnosticRequestGate } from '../pages/endpoint-detail/message-diagnostics.mjs'
import type { ConfigurationApplicationStatus } from '../components/PluginConfigForm/config-live-status.mjs'
import { configurationRuntimeStatus } from '../components/PluginConfigForm/config-live-status.mjs'

export type ConfigSource = ConfigurationApplicationStatus & {
  source: string
  format: 'yaml' | 'json'
  revision: string
  configKeys: string[]
  configPaths?: Readonly<Record<string, readonly string[]>>
  /** Local opaque connection identity; never included in the Host RPC payload. */
  readonly connectionScope?: string
}

type ReplaceResult = ConfigurationApplicationStatus & {
  success: boolean
  revision: string
  restartRequired: boolean
  message?: string
}

type ApplyResult = { status: 'applied'; application: NonNullable<ConfigurationApplicationStatus['application']> }
  | { status: 'conflict'; revision: string; message: string }
  | { status: 'unconfirmed'; message: string }
  | { status: 'invalid'; message: string }

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
  // Reads must not supersede the outcome of an already dispatched application.
  const applyOperations = useRef(createDiagnosticRequestGate(getInboxCacheScope))
  const [feedbackScope, setFeedbackScope] = useState<string | undefined>(undefined)
  const [readErrorScope, setReadErrorScope] = useState<string | undefined>(undefined)
  const [saveErrorScope, setSaveErrorScope] = useState<string | undefined>(undefined)
  const [applyFeedback, setApplyFeedback] = useState<{ scope: string | undefined; revision: string; loading: boolean; error: string | null } | null>(null)
  const blockedApply = useRef<{ scope: string | undefined; revision: string; kind: 'unknown' | 'conflict'; previousOperationId?: string } | null>(null)
  const applying = useRef<object | null>(null)
  const applyOutcome = useRef<{ scope: string | undefined; revision: string; status: ConfigurationApplicationStatus } | null>(null)
  const active = isInboxCacheScopeActive(scope)
  const current = active && config?.connectionScope === scope ? config : null
  const currentReadError = active && readErrorScope === scope ? readError : null
  const currentSaveError = active && saveErrorScope === scope ? saveError : null

  useEffect(() => manager.onConnectionChange(setConnected), [manager])
  useEffect(() => {
    operations.current.cancel(); attempted.current = false; setConfig(null); setLoading(false)
    setFeedbackScope(undefined); errorAction({ type: 'read-start' }); errorAction({ type: 'discard-save' })
    applyOperations.current.cancel(); setApplyFeedback(null); blockedApply.current = null; applying.current = null; applyOutcome.current = null
    return () => { operations.current.cancel(); applyOperations.current.cancel() }
  }, [scope])

  const load = useCallback(async () => {
    if (!isInboxCacheScopeActive(scope)) throw new Error(messages.current.t("连接身份已变化，请在当前 Host 重新读取配置"))
    const request = operations.current.begin()
    const previousOutcome = applyOutcome.current
    setFeedbackScope(scope)
    setLoading(true)
    errorAction({ type: 'read-start' })
    try {
      const result = await requestConsole<ConfigSource>({ type: 'config:get-source' })
      if (!request.current() || !isInboxCacheScopeActive(scope)) throw new Error(messages.current.t("配置读取已过期，请在当前 Host 重新读取"))
      const outcome = applyOutcome.current
      let observed = outcome && outcome !== previousOutcome && outcome.scope === scope && outcome.revision === result.revision
        ? { ...result, application: outcome.status.application, applicationError: outcome.status.applicationError } : result
      const blocked = blockedApply.current
      if (blocked && blocked.scope === scope) {
        const application = configurationRuntimeStatus(observed, blocked.revision)
        const newOperation = application.application?.operationId !== blocked.previousOperationId
        if (blocked.kind === 'conflict' || newOperation && !['unknown', 'unsupported', 'stale'].includes(application.kind)) {
          blockedApply.current = null
          setApplyFeedback(previous => previous && previous.scope === scope && !previous.loading ? { ...previous, error: null } : previous)
        } else if (blocked.kind === 'unknown' && blocked.revision === observed.revision) {
          observed = { ...observed, applicationError: 'unconfirmed' }
        }
      }
      const bound = Object.freeze({ ...observed, connectionScope: scope })
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
      setConfig(current => current && current.connectionScope === scope && current.revision === config.revision
        ? { ...current, source, revision: result.revision, application: result.application, applicationError: result.applicationError } : current)
      if (result.applicationError === 'unconfirmed' || configurationRuntimeStatus(result, result.revision).groups.some(group => group.status === 'unknown')) {
        blockedApply.current = { scope, revision: result.revision, kind: 'unknown', previousOperationId: config.application?.operationId }
      }
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

  const applyConfiguration = useCallback(async () => {
    if (!current?.revision || !isInboxCacheScopeActive(scope) || current.connectionScope !== scope
      || applying.current || blockedApply.current && blockedApply.current.scope === scope && blockedApply.current.revision === current.revision) return
    const request = applyOperations.current.begin()
    applying.current = request
    setApplyFeedback({ scope, revision: current.revision, loading: true, error: null })
    const feedback = (error: string) => setApplyFeedback(previous => previous && previous.scope === scope && previous.revision === current.revision
      ? { ...previous, error } : previous)
    const block = (kind: 'unknown' | 'conflict') => { blockedApply.current = {
      scope, revision: current.revision, kind, previousOperationId: current.application?.operationId,
    } }
    const publish = (status: ConfigurationApplicationStatus) => {
      applyOutcome.current = { scope, revision: current.revision, status }
      setConfig(previous => previous && previous.connectionScope === scope && previous.revision === current.revision
        ? { ...previous, application: status.application, applicationError: status.applicationError } : previous)
    }
    try {
      const result = await requestConsole<ApplyResult>({ type: 'config:apply', expectedRevision: current.revision })
      if (!request.current() || !isInboxCacheScopeActive(scope)) return
      if (result.status === 'applied') {
        const state = configurationRuntimeStatus(result, current.revision)
        const valid = state.application !== undefined && state.kind !== 'unknown'
        publish({ application: result.application, applicationError: valid ? undefined : 'unconfirmed' })
        if (!valid || state.kind === 'stale') block(state.kind === 'stale' ? 'conflict' : 'unknown')
      } else if (result.status === 'invalid') {
        publish({ applicationError: 'invalid' })
        feedback('配置校验失败，本次未应用；请修正后刷新。')
      } else {
        const superseded = result.status === 'conflict'
        block(superseded ? 'conflict' : 'unknown')
        publish({ applicationError: superseded ? 'superseded' : 'unconfirmed' })
        feedback(superseded ? '文件已在别处更新，未提交应用；请先刷新。' : '应用结果未确认，请只读刷新核对；不要重复提交。')
      }
    } catch {
      if (!request.current() || !isInboxCacheScopeActive(scope)) return
      block('unknown')
      publish({ applicationError: 'unconfirmed' })
      feedback('应用结果未确认，请只读刷新核对；不要重复提交。')
    } finally {
      if (applying.current === request) applying.current = null
      if (request.current() && isInboxCacheScopeActive(scope)) setApplyFeedback(previous => previous && previous.scope === scope && previous.revision === current.revision
        ? { ...previous, loading: false } : previous)
    }
  }, [current, scope])

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
    loading: active && (feedbackScope === scope && loading || applyFeedback?.scope === scope && applyFeedback?.loading === true),
    error: currentSaveError ?? currentReadError,
    errorOperation: currentSaveError ? 'save' as const : currentReadError ? 'read' as const : null,
    clearSaveError: () => errorAction({ type: 'discard-save' }),
    load,
    save,
    saveBound,
    applyConfiguration,
    applyLoading: active && applyFeedback?.scope === scope && applyFeedback?.loading === true,
    applyError: active && applyFeedback && applyFeedback.scope === scope && current && current.revision === applyFeedback.revision && applyFeedback.error
      ? messages.current.t(applyFeedback.error) : null,
    applyBlocked: Boolean(current && blockedApply.current && blockedApply.current.scope === scope && blockedApply.current.revision === current.revision),
  }
}
