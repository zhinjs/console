import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { apiFetch } from '../utils/auth'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { ErrorAlert } from '../components/error-alert'

/** Read the selected message only; opening details never changes the session branch. */
export function SessionMessageDetails({ sessionKey, sessionId, messageId, connectionScope }: {
  sessionKey: string
  sessionId: string
  messageId: number
  connectionScope?: string
}) {
  const i18n = useI18n()
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !isInboxCacheScopeActive(connectionScope)) return
    const controller = new AbortController()
    let active = true
    setText(null)
    setError(null)
    const params = new URLSearchParams({ sessionId, messageId: String(messageId) })
    void apiFetch(`${CONSOLE_REST.AGENT_SESSIONS}/${encodeURIComponent(sessionKey)}/message?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 404 || response.status === 501) throw new Error(i18n.t('此消息已不可用，或 Host 尚不支持读取全文。'))
        const body = await response.json()
        if (!response.ok || !body.success) throw new Error(body.error ?? `HTTP ${response.status}`)
        if (body.data?.messageId !== messageId || typeof body.data?.text !== 'string') throw new Error(i18n.t('消息正文读取失败。'))
        if (active && isInboxCacheScopeActive(connectionScope)) setText(body.data.text)
      })
      .catch((err) => { if (active && isInboxCacheScopeActive(connectionScope)) setError((err as Error).message) })
    return () => { active = false; controller.abort() }
  }, [open, attempt, sessionKey, sessionId, messageId, connectionScope, i18n])

  if (!isInboxCacheScopeActive(connectionScope)) return null

  return (
    <details className="px-4 pb-4 text-sm" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-muted-foreground">{i18n.t('查看全文')}</summary>
      {open && <div className="mt-3">
        {error ? <ErrorAlert error={error} onRetry={() => setAttempt(value => value + 1)} />
          : text === null ? <p role="status" className="text-muted-foreground">{i18n.t('加载中…')}</p>
            : <p className="whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed">{text || i18n.t('（无文字内容）')}</p>}
      </div>}
    </details>
  )
}
