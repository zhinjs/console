import { useSyncExternalStore } from 'react'
import { useConsoleClient } from '@zhin.js/client'

/**
 * Live connection state of the current transport.
 *
 * `useConsoleTransport().connected` reads the state while rendering and subscribes in an effect.
 * The shell mounts inside a transition, so a fast Host can connect between the two and the change
 * is never reported; reading through the external-store hook closes that gap.
 */
export function useConsoleConnected(): boolean {
  const { transport } = useConsoleClient()
  return useSyncExternalStore(
    (notify) => transport.onConnectionChange(notify),
    () => transport.isConnected(),
  )
}
