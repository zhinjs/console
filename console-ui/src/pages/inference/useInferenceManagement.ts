import { useEffect, useRef, useState } from 'react'
import { apiFetch, getApiBase } from '../../utils/auth'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import {
  inferenceRequest,
  applyInferenceChange,
  inferenceError,
  InferenceRequestError,
  resourceBindings,
  readPendingMutation,
  storePendingMutation,
  type Owner,
  type View,
  type ObjectValue,
} from './model.mjs'

interface Prepared {
  prepared: ObjectValue
  fingerprint: string
  baseRevision: number
}
interface RequestIdentity {
  readonly epoch: number
  readonly ownerId: string
  readonly base: string
}

/** One authenticated connection owns this workspace; a saved receipt belongs to one Host and owner. */
export function useInferenceManagement(connectionScope?: string) {
  const [owners, setOwners] = useState<Owner[]>([])
  const [ownerId, setOwnerId] = useState('')
  const [view, setView] = useState<View | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const epoch = useRef(0)
  const alive = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const owner = useRef('')
  const busyOperation = useRef<number | null>(null)
  const pendingId = useRef<string | null>(null)

  const connectionActive = () => alive.current && isInboxCacheScopeActive(connectionScope)
  const current = (identity: RequestIdentity) =>
    connectionActive() && identity.epoch === epoch.current && identity.ownerId === owner.current
  const capture = (): RequestIdentity => ({
    epoch: epoch.current,
    ownerId: owner.current,
    base: getApiBase(),
  })

  function restorePending(identity: RequestIdentity) {
    try {
      const id = readPendingMutation(sessionStorage, identity.base, identity.ownerId)
      pendingId.current = id
      setPending(id)
    } catch {
      setError('浏览器暂时无法读取保存编号；读取配置不受影响。')
    }
  }
  function remember(identity: RequestIdentity, id: string | null) {
    storePendingMutation(sessionStorage, {
      base: identity.base,
      ownerId: identity.ownerId,
      mutationId: id,
    })
    if (current(identity)) {
      pendingId.current = id
      setPending(id)
    }
  }
  function forgetProvedReceipt(identity: RequestIdentity) {
    try {
      remember(identity, null)
    } catch {
      // The transaction is already proved; browser cleanup cannot change its result.
      if (current(identity)) setError('已保存；浏览器暂未清除操作编号，可再次查询保存结果。')
    }
  }

  async function load(preferredOwner = owner.current) {
    if (!connectionActive()) return
    const id = ++epoch.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    busyOperation.current = id
    setBusy(true)
    setError('')
    try {
      const available = await inferenceRequest<Owner[]>(apiFetch, {
        path: '/owners',
        signal: abort.signal,
      })
      if (!connectionActive() || id !== epoch.current) return
      const selected = available.some((value) => value.id === preferredOwner)
        ? preferredOwner
        : available[0]?.id ?? ''
      if (selected !== owner.current) setView(null)
      owner.current = selected
      setOwners(available)
      setOwnerId(selected)
      if (!selected) {
        setView(null)
        return
      }
      const identity = capture()
      restorePending(identity)
      const next = await inferenceRequest<View>(apiFetch, {
        ownerId: selected,
        signal: abort.signal,
      })
      if (current(identity)) setView(next)
    } catch (failure) {
      if (connectionActive() && id === epoch.current && !abort.signal.aborted) {
        if (failure instanceof InferenceRequestError && [401, 403].includes(failure.status)) {
          setView(null)
          setOwners([])
          owner.current = ''
          setOwnerId('')
        }
        setError(inferenceError(failure))
      }
    } finally {
      if (connectionActive() && busyOperation.current === id) {
        busyOperation.current = null
        setBusy(false)
      }
    }
  }

  useEffect(() => {
    alive.current = true
    epoch.current++
    controller.current?.abort()
    owner.current = ''
    pendingId.current = null
    busyOperation.current = null
    setOwners([])
    setOwnerId('')
    setView(null)
    setPending(null)
    setError('')
    setBusy(false)
    void load('')
    return () => {
      alive.current = false
      epoch.current++
      controller.current?.abort()
    }
  }, [connectionScope])

  // Every rendered handler captures this identity. Switching an owner invalidates old child callbacks too.
  const renderedIdentity = capture()
  const active = () => current(renderedIdentity)
  async function request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    if (!active()) throw new InferenceRequestError('stale-operation')
    const result = await inferenceRequest<T>(apiFetch, {
      path,
      ownerId: renderedIdentity.ownerId,
      body,
      method,
    })
    if (!active()) throw new InferenceRequestError('stale-operation')
    return result
  }

  async function save(path: string, body: unknown): Promise<boolean> {
    if (!active() || busyOperation.current !== null || pendingId.current) return false
    const identity = renderedIdentity
    busyOperation.current = identity.epoch
    setBusy(true)
    setError('')
    try {
      const prepared = await request<Prepared>(path, body)
      if (!current(identity)) return false
      const mutationId = crypto.randomUUID()
      // Persist only the receipt ID before submission. No secret/capsule/body is stored in the browser.
      try {
        remember(identity, mutationId)
      } catch {
        throw new InferenceRequestError('receipt-storage-unavailable')
      }
      const result = await applyInferenceChange(apiFetch, {
        ownerId: identity.ownerId,
        prepared: prepared.prepared,
        mutationId,
      })
      if (result.status === 'commit-unknown') throw new InferenceRequestError('outcome-unknown')
      if (result.status === 'committed') forgetProvedReceipt(identity)
      else remember(identity, null)
      if (!current(identity)) return result.status === 'committed'
      if (result.status !== 'committed')
        throw new InferenceRequestError(
          result.code ?? (result.status === 'conflict' ? 'conflict' : 'unavailable')
        )
      await load(identity.ownerId)
      return true
    } catch (failure) {
      if (current(identity)) setError(inferenceError(failure))
      return false
    } finally {
      if (current(identity) && busyOperation.current === identity.epoch) {
        busyOperation.current = null
        setBusy(false)
      }
    }
  }
  function savePlan(plan: unknown, bindings = view ? resourceBindings(view) : {}) {
    return save('/plan', { plan, bindings })
  }
  async function queryPending() {
    if (!active() || !pendingId.current || busyOperation.current !== null) return
    const identity = renderedIdentity
    busyOperation.current = identity.epoch
    setBusy(true)
    setError('')
    try {
      const receipt = await request<unknown>(
        `/mutation?mutationId=${encodeURIComponent(pendingId.current)}`
      )
      if (!current(identity)) return
      if (!receipt) {
        setError('尚未查到保存回执；结果仍未确认，请稍后再次查询。')
        return
      }
      forgetProvedReceipt(identity)
      await load(identity.ownerId)
    } catch (failure) {
      if (current(identity)) setError(inferenceError(failure))
    } finally {
      if (current(identity) && busyOperation.current === identity.epoch) {
        busyOperation.current = null
        setBusy(false)
      }
    }
  }
  async function action<T>(path: string, body: unknown): Promise<T | undefined> {
    if (!active() || busyOperation.current !== null || pendingId.current) return undefined
    const identity = renderedIdentity
    busyOperation.current = identity.epoch
    setBusy(true)
    setError('')
    try {
      const result = await request<T>(path, body)
      if (!current(identity)) return undefined
      await load(identity.ownerId)
      return result
    } catch (failure) {
      if (current(identity)) setError(inferenceError(failure))
      return undefined
    } finally {
      if (current(identity) && busyOperation.current === identity.epoch) {
        busyOperation.current = null
        setBusy(false)
      }
    }
  }
  function selectOwner(id: string) {
    if (!active() || busyOperation.current !== null || !owners.some((value) => value.id === id))
      return
    epoch.current++
    controller.current?.abort()
    owner.current = id
    setOwnerId(id)
    setView(null)
    setPending(null)
    pendingId.current = null
    void load(id)
  }
  return {
    owners,
    ownerId,
    setOwnerId: selectOwner,
    view,
    busy,
    error,
    setError: (message: string) => {
      if (active()) setError(message)
    },
    pending,
    revisionEpoch: renderedIdentity.epoch,
    load: () => load(),
    save,
    savePlan,
    queryPending,
    request,
    action,
    active,
  }
}
export type InferenceManagement = ReturnType<typeof useInferenceManagement>
