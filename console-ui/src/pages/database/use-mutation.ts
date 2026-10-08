import { useCallback, useState } from 'react'
import { createMutationGate } from './mutation-model.mjs'

export function useMutation() {
  const [gate] = useState(createMutationGate)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (operation: () => Promise<void>) => {
    if (gate.pending) return
    setBusy(true)
    try { await gate.run(operation) } finally { setBusy(false) }
  }, [gate])
  return { busy, gate, run }
}
