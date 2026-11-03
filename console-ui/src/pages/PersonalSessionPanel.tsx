import { useEffect, useRef, useState } from 'react'
import { SelectField } from '../components/ui/select'
import { ErrorAlert } from '../components/error-alert'
import { useInferenceManagement } from './inference/useInferenceManagement'
import { inferenceError } from './inference/model.mjs'
import { PersonalSessionModelPicker } from './PersonalSessionModelPicker'
import {
  isPersonalSessionKey,
  readPersonalSessionRows,
  type PersonalSessionRow,
} from './personal-session-model.mjs'

/** A personal hash never grants access to the all-conversation history API. */
export function PersonalSessionPanel({
  sessionKey,
  connectionScope,
  preferredOwnerId,
}: {
  sessionKey: string
  connectionScope?: string
  preferredOwnerId?: string | null
}) {
  const m = useInferenceManagement(connectionScope, preferredOwnerId),
    [row, setRow] = useState<PersonalSessionRow | null>(null),
    [error, setError] = useState(''),
    sequence = useRef(0)
  const owner = m.owners.find((value) => value.id === m.ownerId)?.personal
  useEffect(() => {
    if (!owner || !isPersonalSessionKey(sessionKey)) return
    let stopped = false
    const id = ++sequence.current
    setRow(null)
    setError('')
    void (async () => {
      try {
        let offset = 0
        for (;;) {
          const result = await m.request(`/sessions?limit=50&offset=${offset}`)
          if (stopped || id !== sequence.current || !m.active()) return
          const page = readPersonalSessionRows({ success: true, data: result }, owner),
            match = page.rows.find((value) => value.sessionKey === sessionKey)
          if (match) {
            setRow(match)
            return
          }
          if (!page.hasMore) {
            setError('在此个人身份下未找到该会话。')
            return
          }
          if (!page.rows.length) throw new Error('invalid_response')
          offset += page.rows.length
        }
      } catch (failure) {
        if (!stopped && id === sequence.current && m.active()) setError(inferenceError(failure))
      }
    })()
    return () => {
      stopped = true
      sequence.current++
    }
  }, [owner, sessionKey, connectionScope])
  return (
    <div className="space-y-4 rounded-md border p-5">
      {m.owners.length > 1 ? (
        <SelectField
          aria-label="个人身份"
          value={m.ownerId}
          onValueChange={m.setOwnerId}
          options={m.owners.map((value) => ({ value: value.id, label: value.label }))}
        />
      ) : null}
      {m.error || error ? <ErrorAlert error={m.error || error} /> : null}
      {!owner && !m.busy ? (
        <p className="text-sm text-muted-foreground">请使用关联此会话的个人身份登录。</p>
      ) : null}
      {row && m.view ? (
        <PersonalSessionModelPicker
          key={`${m.ownerId}:${row.sessionKey}`}
          sessionKey={row.sessionKey}
          address={row.address}
          models={m.view}
          ownerId={m.ownerId}
          connectionScope={connectionScope}
        />
      ) : null}
    </div>
  )
}
