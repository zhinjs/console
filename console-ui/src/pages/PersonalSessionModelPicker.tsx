import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useI18n } from '../i18n'
import { apiFetch } from '../utils/auth'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { Button } from '../components/ui/button'
import { SelectField } from '../components/ui/select'
import { ErrorAlert } from '../components/error-alert'
import { Alert, AlertDescription } from '../components/ui/alert'
import { isDemoMode } from '../utils/demo-mode'
import {
  isPersonalSessionKey, personalSessionAddressQuery, readPersonalSessionView, personalModelFailure,
  type PersonalAddress, type PersonalOwnerModels, type PersonalSessionView,
} from './personal-models-model.mjs'

/** Only a server-resolved complete personal address can choose a preset. */
export function PersonalSessionModelPicker({ sessionKey, address, ownerModels, connectionScope }: {
  sessionKey: string; address: PersonalAddress; ownerModels: PersonalOwnerModels; connectionScope?: string
}) {
  const i18n = useI18n()
  const [view, setView] = useState<PersonalSessionView | null>(null)
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; controller.current?.abort() } }, [])
  const active = () => mounted.current && isInboxCacheScopeActive(connectionScope)
  const load = useCallback(async () => {
    if (!isPersonalSessionKey(sessionKey) || !isInboxCacheScopeActive(connectionScope)) return
    controller.current?.abort()
    const abort = new AbortController(); controller.current = abort
    const current = ++sequence.current
    setLoading(true); setError(''); setSaved(false)
    try {
      const response = await apiFetch(personalSessionAddressQuery(address), { cache: 'no-store', signal: abort.signal })
      const body = await response.json()
      if (!response.ok || body.success !== true) throw new Error(personalModelFailure(response.status, body.code))
      const result = readPersonalSessionView(body, sessionKey, address)
      if (mounted.current && current === sequence.current && isInboxCacheScopeActive(connectionScope)) {
        setView(result); setSelected(result.state.selection.kind === 'inherit' ? '' : result.state.selection.presetId)
      }
    } catch (failure) {
      if (!abort.signal.aborted && mounted.current && current === sequence.current && isInboxCacheScopeActive(connectionScope)) {
        setView(null); setError(failure instanceof Error && failure.message !== 'invalid_response' ? failure.message : '会话身份无法确认，未切换模型。')
      }
    } finally { if (mounted.current && current === sequence.current) setLoading(false) }
  }, [address, sessionKey, connectionScope])
  useEffect(() => { void load() }, [load])
  const original = view?.state.selection.kind === 'preset' ? view.state.selection.presetId : ''
  const choices = [{ value: '', label: i18n.t('继承会话模型设置') },
    ...(view?.presets.personal ?? []).map(preset => ({ value: preset.id, label: ownerModels.models.find(model => model.id === preset.modelId)?.model ?? preset.id })),
    ...(view?.presets.deployment ?? []).map(preset => ({ value: preset.id, label: `${preset.model} · ${i18n.t('部署模型')}` }))]
  if (selected && !choices.some(choice => choice.value === selected)) choices.push({ value: selected, label: i18n.t('当前预设不可用') })
  const save = async () => {
    if (!view || view.state.identity.key !== sessionKey || saving || !active() || isDemoMode()) return
    const current = ++sequence.current
    setSaving(true); setError(''); setSaved(false)
    try {
      const response = await apiFetch('/api/agent/personal-session', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, expectedRevision: view.state.revision, selection: selected ? { kind: 'preset', presetId: selected } : { kind: 'inherit' } }) })
      const body = await response.json()
      if (!response.ok || body.success !== true) throw new Error(response.status >= 500 ? '提交结果尚未确认，请刷新查看后再操作。' : personalModelFailure(response.status, body.code))
      const result = readPersonalSessionView({ success: true, data: { state: body.data, presets: view.presets } }, sessionKey, address)
      if (active() && current === sequence.current) { setView(result); setSaved(true) }
    } catch (failure) {
      if (active() && current === sequence.current) setError(failure instanceof Error && failure.message !== 'invalid_response' && failure.name !== 'TypeError' ? failure.message : '提交结果尚未确认，请刷新查看后再操作。')
    } finally { if (mounted.current && current === sequence.current) setSaving(false) }
  }
  if (!isPersonalSessionKey(sessionKey)) return null
  return <section className="space-y-4" aria-label={i18n.t('此会话的模型')}>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 space-y-2 text-sm font-medium">
        <span>{i18n.t('此会话的模型')}</span>
        <SelectField value={selected} onValueChange={value => { setSelected(value); setSaved(false) }} options={choices}
          aria-label={i18n.t('此会话的模型')} disabled={!view || loading || saving || isDemoMode()} />
      </label>
      <Button onClick={() => void save()} disabled={!view || loading || saving || selected === original || isDemoMode()}>
        {saving ? <Loader2 className="animate-spin" /> : null}{i18n.t('保存模型选择')}
      </Button>
      <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading || saving} aria-label={i18n.t('刷新')}>
        <RefreshCw className={loading ? 'animate-spin' : ''} />
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">{address.platform} · {address.endpoint} · {address.conversation.id} · {address.subjectId}</p>
    {error ? <ErrorAlert error={i18n.t(error)} /> : null}
    {saved ? <Alert variant="success"><AlertDescription>{i18n.t('模型选择已保存。')}</AlertDescription></Alert> : null}
  </section>
}
