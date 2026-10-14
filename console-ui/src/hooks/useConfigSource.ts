import { useCallback, useEffect, useRef, useState, useReducer } from 'react'
import { getWebSocketManager } from '@zhin.js/client'
import { configErrorReducer } from './config-error-state.mjs'
import { requestConsole } from '../utils/console-rpc'

export type ConfigSource = {
  source: string
  format: 'yaml' | 'json'
  revision: string
  configKeys: string[]
  configPaths?: Readonly<Record<string, readonly string[]>>
}

type ReplaceResult = {
  success: boolean
  revision: string
  restartRequired: boolean
  message?: string
}

export function useConfigSource({ autoLoad = true }: { autoLoad?: boolean } = {}) {
  const manager = getWebSocketManager()
  const [connected, setConnected] = useState(manager.isConnected())
  const [config, setConfig] = useState<ConfigSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [{ readError, saveError }, errorAction] = useReducer(configErrorReducer, { readError: null, saveError: null })
  const attempted = useRef(false)
  const requestSequence = useRef(0)

  useEffect(() => manager.onConnectionChange(setConnected), [manager])

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current
    setLoading(true)
    errorAction({ type: 'read-start' })
    try {
      const result = await requestConsole<ConfigSource>({ type: 'config:get-source' })
      if (sequence === requestSequence.current) setConfig(result)
      return result
    } catch (cause) {
      if (sequence === requestSequence.current) errorAction({ type: 'read-failed', error: cause instanceof Error ? cause.message : '读取失败' })
      throw cause
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [])

  const saveBound = useCallback(async (source: string, config: ConfigSource) => {
    if (!config?.revision) throw new Error('配置版本未知，请先刷新')
    ++requestSequence.current
    setLoading(true)
    errorAction({ type: 'save-start' })
    try {
      const result = await requestConsole<ReplaceResult>({
        type: 'config:replace-source',
        source,
        expectedRevision: config.revision,
      })
      if (!result.success || !result.revision) throw new Error(result.message || 'Host 未确认配置保存成功')
      setConfig(current => current?.revision === config.revision ? { ...current, source, revision: result.revision } : current)
      errorAction({ type: 'save-succeeded' })
      return result
    } catch (cause) {
      errorAction({ type: 'save-failed', error: cause instanceof Error ? cause.message : 'Unknown error' })
      throw cause
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (source: string) => {
    if (!config) throw new Error('配置版本未知，请先刷新')
    return saveBound(source, config)
  }, [config, saveBound])

  useEffect(() => {
    if (!autoLoad) return
    if (!connected) {
      attempted.current = false
      return
    }
    if (config || attempted.current) return
    attempted.current = true
    void load().catch(() => {})
  }, [autoLoad, connected, config, load])

  return {
    loaded: config !== null,
    snapshot: config,
    source: config?.source ?? '',
    format: config?.format ?? 'yaml',
    configKeys: config?.configKeys ?? [],
    configPaths: config?.configPaths ?? {},
    revision: config?.revision ?? '',
    loading,
    error: saveError ?? readError,
    errorOperation: saveError ? 'save' as const : readError ? 'read' as const : null,
    clearSaveError: () => errorAction({ type: 'discard-save' }),
    load,
    save,
    saveBound,
  }
}
