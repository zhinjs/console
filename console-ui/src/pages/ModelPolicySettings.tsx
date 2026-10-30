import { useEffect, useRef, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useI18n } from '../i18n'
import { apiFetch } from '../utils/auth'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { ModelPolicyScopeEditor } from './ModelPolicyScopeEditor'
import { modelPolicyFailure, policyAddressKey, readModelPolicyRefs, readModelPolicyView, type ModelPolicyRefs, type ModelPolicyView } from './model-policy-model.mjs'

export function ModelPolicySettings({ connectionScope }: { connectionScope: string }) {
  const i18n = useI18n()
  const [view, setView] = useState<ModelPolicyView | null>(null)
  const [draft, setDraft] = useState<ModelPolicyRefs>({})
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [blocked, setBlocked] = useState(false)
  const sceneOffset = useRef(0)
  const sequence = useRef(0), alive = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const current = (id: number) => alive.current && sequence.current === id && isInboxCacheScopeActive(connectionScope)
  async function load() {
    if (!isInboxCacheScopeActive(connectionScope)) return
    const id = ++sequence.current
    controller.current?.abort(); controller.current = new AbortController()
    setLoading(true); setError('')
    let failure = modelPolicyFailure()
    try {
      const response = await apiFetch('/api/agent/model-policy', { signal: controller.current.signal })
      const body = await response.json()
      if (!current(id)) return
      if (!response.ok || body.success !== true) { failure = modelPolicyFailure(response.status, body.code); throw new Error('read_failed') }
      const next = readModelPolicyView(body)
      setView(next); setDraft(next.refsOverride); setBlocked(false); sceneOffset.current = 0
    } catch { if (current(id)) { setBlocked(true); setError(failure) } }
    finally { if (current(id)) setLoading(false) }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; sequence.current++; controller.current?.abort() } }, [connectionScope])
  async function loadScenes() {
    if (!view || loading || saving || !isInboxCacheScopeActive(connectionScope)) return
    const id = ++sequence.current
    setLoading(true)
    try {
      const response = await apiFetch(`/api/agent/model-policy?targetsLimit=50&targetsOffset=${sceneOffset.current}`)
      const body = await response.json()
      if (!current(id)) return
      if (!response.ok || body.success !== true) { setError(modelPolicyFailure(response.status, body.code)); return }
      const next = readModelPolicyView(body)
      if (next.rootId !== view.rootId || !next.targets) throw new Error('invalid_response')
      setView(previous => previous ? { ...previous, targets: { ...next.targets!, scenes: [...new Map([
        ...(previous.targets?.scenes ?? []), ...next.targets!.scenes,
      ].map(row => [policyAddressKey(row.address), row])).values()] } } : previous)
      if (next.targets.scenesAvailable) sceneOffset.current += 50
    } catch { if (current(id)) setError(modelPolicyFailure()) }
    finally { if (current(id)) setLoading(false) }
  }
  async function save() {
    if (!view || blocked || loading || saving || !isInboxCacheScopeActive(connectionScope)) return
    let refsOverride: ModelPolicyRefs
    try { refsOverride = readModelPolicyRefs(draft) } catch { setError(modelPolicyFailure(400)); return }
    const id = ++sequence.current
    let failure = modelPolicyFailure(undefined, undefined, true), block = true
    setSaving(true); setError('')
    try {
      const response = await apiFetch('/api/agent/model-policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: view.revision, refsOverride }) })
      const body = await response.json()
      if (!current(id)) return
      if (!response.ok || body.success !== true) { failure = modelPolicyFailure(response.status, body.code, true); block = response.status !== 400; throw new Error('write_failed') }
      const next = readModelPolicyView(body)
      setView(next); setDraft(next.refsOverride)
    } catch {
      if (current(id)) { setBlocked(block); setError(failure) }
    } finally { if (current(id)) setSaving(false) }
  }
  return <Card className="p-4 space-y-4" aria-label={i18n.t('运行时模型策略')}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{i18n.t('运行时模型策略')}</h3>
      <Button size="sm" onClick={() => void save()} disabled={!view || loading || saving || blocked}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{i18n.t('保存模型策略')}</Button></div>
    <p className="text-sm text-muted-foreground">{i18n.t('下一轮生效；清空覆盖项可恢复继承。')}</p>
    {error ? <Alert variant="destructive"><AlertDescription>{i18n.t(error)}<Button variant="outline" size="sm" className="ml-2" onClick={() => void load()} disabled={loading || saving}>{i18n.t('重新读取')}</Button></AlertDescription></Alert> : null}
    {loading && !view ? <p role="status">{i18n.t('正在读取模型策略…')}</p> : null}
    {view ? <><details><summary className="cursor-pointer text-sm">{i18n.t('静态基线')}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(view.baseline, null, 2)}</pre></details>
      <fieldset disabled={loading || saving}><ModelPolicyScopeEditor view={view} draft={draft} onChange={value => { setDraft(value); if (!blocked) setError('') }} onLoadScenes={() => void loadScenes()} loading={loading} /></fieldset></> : null}
  </Card>
}
