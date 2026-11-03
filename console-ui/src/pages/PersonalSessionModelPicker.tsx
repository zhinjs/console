import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { Button } from '../components/ui/button'
import { SelectField } from '../components/ui/select'
import { ErrorAlert } from '../components/error-alert'
import {
  inferenceRequest,
  inferenceError,
  selectableLanguageProfiles,
  type View,
} from './inference/model.mjs'
import {
  readPersonalSessionState,
  type PersonalAddress,
  type PersonalSessionState,
} from './personal-session-model.mjs'

/** The complete server-resolved address and account-bound selection are checked again on every save. */
export function PersonalSessionModelPicker({
  sessionKey,
  address,
  models,
  ownerId,
  connectionScope,
}: {
  sessionKey: string
  address: PersonalAddress
  models: View
  ownerId: string
  connectionScope?: string
}) {
  const [state, setState] = useState<PersonalSessionState | null>(null),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false)
  const alive = useRef(true),
    sequence = useRef(0),
    abort = useRef<AbortController | null>(null)
  const active = () => alive.current && isInboxCacheScopeActive(connectionScope)
  async function load() {
    if (!active()) return
    const id = ++sequence.current
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setBusy(true)
    setError('')
    try {
      const value = await inferenceRequest(apiFetch, {
        path: `/session?address=${encodeURIComponent(JSON.stringify(address))}`,
        ownerId,
        signal: controller.signal,
      })
      const next = readPersonalSessionState(value, sessionKey, address)
      if (active() && id === sequence.current) {
        setState(next)
        setSelected(next.selection.kind === 'profile' ? next.selection.profile.id : '')
      }
    } catch (failure) {
      if (active() && id === sequence.current && !controller.signal.aborted) {
        setState(null)
        setError(inferenceError(failure))
      }
    } finally {
      if (active() && id === sequence.current) setBusy(false)
    }
  }
  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
      sequence.current++
      abort.current?.abort()
    }
  }, [sessionKey, address, ownerId, connectionScope])
  const choices = selectableLanguageProfiles(models),
    original = state?.selection.kind === 'profile' ? state.selection.profile.id : ''
  async function save() {
    if (!state || !active() || busy) return
    const chosen = choices.find((value) => value.id === selected)
    if (selected && !chosen) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const result = await inferenceRequest(apiFetch, {
        path: '/session',
        ownerId,
        method: 'PUT',
        body: {
          address,
          expectedRevision: state.revision,
          selection: chosen ? { kind: 'profile', profile: chosen.selection } : { kind: 'inherit' },
        },
      })
      const next = readPersonalSessionState(result, sessionKey, address)
      if (active()) {
        setState(next)
        setSaved(true)
      }
    } catch (failure) {
      if (active()) setError(inferenceError(failure))
    } finally {
      if (active()) setBusy(false)
    }
  }
  const options = [
    { value: '', label: '继承会话模型设置' },
    ...choices.map((value) => ({ value: value.id, label: value.label })),
  ]
  if (selected && !options.some((value) => value.value === selected))
    options.push({ value: selected, label: '当前模型不可用' })
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 space-y-2 text-sm">
          <span>此会话的模型</span>
          <SelectField
            value={selected}
            onValueChange={(value) => {
              setSelected(value)
              setSaved(false)
            }}
            options={options}
            disabled={!state || busy}
          />
        </label>
        <Button onClick={() => void save()} disabled={!state || busy || selected === original}>
          保存
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="重新读取会话模型"
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshCw />
        </Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {saved ? (
        <p role="status" className="text-sm">
          已保存，下一回合生效。
        </p>
      ) : null}
    </section>
  )
}
