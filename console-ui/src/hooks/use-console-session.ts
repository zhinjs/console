import { useSyncExternalStore } from 'react'
import { getConsoleSession, subscribeConsoleSession, type ConsoleSessionState } from '../utils/console-session.mjs'

export function useConsoleSession(): ConsoleSessionState {
  return useSyncExternalStore(subscribeConsoleSession, getConsoleSession, getConsoleSession)
}
