import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { apiFetch } from '../utils/auth'
import { usePersonalModels } from '../hooks/use-personal-models'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { ErrorAlert } from '../components/error-alert'
import { SelectField } from '../components/ui/select'
import { PersonalSessionModelPicker } from './PersonalSessionModelPicker'
import { addressBelongsToOwner, isPersonalSessionKey, personalModelFailure, personalSessionQuery, readPersonalSessionRows,
  type PersonalSessionRow } from './personal-models-model.mjs'

/** A personal hash never grants access to the legacy all-conversation history APIs. */
export function PersonalSessionPanel({ sessionKey, connectionScope, preferredOwnerId }: {
  sessionKey: string; connectionScope?: string; preferredOwnerId?: string | null
}) {
  const i18n = useI18n()
  const [ownerId, setOwnerId] = useState('')
  const [row, setRow] = useState<PersonalSessionRow | null>(null)
  const [rowLoading, setRowLoading] = useState(false)
  const [rowError, setRowError] = useState('')
  const sequence = useRef(0)
  const personal = isPersonalSessionKey(sessionKey) && isInboxCacheScopeActive(connectionScope)
  const { view: models, loading: modelsLoading, error: modelsError } = usePersonalModels(personal ? connectionScope : undefined)
  useEffect(() => {
    if (!models) return
    setOwnerId(models.owners.some(owner => owner.ownerId === preferredOwnerId) ? preferredOwnerId!
      : models.owners.length === 1 ? models.owners[0].ownerId : '')
  }, [models, preferredOwnerId])
  const owner = models?.owners.find(owner => owner.ownerId === ownerId)
  useEffect(() => {
    if (!owner || !isPersonalSessionKey(sessionKey) || !isInboxCacheScopeActive(connectionScope)) return
    const current = ++sequence.current
    const abort = new AbortController()
    setRow(null); setRowLoading(true); setRowError('')
    void (async () => {
      try {
        let offset = 0
        for (;;) {
          const response = await apiFetch(personalSessionQuery(owner.owner, offset), { signal: abort.signal, cache: 'no-store' })
          const body = await response.json()
          if (abort.signal.aborted || current !== sequence.current || !isInboxCacheScopeActive(connectionScope)) return
          if (!response.ok || body.success !== true) { setRowError(personalModelFailure(response.status, body.code)); return }
          const page = readPersonalSessionRows(body, owner.owner)
          const match = page.rows.find(row => row.sessionKey === sessionKey)
          if (match) { setRow(match); return }
          if (!page.hasMore) { setRowError('在此个人身份下未找到该会话。'); return }
          if (page.rows.length === 0) throw new Error('invalid_response')
          offset += page.rows.length
        }
      } catch { if (!abort.signal.aborted && current === sequence.current && isInboxCacheScopeActive(connectionScope)) setRowError('个人会话目录读取失败。') }
      finally { if (current === sequence.current && !abort.signal.aborted) setRowLoading(false) }
    })()
    return () => { sequence.current += 1; abort.abort() }
  }, [owner, sessionKey, connectionScope])
  const error = modelsError || rowError
  const loading = rowLoading || modelsLoading
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
