import { useSyncExternalStore } from 'react'
import { getConsoleAccess, subscribeConsoleAccess, type ConsoleAccess } from '../utils/console-access.mjs'

export function useConsoleAccess(): ConsoleAccess {
  return useSyncExternalStore(subscribeConsoleAccess, getConsoleAccess, getConsoleAccess)
}
