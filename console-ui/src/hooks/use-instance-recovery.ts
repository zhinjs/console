import { useEffect, useRef } from 'react'
import { onInstanceRecovered } from '../utils/instance-availability.mjs'

/**
 * Re-run a read when the Zhin instance answers again (the shell banner clears). Sections that showed
 * 实例不可用 then refresh by themselves instead of staying stale until a manual retry.
 */
export function useInstanceRecovery(reload: () => void) {
  const latest = useRef(reload)
  latest.current = reload
  useEffect(() => onInstanceRecovered(() => latest.current()), [])
}
