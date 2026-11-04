import { useCallback, useEffect, useRef } from 'react'
import { apiFetch } from '../utils/auth'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { personalModelFailure, readPersonalModelsView, type PersonalModelsView } from '../pages/personal-models-model.mjs'
import { useConsoleRead } from './use-console-read'

export const PERSONAL_MODELS_PATH = '/api/agent/personal-models'

/**
 * The single reader for `GET /api/agent/personal-models`, shared by the personal
 * models page and the personal-session panel. Built on `useConsoleRead`, so a failed
 * read keeps the previous data and reports `error` instead of looking like an empty
 * success. `error` is a zh message key; render it with `i18n.t(error)`.
 */
export function usePersonalModels(scope?: string) {
  const read = useConsoleRead<PersonalModelsView | null>(async () => {
    if (!isInboxCacheScopeActive(scope)) return null
    const response = await apiFetch(PERSONAL_MODELS_PATH, { cache: 'no-store' })
    let body: any
    try { body = await response.json() } catch { throw new Error('个人模型请求失败，请检查输入后重试。') }
    if (!response.ok || body?.success !== true) throw new Error(personalModelFailure(response.status, body?.code))
    let view: PersonalModelsView
    try { view = readPersonalModelsView(body) } catch { throw new Error('个人模型请求失败，请检查输入后重试。') }
    return isInboxCacheScopeActive(scope) ? view : null
  }, null)
  const { refresh } = read
  const previousScope = useRef(scope)
  useEffect(() => {
    if (previousScope.current === scope) return
    previousScope.current = scope
    void refresh().catch(() => {})
  }, [scope, refresh])
  const reload = useCallback(async () => { await refresh().catch(() => {}) }, [refresh])
  return { view: read.data, loading: read.loading, loaded: read.loaded, error: read.error ?? '', reload }
}
