import { useCallback, useEffect, useRef, useState } from 'react'
import { requestConsole } from '../utils/console-rpc'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../utils/inbox-cache'
import { createDiagnosticRequestGate } from './endpoint-detail/message-diagnostics.mjs'
import { readWelcomeEvidence, welcomeEvidenceKey, welcomeReady, welcomeTargetKey, type WelcomeEvidence } from './welcome-use-case-model.mjs'

/** A scoped view of existing Host evidence. No install/configuration/verification execution authority. */
export function useWelcomeInspection(instanceKey: string, packageName: string, target: unknown) {
  const scope = useInboxCacheScope(), targetKey = welcomeTargetKey(target)
  const binding = JSON.stringify([scope, instanceKey, packageName])
  const current = useRef({ binding, targetKey, epoch: 0 })
  if (current.current.binding !== binding || current.current.targetKey !== targetKey) current.current = { binding, targetKey, epoch: current.current.epoch + 1 }
  const reads = useRef(createDiagnosticRequestGate(getInboxCacheScope))
  const [entry, setEntry] = useState<{ binding: string; evidence?: WelcomeEvidence; loading?: boolean; error?: string } | null>(null)
  const [record, setRecord] = useState<{ binding: string; evidenceKey: string; targetKey: string; epoch: number; at: number } | null>(null)
  const refresh = useCallback(async () => {
    if (!instanceKey || !packageName || !isInboxCacheScopeActive(scope) || current.current.binding !== binding) return undefined
    const read = reads.current.begin()
    setEntry(previous => ({ binding, evidence: previous?.binding === binding ? previous.evidence : undefined, loading: true }))
    try {
      const [state, plan, source] = await Promise.all([
        requestConsole({ type: 'plugin:inspect', instanceKey }),
        requestConsole({ type: 'plugin:plan-verification', instanceKey }),
        requestConsole({ type: 'config:get-source' }),
      ])
      if (!read.current() || current.current.binding !== binding || !isInboxCacheScopeActive(scope)) return undefined
      const evidence = readWelcomeEvidence(state, plan, instanceKey, packageName, source)
      setEntry({ binding, evidence })
      setRecord(previous => previous?.binding === binding && previous.epoch === current.current.epoch && previous.evidenceKey === welcomeEvidenceKey(evidence) && welcomeReady(evidence) ? previous : null)
      return evidence
    } catch (cause) {
      if (read.current() && current.current.binding === binding && isInboxCacheScopeActive(scope)) {
        setEntry({ binding, error: cause instanceof Error ? cause.message : '无法读取当前应用证据' }); setRecord(null)
      }
      return undefined
    }
  }, [scope, binding, instanceKey, packageName])
  useEffect(() => {
    reads.current.cancel(); setEntry(null); setRecord(null)
    void refresh()
    const timer = setInterval(() => void refresh(), 10_000)
    return () => { clearInterval(timer); reads.current.cancel() }
  }, [refresh])
  useEffect(() => { setRecord(null) }, [targetKey])
  const visible = isInboxCacheScopeActive(scope) && entry?.binding === binding ? entry : null
  const evidence = visible && !visible.loading ? visible.evidence : undefined
  const confirmObserved = useCallback(async () => {
    const baseline = welcomeEvidenceKey(evidence), selected = current.current.targetKey
    const epoch = current.current.epoch
    if (!selected || !baseline || !welcomeReady(evidence, target) || !isInboxCacheScopeActive(scope) || current.current.binding !== binding) return false
    const checked = await refresh()
    if (!checked || !welcomeReady(checked) || welcomeEvidenceKey(checked) !== baseline
      || current.current.binding !== binding || current.current.targetKey !== selected || current.current.epoch !== epoch || !isInboxCacheScopeActive(scope)) return false
    setRecord({ binding, evidenceKey: baseline, targetKey: selected, epoch, at: Date.now() })
    return true
  }, [evidence, scope, binding, refresh, target])
  const manualRecord = evidence && welcomeReady(evidence) && record?.binding === binding
    && record.epoch === current.current.epoch && record.evidenceKey === welcomeEvidenceKey(evidence) && record.targetKey === targetKey ? record : null
  return { evidence, loading: visible?.loading ?? false, error: visible?.error, manualRecord, refresh, confirmObserved }
}
