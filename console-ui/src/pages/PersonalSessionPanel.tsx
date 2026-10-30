import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { apiFetch } from '../utils/auth'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { ErrorAlert } from '../components/error-alert'
import { SelectField } from '../components/ui/select'
import { PersonalSessionModelPicker } from './PersonalSessionModelPicker'
import { addressBelongsToOwner, isPersonalSessionKey, personalModelFailure, personalSessionQuery, readPersonalModelsView, readPersonalSessionRows,
  type PersonalModelsView, type PersonalSessionRow } from './personal-models-model.mjs'

/** A personal hash never grants access to the legacy all-conversation history APIs. */
export function PersonalSessionPanel({ sessionKey, connectionScope, preferredOwnerId }: {
  sessionKey: string; connectionScope?: string; preferredOwnerId?: string | null
}) {
  const i18n = useI18n()
  const [models, setModels] = useState<PersonalModelsView | null>(null)
  const [ownerId, setOwnerId] = useState('')
  const [row, setRow] = useState<PersonalSessionRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  useEffect(() => {
    if (!isPersonalSessionKey(sessionKey) || !isInboxCacheScopeActive(connectionScope)) return
    const abort = new AbortController()
    let active = true
    setLoading(true); setError('')
    void (async () => {
      try {
        const response = await apiFetch('/api/agent/personal-models', { signal: abort.signal, cache: 'no-store' })
        const body = await response.json()
        if (!active || !isInboxCacheScopeActive(connectionScope)) return
        if (!response.ok || body.success !== true) { setError(personalModelFailure(response.status, body.code)); return }
        const result = readPersonalModelsView(body)
        setModels(result)
        setOwnerId(result.owners.some(owner => owner.ownerId === preferredOwnerId) ? preferredOwnerId!
          : result.owners.length === 1 ? result.owners[0].ownerId : '')
      } catch { if (active && !abort.signal.aborted && isInboxCacheScopeActive(connectionScope)) setError('个人会话目录读取失败。') }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false; abort.abort() }
  }, [sessionKey, connectionScope, preferredOwnerId])
  const owner = models?.owners.find(owner => owner.ownerId === ownerId)
  useEffect(() => {
    if (!owner || !isPersonalSessionKey(sessionKey) || !isInboxCacheScopeActive(connectionScope)) return
    const current = ++sequence.current
    const abort = new AbortController()
    setRow(null); setLoading(true); setError('')
    void (async () => {
      try {
        let offset = 0
        for (;;) {
          const response = await apiFetch(personalSessionQuery(owner.owner, offset), { signal: abort.signal, cache: 'no-store' })
          const body = await response.json()
          if (abort.signal.aborted || current !== sequence.current || !isInboxCacheScopeActive(connectionScope)) return
          if (!response.ok || body.success !== true) { setError(personalModelFailure(response.status, body.code)); return }
          const page = readPersonalSessionRows(body, owner.owner)
          const match = page.rows.find(row => row.sessionKey === sessionKey)
          if (match) { setRow(match); return }
          if (!page.hasMore) { setError('在此个人身份下未找到该会话。'); return }
          if (page.rows.length === 0) throw new Error('invalid_response')
          offset += page.rows.length
        }
      } catch { if (!abort.signal.aborted && current === sequence.current && isInboxCacheScopeActive(connectionScope)) setError('个人会话目录读取失败。') }
      finally { if (current === sequence.current && !abort.signal.aborted) setLoading(false) }
    })()
    return () => { sequence.current += 1; abort.abort() }
  }, [owner, sessionKey, connectionScope])
  const resolvedRow = row && row.sessionKey === sessionKey && owner && addressBelongsToOwner(row.address, owner.owner) ? row : null
  return <div className="space-y-5 rounded-md border p-5">
    {models && models.owners.length > 1 ? <label className="block max-w-lg space-y-2 text-sm font-medium"><span>{i18n.t('个人身份')}</span>
      <SelectField value={ownerId} onValueChange={setOwnerId} options={[{ value: '', label: i18n.t('请选择个人身份') }, ...models.owners.map(owner => ({ value: owner.ownerId, label: `${owner.owner.platform} · ${owner.owner.endpoint} · ${owner.owner.subjectId}` }))]} />
    </label> : null}
    {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" />{i18n.t('正在加载…')}</p> : null}
    {error ? <ErrorAlert error={i18n.t(error)} /> : null}
    {resolvedRow && owner ? <PersonalSessionModelPicker key={resolvedRow.sessionKey} sessionKey={resolvedRow.sessionKey} address={resolvedRow.address} ownerModels={owner} connectionScope={connectionScope} /> : null}
  </div>
}
