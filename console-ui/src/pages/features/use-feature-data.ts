import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { useToast } from '../../components/toast'
import { apiFetch } from '../../utils/auth'
import { requestConsole } from '../../utils/console-rpc'
import { ENDPOINT_RPC, FEATURE_RPC } from '../../contracts/zhin-console'
import { validatePluginList } from '../plugin-list-model.mjs'
import { readEndpointList } from '../endpoint-list-model.mjs'
import {
  classifyFeatureRpcError, globalFeatureRows, mergeFeatureMatrix, readFeatureDetail, readFeatureList, readFeatureMatrix,
  readFeatureWriteResult,
  type FeatureDetail, type FeatureLevel, type FeatureList, type FeatureMatrixRow, type FeatureRpcBody,
  type FeatureRpcFailure, type FeatureWriteResult,
} from './feature-model.mjs'

export type MatrixSource = 'loading' | 'rpc' | FeatureRpcFailure

export interface FeatureMatrixState {
  rows: FeatureMatrixRow[]
  adapters: readonly string[]
  /** Endpoint ids per adapter alias known to the Host (drill-down targets). */
  endpoints: Readonly<Record<string, readonly string[]>>
  /** Configuration revision the matrix was read at (`expectedRevision` for writes). */
  revision: string
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
  const [state, setState] = useState<Omit<FeatureMatrixState, 'refresh'>>({ rows: [], adapters: [], endpoints: {}, revision: '', source: 'loading', loading: true, error: null })
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
      setState({ rows: merged.rows, adapters: merged.adapters, endpoints: merged.endpoints, revision: merged.revision, source: remote.source, loading: false, error: null })
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

type Loadable<T> = { value: T | null; status: 'loading' | 'ready' | FeatureRpcFailure; error: string | null }

function useFeatureRead<T>(request: FeatureRpcBody | null, read: (payload: unknown) => T) {
  const [state, setState] = useState<Loadable<T>>({ value: null, status: 'loading', error: null })
  const sequence = useRef(0)
  const body = request ? JSON.stringify(request) : ''
  const reader = useRef(read)
  reader.current = read
  const load = useCallback(() => {
    const ticket = ++sequence.current
    if (!body) return
    setState(previous => ({ ...previous, status: previous.value ? previous.status : 'loading' }))
    requestConsole<unknown>(JSON.parse(body) as FeatureRpcBody).then(payload => {
      if (ticket !== sequence.current) return
      setState({ value: reader.current(payload), status: 'ready', error: null })
    }).catch((error: unknown) => {
      if (ticket !== sequence.current) return
      setState(previous => ({ ...previous, status: classifyFeatureRpcError(error), error: error instanceof Error ? error.message : String(error) }))
    })
  }, [body])
  useEffect(() => {
    load()
    return () => { sequence.current += 1 }
  }, [load])
  return { ...state, refresh: load }
}

/** `feature.list`: every feature with its declared levels. */
export function useFeatureList() {
  return useFeatureRead<FeatureList>({ type: FEATURE_RPC.LIST }, readFeatureList)
}

/** `feature.get` for one plugin at one level (`key` is the alias or `<alias>/<endpointId>`). */
export function useFeatureDetail(plugin: string, level: FeatureLevel, key?: string) {
  return useFeatureRead<FeatureDetail>({ type: FEATURE_RPC.GET, plugin, level, ...(key ? { key } : {}) }, readFeatureDetail)
}

/**
 * Sends one `feature.*` write and reports the outcome. A revision conflict reloads (`reload`) and
 * tells the user the page now shows the newer configuration; every outcome reloads.
 */
export function useFeatureWriter() {
  const i18n = useI18n()
  const toast = useToast()
  const [pending, setPending] = useState<string | null>(null)
  const write = useCallback(async (body: FeatureRpcBody, reload: () => void, id = body.type): Promise<FeatureWriteResult | null> => {
    setPending(id)
    try {
      const result = readFeatureWriteResult(await requestConsole<unknown>(body))
      if (result.status === 'conflict') {
        toast.warning(i18n.t("配置已被其他地方修改，未保存。已重新读取最新配置，请确认后重试。"), i18n.t("配置已变化"))
      } else if (result.status === 'invalid') {
        toast.error([result.message, ...result.errors.map(item => `${item.path}: ${item.message}`)].filter(Boolean).join('\n') || i18n.t("覆盖配置校验失败，未保存"))
      } else if (result.status === 'saved') {
        toast.success(result.restartRequired ? i18n.t("已保存，Host 正在重启以应用全局开关。") : i18n.t("已保存，立即生效。"))
      }
      if (result.warnings.length) toast.warning(result.warnings.map(item => item.message).join('\n'), i18n.t("请注意"))
      reload()
      return result
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error), i18n.t("保存失败"))
      return null
    } finally {
      setPending(null)
    }
  }, [i18n, toast])
  return { write, pending }
}
