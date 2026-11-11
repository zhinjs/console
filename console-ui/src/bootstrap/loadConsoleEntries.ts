import { translate } from '../i18n/locale.mjs'
import * as React from 'react'
import {
  AdapterConsolePage,
  DeclarativePageView,
  fetchConsoleEntries,
  registerConsolePluginsFromEntries,
  type DeclarativePageComponentProps,
  type DeclarativePageSpec,
  type LoadConsoleEntriesOptions,
} from '@zhin.js/client'
import type { PluginRegisterHostApi } from '@zhin.js/contract'
import { app } from '../utils/console-client'
import { createHostRegistration } from './host-registration.mjs'
import { getApiBase, getToken } from '../utils/auth'
import { placePluginRoute } from '../navigation-taxonomy'
import { withSandboxConversationDetails } from './sandbox-conversation-details'

const g = globalThis as unknown as {
  __ZHIN_RENDER_BLUEPRINT__?: (specOrBp: unknown, pageProps?: DeclarativePageComponentProps) => React.ReactElement
  __ZHIN_RENDER_ADAPTER_PAGE__?: (bpOrKey: string | { adapterKey?: unknown }) => React.ReactElement
}
if (!g.__ZHIN_RENDER_BLUEPRINT__) {
  g.__ZHIN_RENDER_BLUEPRINT__ = (specOrBp, pageProps) => {
    const raw = specOrBp as { reviewSpec?: unknown; spec?: DeclarativePageSpec } | null | undefined
    const spec = (raw && typeof raw === 'object' && raw.reviewSpec != null
      ? raw
      : (raw && typeof raw === 'object' ? (raw.spec ?? raw) : specOrBp)) as DeclarativePageSpec
    return React.createElement(DeclarativePageView as unknown as React.ComponentType<Record<string, unknown>>, { spec, pageProps })
  }
}
if (!g.__ZHIN_RENDER_ADAPTER_PAGE__) {
  g.__ZHIN_RENDER_ADAPTER_PAGE__ = (bpOrKey) => {
    const adapterKey = typeof bpOrKey === 'string'
      ? bpOrKey
      : String((bpOrKey as { adapterKey?: unknown } | null | undefined)?.adapterKey ?? '')
    return React.createElement(AdapterConsolePage as unknown as React.ComponentType<Record<string, unknown>>, { adapterKey })
  }
}

type AddToolInput = Parameters<typeof app.addTool>[0]

const registeredToolIds = new Set<string>()

/** StrictMode / HMR 可能重复 register；已存在的 tool id 静默跳过 */
function idempotentAddTool(input: AddToolInput): string {
  if (input.id && registeredToolIds.has(input.id)) {
    return input.id
  }
  try {
    const id = app.addTool(input)
    registeredToolIds.add(id)
    return id
  } catch (error) {
    if (
      input.id &&
      error instanceof Error &&
      error.message.includes('already exists')
    ) {
      registeredToolIds.add(input.id)
      return input.id
    }
    throw error
  }
}

export const hostRegistrations = createHostRegistration({
  addRoute: app.addRoute.bind(app),
  removeRoute: app.removeRoute.bind(app),
  readRoutes: () => app.getRoutes(),
  addTool: idempotentAddTool,
})

function entriesUrlForApiBase(apiBase: string): string {
  const base = apiBase.replace(/\/$/, '')
  return base ? `${base}/entries` : '/entries'
}

/** 成功加载后复用同一 Promise，避免 React StrictMode 二次 effect 重复注册插件 */
let entriesLoadPromise: Promise<void> | null = null

/** Sections declared by `/entries` for plugin page paths; read when the page registers. */
const declaredSections = new Map<string, string>()

async function doLoadConsoleEntries(options?: LoadConsoleEntriesOptions, locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<void> {
  const apiBase = getApiBase()
  const session = hostRegistrations.capture()
  const requestedApi = options?.hostApi
  const hostApi: PluginRegisterHostApi = {
    React,
    addRoute: (input) => {
      if (!session.active()) return
      const route = input as Parameters<typeof app.addRoute>[0]
      const placed = withSandboxConversationDetails(placePluginRoute(route, declaredSections.get(route.path)))
      if (requestedApi) requestedApi.addRoute(placed as Parameters<typeof requestedApi.addRoute>[0])
      else session.addRoute(placed)
    },
    addTool: (input) => {
      if (!session.active()) throw new Error('Host connection changed; stale tool registration ignored')
      return requestedApi ? requestedApi.addTool(input as Parameters<typeof requestedApi.addTool>[0]) : session.addTool(input as AddToolInput)
    },
  }

  const resolvedLocale = options?.locale ?? locale
  const fetchInit = options?.fetchInit ??
    (() => {
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      return { headers }
    })
  options?.beforeLoad?.()
  // Fetched here rather than by the SDK loader so an entry's `section` (ADR 0052) reaches
  // placement: the SDK's convention-page adapter does not forward it.
  let response: Awaited<ReturnType<typeof fetchConsoleEntries>>
  try {
    response = await fetchConsoleEntries({ entriesUrl: options?.entriesUrl ?? entriesUrlForApiBase(apiBase), signal: options?.signal, fetchInit })
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 0
    console.warn(
      `[zhin-console] GET ${entriesUrlForApiBase(apiBase)} failed (HTTP ${status}). ` +
        translate(locale, "确认 Host 已启动、API Base 与 corsOrigins 一致。"),
    )
    options?.onFetchError?.(status)
    return
  }
  const entries = response.entries ?? []
  if (!entries.length) {
    console.warn('[zhin-console] /entries returned empty list.')
    options?.onEmpty?.()
    return
  }
  for (const [path, section] of entrySections(entries)) declaredSections.set(path, section)
  await registerConsolePluginsFromEntries(entries, hostApi, (entry, error) => {
    console.error(`[zhin-console] Failed to load plugin "${entry.id}":`, error)
    options?.onEntryError?.(entry, error)
  }, options?.assetOrigin ?? apiBase, resolvedLocale)
}

/** Route path -> declared section for entries that carry `section` (top level, `meta` or `metadata`). */
function entrySections(entries: readonly unknown[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const raw of entries) {
    const entry = raw as { id?: unknown; route?: unknown; section?: unknown; meta?: { section?: unknown }; metadata?: { section?: unknown } }
    const section = entry.section ?? entry.meta?.section ?? entry.metadata?.section
    if (typeof section !== 'string' || !section) continue
    const path = typeof entry.route === 'string' && entry.route ? entry.route : `/${String(entry.id ?? '')}`
    out.push([path, section])
  }
  return out
}

export function loadConsoleEntries(options?: LoadConsoleEntriesOptions, locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<void> {
  if (entriesLoadPromise) return entriesLoadPromise
  const pending = doLoadConsoleEntries(options, locale).catch((err) => {
    if (entriesLoadPromise === pending) entriesLoadPromise = null
    throw err
  })
  entriesLoadPromise = pending
  return pending
}

/** 登出 / 换 Host 后清空插件加载缓存，下次登录会重新拉 /entries */
export function resetConsoleEntries(): void {
  entriesLoadPromise = null
  declaredSections.clear()
  hostRegistrations.reset()
  // Published SDK has no removeTool. Preserve known IDs to avoid duplicate
  // registrations; stale asynchronous calls are rejected by the epoch guard.
}
