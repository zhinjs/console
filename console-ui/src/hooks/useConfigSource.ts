import { useCallback, useEffect, useRef, useState, useReducer } from 'react'
import { getWebSocketManager } from '@zhin.js/client'
import { configErrorReducer } from './config-error-state.mjs'
import { requestConsole } from '../utils/console-rpc'

type ConfigSource = {
  source: string
  format: 'yaml' | 'json'
  revision: string
  configKeys: string[]
}

type ReplaceResult = {
  success: boolean
  revision: string
  restartRequired: boolean
  message?: string
}

export function useConfigSource() {
  const manager = getWebSocketManager()
  const [connected, setConnected] = useState(manager.isConnected())
  const [config, setConfig] = useState<ConfigSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [{ readError, saveError }, errorAction] = useReducer(configErrorReducer, { readError: null, saveError: null })
  const attempted = useRef(false)

  useEffect(() => manager.onConnectionChange(setConnected), [manager])

  const load = useCallback(async () => {
    setLoading(true)
    errorAction({ type: 'read-start' })
    try {
      const result = await requestConsole<ConfigSource>({ type: 'config:get-source' })
      setConfig(result)
      return result
    } catch (cause) {
      errorAction({ type: 'read-failed', error: cause instanceof Error ? cause.message : 'Unknown error' })
      throw cause
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (source: string) => {
    if (!config?.revision) throw new Error('配置版本未知，请先刷新')
    setLoading(true)
    errorAction({ type: 'save-start' })
    try {
      const result = await requestConsole<ReplaceResult>({
        type: 'config:replace-source',
        source,
        expectedRevision: config.revision,
      })
      setConfig({ ...config, source, revision: result.revision })
      errorAction({ type: 'save-succeeded' })
      return result
    } catch (cause) {
      errorAction({ type: 'save-failed', error: cause instanceof Error ? cause.message : 'Unknown error' })
      throw cause
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => {
    if (!connected) {
      attempted.current = false
      return
    }
    if (config || attempted.current) return
    attempted.current = true
    void load().catch(() => {})
  }, [connected, config, load])

  return {
    loaded: config !== null,
    source: config?.source ?? '',
    format: config?.format ?? 'yaml',
    configKeys: config?.configKeys ?? [],
    loading,
    error: saveError ?? readError,
    errorOperation: saveError ? 'save' as const : readError ? 'read' as const : null,
    clearSaveError: () => errorAction({ type: 'discard-save' }),
    load,
    save,
  }
}
