import { useCallback, useEffect, useRef, useState } from 'react'
import { getWebSocketManager } from '@zhin.js/client'
import { createReadState, pendingRead, successfulRead, failedRead } from './console-read-state.mjs'

/** Track successful reads separately from empty values, retaining cached data on failure. */
export function useConsoleRead<T>(reader: () => Promise<T>, initial: T) {
  const manager = getWebSocketManager()
  const latestReader = useRef(reader)
  latestReader.current = reader
  const sequence = useRef(0)
  const [state, setState] = useState(() => createReadState(initial))
  const refresh = useCallback(async () => {
    const request = ++sequence.current
    setState(pendingRead)
    try {
      const value = await latestReader.current()
      if (request === sequence.current) setState(successfulRead(value))
      return value
    } catch (err) {
      if (request === sequence.current) setState(previous => failedRead(previous, err instanceof Error ? err.message : String(err)))
      throw err
    }
  }, [])
  useEffect(() => {
    setState(createReadState(initial))
    void refresh().catch(() => {})
    const off = manager.onConnectionChange(connected => { if (connected) void refresh().catch(() => {}) })
    return () => { sequence.current += 1; off() }
  }, [manager, refresh])
  return { ...state, refresh }
}
