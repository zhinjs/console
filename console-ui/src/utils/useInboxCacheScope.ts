import { useEffect, useState } from 'react'
import { getConsoleTransport } from './console-client'
import { getInboxCacheScope } from './inbox-cache'

/** Existing connection/auth authority controls visibility; credentials never enter React state. */
export function useInboxCacheScope(): string | undefined {
  const [scope, setScope] = useState(getInboxCacheScope)
  useEffect(() => {
    const refresh = () => setScope(getInboxCacheScope())
    const unsubscribe = getConsoleTransport().onConnectionChange(refresh)
    window.addEventListener('storage', refresh)
    window.addEventListener('zhin:auth-required', refresh)
    refresh()
    return () => { unsubscribe(); window.removeEventListener('storage', refresh); window.removeEventListener('zhin:auth-required', refresh) }
  }, [])
  return scope
}
