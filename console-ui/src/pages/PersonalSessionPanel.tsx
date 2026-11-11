import { useI18n } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { SelectField } from '../components/ui/select'
import { ErrorAlert } from '../components/error-alert'
import { useInferenceManagement, type InferenceManagement } from './inference/useInferenceManagement'
import { inferenceError } from './inference/model.mjs'
import { PersonalSessionModelPicker } from './PersonalSessionModelPicker'
import {
  isPersonalSessionKey,
  readPersonalSessionRows,
  type PersonalSessionRow,
} from './personal-session-model.mjs'

interface PersonalSessionPanelProps {
  sessionKey: string
  connectionScope?: string
  preferredOwnerId?: string | null
}

/** A personal hash never grants access to the all-conversation history API. */
export function PersonalSessionPanel(props: PersonalSessionPanelProps) {
  return (
    <PersonalSessionScope
      key={JSON.stringify([props.connectionScope, props.preferredOwnerId])}
      {...props}
    />
  )
}

function PersonalSessionScope({ sessionKey, connectionScope, preferredOwnerId }: PersonalSessionPanelProps) {
  const i18n = useI18n()
  const m = useInferenceManagement(connectionScope, preferredOwnerId)
  const owner = m.owners.find((value) => value.id === m.ownerId)?.personal
  return (
    <div className="space-y-4 rounded-md border p-5">
      {m.owners.length > 1 ? (
        <SelectField
          aria-label={i18n.t("个人身份")}
          value={m.ownerId}
          onValueChange={m.setOwnerId}
          options={m.owners.map((value) => ({ value: value.id, label: value.label }))}
        />
      ) : null}
      {m.error ? <ErrorAlert error={m.error} /> : null}
      {!owner && !m.busy ? (
        <p className="text-sm text-muted-foreground">{i18n.t("请使用关联此会话的个人身份登录。")}</p>
      ) : null}
      {owner && isPersonalSessionKey(sessionKey) ? (
        <PersonalSessionReader
          key={JSON.stringify([
            m.ownerId, owner.rootId, owner.platform, owner.endpoint,
            owner.adapterId, owner.subjectId, sessionKey,
          ])}
          management={m}
          owner={owner}
          sessionKey={sessionKey}
          connectionScope={connectionScope}
        />
      ) : null}
    </div>
  )
}

/** The row, lookup error and model picker belong to one resolved personal identity. */
function PersonalSessionReader({ management: m, owner, sessionKey, connectionScope }: {
  management: InferenceManagement
  owner: NonNullable<InferenceManagement['owners'][number]['personal']>
  sessionKey: string
  connectionScope?: string
}) {
  const i18n = useI18n()
  const [row, setRow] = useState<PersonalSessionRow | null>(null),
    [error, setError] = useState(''),
    sequence = useRef(0)
  useEffect(() => {
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
            setError(i18n.t("在此个人身份下未找到该会话。"))
            return
          }
          if (!page.rows.length) throw new Error('invalid_response')
          offset += page.rows.length
        }
      } catch (failure) {
        if (!stopped && id === sequence.current && m.active()) setError(inferenceError(failure, i18n.locale))
      }
    })()
    return () => {
      stopped = true
      sequence.current++
    }
  }, [m.revisionEpoch])
  return (
    <>
      {error ? <ErrorAlert error={error} /> : null}
      {row && m.view ? (
        <PersonalSessionModelPicker
          sessionKey={row.sessionKey}
          address={row.address}
          models={m.view}
          ownerId={m.ownerId}
          connectionScope={connectionScope}
        />
      ) : null}
    </>
  )
}
