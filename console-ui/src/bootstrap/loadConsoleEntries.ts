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

const defaultHostRegisterApi = createPluginRegisterHostApi({
  React,
  addRoute: app.addRoute.bind(app),
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

  await loadEntriesFromSdk({
    ...options,
    entriesUrl: options?.entriesUrl ?? entriesUrlForApiBase(apiBase),
    assetOrigin: options?.assetOrigin ?? apiBase,
    hostApi: options?.hostApi ?? defaultHostRegisterApi,
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
  entriesLoadPromise = doLoadConsoleEntries(options).catch((err) => {
    entriesLoadPromise = null
    throw err
  })
  return entriesLoadPromise
}

/** 登出 / 换 Host 后清空插件加载缓存，下次登录会重新拉 /entries */
export function resetConsoleEntries(): void {
  entriesLoadPromise = null
  registeredToolIds.clear()
}
