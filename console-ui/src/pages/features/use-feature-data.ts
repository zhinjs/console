import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { apiFetch } from '../../utils/auth'
import { requestConsole } from '../../utils/console-rpc'
import { ENDPOINT_RPC, FEATURE_RPC } from '../../contracts/zhin-console'
import { validatePluginList } from '../plugin-list-model.mjs'
import { readEndpointList } from '../endpoint-list-model.mjs'
import {
  classifyFeatureRpcError, featureProbeStatus, globalFeatureRows, mergeFeatureMatrix, readFeatureMatrix,
  type FeatureMatrixRow, type FeatureProbeStatus, type FeatureRpcFailure,
} from './feature-model.mjs'

export type MatrixSource = 'loading' | 'rpc' | FeatureRpcFailure

export interface FeatureMatrixState {
  rows: FeatureMatrixRow[]
  adapters: readonly string[]
  /** `rpc` when the Host served `feature.matrix`; otherwise only the global column is real. */
  source: MatrixSource
  loading: boolean
  error: string | null
  refresh: () => void
}

/**
 * Feature matrix data. Today it is the global column from plugin enable state; once the Host
 * serves `feature.matrix` (ADR 0050 §8) adapter columns come from it. Nothing is invented when
 * the RPC is missing.
 */
export function useFeatureMatrix(): FeatureMatrixState {
  const i18n = useI18n()
  const [state, setState] = useState<Omit<FeatureMatrixState, 'refresh'>>({ rows: [], adapters: [], source: 'loading', loading: true, error: null })
  const sequence = useRef(0)
  const load = useCallback(() => {
    const request = ++sequence.current
    setState(previous => ({ ...previous, loading: true }))
    const plugins = apiFetch('/api/plugins').then(async response => {
      if (!response.ok) throw new Error(response.status === 403 ? i18n.t("当前身份无权读取插件列表") : i18n.t("插件读取失败（HTTP {0}）", [response.status]))
      return globalFeatureRows(validatePluginList(await response.json(), i18n.locale))
    })
    const matrix = requestConsole<unknown>({ type: FEATURE_RPC.MATRIX })
      .then(payload => ({ matrix: readFeatureMatrix(payload), source: 'rpc' as const }))
      .catch((error: unknown) => ({ matrix: null, source: classifyFeatureRpcError(error) }))
    void Promise.all([plugins, matrix]).then(([globalRows, remote]) => {
      if (request !== sequence.current) return
      const merged = mergeFeatureMatrix(globalRows, remote.matrix)
      setState({ rows: merged.rows, adapters: merged.adapters, source: remote.source, loading: false, error: null })
    }, (error: unknown) => {
      if (request !== sequence.current) return
      setState(previous => ({ ...previous, source: previous.source === 'loading' ? 'error' : previous.source, loading: false, error: error instanceof Error ? error.message : String(error) }))
    })
  }, [i18n])
  useEffect(() => {
    load()
    return () => { sequence.current += 1 }
  }, [load])
  return { ...state, refresh: load }
}

export interface EndpointSummaryItem {
  name: string
  adapter: string
  connected: boolean
  status: 'online' | 'offline'
  pendingRequestCount?: number
  pendingNoticeCount?: number
}

/** `endpoint.list`, shared by the adapter pages. */
export function useEndpointList() {
  const i18n = useI18n()
  const [state, setState] = useState<{ endpoints: EndpointSummaryItem[]; loading: boolean; loaded: boolean; error: string | null }>({ endpoints: [], loading: true, loaded: false, error: null })
  const sequence = useRef(0)
  const load = useCallback(() => {
    const request = ++sequence.current
    setState(previous => ({ ...previous, loading: true }))
    requestConsole<unknown>({ type: ENDPOINT_RPC.LIST }).then(payload => {
      if (request !== sequence.current) return
      setState({ endpoints: readEndpointList(payload, i18n.locale), loading: false, loaded: true, error: null })
    }, (error: unknown) => {
      if (request !== sequence.current) return
      setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }))
    })
  }, [i18n.locale])
  useEffect(() => {
    load()
    return () => { sequence.current += 1 }
  }, [load])
  return { ...state, refresh: load }
}

/** Whether the Host serves `feature.*` at all, by attempting `feature.get` once. */
export function useFeatureRpcProbe(level: 'adapter' | 'endpoint', key: string): FeatureProbeStatus | 'checking' {
  const [status, setStatus] = useState<FeatureProbeStatus | 'checking'>('checking')
  useEffect(() => {
    let cancelled = false
    setStatus('checking')
    requestConsole({ type: FEATURE_RPC.GET, level, key }).then(
      () => { if (!cancelled) setStatus(featureProbeStatus({ ok: true })) },
      (error: unknown) => { if (!cancelled) setStatus(featureProbeStatus({ ok: false, error })) },
    )
    return () => { cancelled = true }
  }, [level, key])
  return status
}
