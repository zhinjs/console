import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { apiFetch } from '../../utils/auth'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { IAM_MANAGE, IAM_RPC, readUsers, type IamUser } from './access-model.mjs'
import { iamErrorKind, readIamReply, type IamErrorKind } from './iam-request.mjs'

type Translate = (message: string, values?: readonly unknown[]) => string

let requestSequence = 0

/** One `iam.*` RPC. Rejects with `IamRequestError` (Host code preserved). */
export async function iamRequest<T = unknown>(type: string, payload: Record<string, unknown>, t: Translate): Promise<T> {
  const response = await apiFetch('/api/console/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, type, requestId: ++requestSequence }),
  })
  let json: unknown = null
  try { json = await response.json() } catch { json = null }
  return readIamReply(response.status, json, t) as T
}

export interface IamReadState<T> {
  data: T
  loading: boolean
  loaded: boolean
  error: string | null
  errorKind: IamErrorKind | null
  refresh: () => void
}

/** Loads one `iam.*` listing; a failed refresh keeps the last good data. */
export function useIamRead<T>(type: string, read: (payload: unknown) => T, initial: T, payload: Record<string, unknown> = {}): IamReadState<T> {
  const i18n = useI18n()
  const [state, setState] = useState<Omit<IamReadState<T>, 'refresh'>>({ data: initial, loading: true, loaded: false, error: null, errorKind: null })
  const sequence = useRef(0)
  const readRef = useRef(read)
  readRef.current = read
  const key = JSON.stringify(payload)
  const load = useCallback(() => {
    const request = ++sequence.current
    setState(previous => ({ ...previous, loading: true }))
    iamRequest<unknown>(type, JSON.parse(key) as Record<string, unknown>, i18n.t).then(reply => {
      if (request !== sequence.current) return
      setState({ data: readRef.current(reply), loading: false, loaded: true, error: null, errorKind: null })
    }, (error: unknown) => {
      if (request !== sequence.current) return
      setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error), errorKind: iamErrorKind(error) }))
    })
  }, [type, key, i18n])
  useEffect(() => {
    load()
    return () => { sequence.current += 1 }
  }, [load])
  return { ...state, refresh: load }
}

const EMPTY_USERS: IamUser[] = []

export function useIamUsers(): IamReadState<IamUser[]> {
  return useIamRead(IAM_RPC.USERS_LIST, readUsers, EMPTY_USERS)
}

/** Whether the signed-in principal may change access control (the Host decides in the end). */
export function useCanManageIam(): boolean {
  const access = useConsoleAccess()
  return hasConsolePermission(IAM_MANAGE, access)
}
