import * as React from 'react'
import {
  configureConsole,
  createPluginRegisterHostApi,
  fetchConsoleEntries,
  getRegisterFn,
  loadConsoleEntries as loadEntriesFromSdk,
  registerConsolePluginsFromEntries,
  type CreatePluginRegisterHostApiOptions,
  type FetchConsoleEntriesOptions,
  type LoadConsoleEntriesOptions,
} from '@zhin.js/client'
import { app } from '@zhin.js/client'
import { createHostRegistration } from './host-registration.mjs'
import { getApiBase, getToken } from '../utils/auth'

export type {
  CreatePluginRegisterHostApiOptions,
  FetchConsoleEntriesOptions,
  LoadConsoleEntriesOptions,
}
export {
  createPluginRegisterHostApi,
  fetchConsoleEntries,
  getRegisterFn,
  registerConsolePluginsFromEntries,
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
  readRoutes: () => app._getRoutes(),
  addTool: idempotentAddTool,
})

function entriesUrlForApiBase(apiBase: string): string {
  const base = apiBase.replace(/\/$/, '')
  return base ? `${base}/entries` : '/entries'
}

/** 成功加载后复用同一 Promise，避免 React StrictMode 二次 effect 重复注册插件 */
let entriesLoadPromise: Promise<void> | null = null

async function doLoadConsoleEntries(options?: LoadConsoleEntriesOptions): Promise<void> {
  const apiBase = getApiBase()
  const session = hostRegistrations.capture()
  const requestedApi = options?.hostApi
  const hostApi = createPluginRegisterHostApi({
    React,
    addRoute: (input) => {
      if (!session.active()) return
      if (requestedApi) requestedApi.addRoute(input)
      else session.addRoute(input as Parameters<typeof app.addRoute>[0])
    },
    addTool: (input) => {
      if (!session.active()) throw new Error('Host connection changed; stale tool registration ignored')
      return requestedApi ? requestedApi.addTool(input) : session.addTool(input as AddToolInput)
    },
  })

  await loadEntriesFromSdk({
    ...options,
    entriesUrl: options?.entriesUrl ?? entriesUrlForApiBase(apiBase),
    assetOrigin: options?.assetOrigin ?? apiBase,
    hostApi,
    beforeLoad: () => {
      configureConsole({
        getRuntimeEnv: () =>
          (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'development'
            ? 'development'
            : 'production',
      })
      options?.beforeLoad?.()
    },
    fetchInit:
      options?.fetchInit ??
      (() => {
        const token = getToken()
        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`
        return { headers }
      }),
    onFetchError: (status) => {
      console.warn(
        `[zhin-console] GET ${entriesUrlForApiBase(apiBase)} failed (HTTP ${status}). ` +
          '确认 Host 已启动、API Base 与 corsOrigins 一致。',
      )
      options?.onFetchError?.(status)
    },
    onEmpty: () => {
      console.warn('[zhin-console] /entries returned empty list.')
      options?.onEmpty?.()
    },
    onEntryError: (entry, error) => {
      console.error(`[zhin-console] Failed to load plugin "${entry.id}":`, error)
      options?.onEntryError?.(entry, error)
    },
  })
}

export function loadConsoleEntries(options?: LoadConsoleEntriesOptions): Promise<void> {
  if (entriesLoadPromise) return entriesLoadPromise
  const pending = doLoadConsoleEntries(options).catch((err) => {
    if (entriesLoadPromise === pending) entriesLoadPromise = null
    throw err
  })
  entriesLoadPromise = pending
  return pending
}

/** 登出 / 换 Host 后清空插件加载缓存，下次登录会重新拉 /entries */
export function resetConsoleEntries(): void {
  entriesLoadPromise = null
  hostRegistrations.reset()
  // Published SDK has no removeTool. Preserve known IDs to avoid duplicate
  // registrations; stale asynchronous calls are rejected by the epoch guard.
}
