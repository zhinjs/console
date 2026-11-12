import { useCallback, useEffect, useRef, useState } from 'react'
import { useInstanceRecovery } from '../../hooks/use-instance-recovery'
import { ExternalLink, KeyRound, QrCode } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { ActionReceipt, useActionReceipt } from '../../components/ActionReceipt'
import { receiptBlocksActions } from '../../components/action-receipt-model.mjs'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { startVisiblePolling } from '../../hooks/visible-polling.mjs'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { readEndpointList } from '../endpoint-list-model.mjs'

export interface ScopeEndpoint {
  name: string
  adapter: string
  connected: boolean
  status: 'online' | 'offline'
  pendingLogin?: boolean
  transportState?: string
  pendingRequestCount?: number
  pendingNoticeCount?: number
}

export interface LoginTask {
  id: string
  adapter: string
  endpointKey: string
  endpointIdentity?: { incarnationId: string; canonicalId: string; instanceId: string; epoch: number }
  type: string
  payload?: { image?: string; url?: string; message?: string; phone?: string; [key: string]: unknown }
  message?: string
  createdAt?: number
  expiresAt?: number
}

export interface EndpointsAndLogin {
  endpoints: ScopeEndpoint[]
  tasks: LoginTask[]
  loaded: boolean
  loading: boolean
  error: unknown
  refresh: () => void
}

/**
 * `endpoint.list` plus LoginAssist's `login.list` (only for identities that may operate accounts),
 * re-read every 8 s while the page is visible.
 */
export function useEndpointsAndLogin(): EndpointsAndLogin {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const canOperate = hasConsolePermission('endpoint.operate', access)
  const [state, setState] = useState<Omit<EndpointsAndLogin, 'refresh'>>({ endpoints: [], tasks: [], loaded: false, loading: true, error: null })
  const sequence = useRef(0)
  const load = useCallback(() => {
    const ticket = ++sequence.current
    setState(previous => ({ ...previous, loading: true }))
    Promise.all([
      requestConsole<unknown>({ type: ENDPOINT_RPC.LIST }),
      canOperate ? requestConsole<{ tasks?: LoginTask[] }>({ type: 'login.list' }).catch(() => ({ tasks: [] as LoginTask[] })) : Promise.resolve({ tasks: [] as LoginTask[] }),
    ]).then(([list, login]) => {
      if (ticket !== sequence.current) return
      setState({ endpoints: readEndpointList(list, i18n.locale) as ScopeEndpoint[], tasks: Array.isArray(login?.tasks) ? login.tasks : [], loaded: true, loading: false, error: null })
    }, (error: unknown) => {
      if (ticket !== sequence.current) return
      setState(previous => ({ ...previous, loading: false, error }))
    })
  }, [canOperate, i18n.locale])
  useEffect(() => {
    load()
    const stop = startVisiblePolling(load, 8000)
    return () => { stop(); sequence.current += 1 }
  }, [load])
  useInstanceRecovery(load)
  return { ...state, refresh: load }
}

/**
 * Smart extraction of a slider ticket or code: accepts the JSON response from the browser's Network
 * panel (`ticket` field) or a callback URL with `ticket=` / `cap_cd=`.
 */
export function extractVerificationValue(raw: string): { value: string; extractedFrom?: 'json' | 'url' } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: '' }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const data = parsed.data as Record<string, unknown> | undefined
      const ticket = typeof parsed.ticket === 'string' ? parsed.ticket : typeof data?.ticket === 'string' ? data.ticket : undefined
      if (ticket?.trim()) return { value: ticket.trim(), extractedFrom: 'json' }
    } catch {
      // not JSON: fall through
    }
  }
  if (/^https?:\/\//i.test(trimmed) || /[?&](?:ticket|cap_cd)=/i.test(trimmed)) {
    try {
      const url = trimmed.startsWith('http') ? new URL(trimmed) : new URL(trimmed, 'http://localhost')
      const ticket = url.searchParams.get('ticket') ?? url.searchParams.get('cap_cd')
      if (ticket?.trim()) return { value: ticket.trim(), extractedFrom: 'url' }
    } catch {
      const match = trimmed.match(/[?&](?:ticket|cap_cd)=([^&#\s]+)/i)
      if (match?.[1]) {
        try { return { value: decodeURIComponent(match[1]), extractedFrom: 'url' } } catch { return { value: match[1], extractedFrom: 'url' } }
      }
    }
  }
  return { value: trimmed }
}

const isImageSource = (value: string) => /^data:image\//i.test(value) || /^https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s]*)?$/i.test(value)
const isSafeHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim())
const needsInput = (type: string) => type === 'slider' || type === 'sms' || type === 'device' || type === 'other'

export function useLoginTaskTypeLabel() {
  const i18n = useI18n()
  return (type: string): string => {
    switch (type) {
      case 'qrcode': return i18n.t('二维码扫码')
      case 'slider': return i18n.t('滑块验证')
      case 'sms': return i18n.t('短信验证码')
      case 'device': return i18n.t('设备锁确认')
      case 'auth': return i18n.t('登录确认')
      default: return i18n.t('安全验证')
    }
  }
}

/**
 * One open login task of an account (二维码 / 滑块 / 短信 / 设备锁): its prompt, and submitting or
 * cancelling it through an ActionReceipt. An unknown outcome is checked by re-reading `login.list`.
 */
interface PendingLoginAction { readonly kind: 'submit' | 'cancel'; readonly value: string }

export function LoginTaskCard({ task, onSettled, readOnly }: { task: LoginTask; onSettled: () => void; readOnly: boolean }) {
  const i18n = useI18n()
  const typeLabel = useLoginTaskTypeLabel()
  const [input, setInput] = useState('')
  // What is sent rides on the plan; the receipt outlives the tab (action-receipt-store), so an
  // unknown submission stays 结果未知 after switching tabs and back.
  const receipt = useActionReceipt({
    persistKey: `login:${task.id}`,
    submit: async plan => {
      const { kind, value } = (plan.payload ?? {}) as Partial<PendingLoginAction>
      if (kind !== 'submit' && kind !== 'cancel') throw new Error('No action')
      const identity = task.endpointIdentity ? { endpointIdentity: task.endpointIdentity } : {}
      if (kind === 'cancel') await requestConsole({ type: 'login.cancel', taskId: task.id, reason: 'console_cancelled', ...identity })
      else await requestConsole({ type: 'login.submit', taskId: task.id, value, ...identity })
      return { status: 'saved', message: kind === 'cancel' ? i18n.t('已取消这次登录验证。') : i18n.t('已提交，请稍候查看连接状态。') }
    },
    // The task disappears from login.list once the Host accepted the answer (or the cancellation).
    verify: async () => {
      const reply = await requestConsole<{ tasks?: LoginTask[] }>({ type: 'login.list' })
      return { applied: !(reply?.tasks ?? []).some(item => item.id === task.id) }
    },
    onSettled: () => { setInput(''); onSettled() },
  })
  const image = typeof task.payload?.image === 'string' ? task.payload.image : undefined
  const rawUrl = typeof task.payload?.url === 'string' ? task.payload.url.trim() : undefined
  const url = rawUrl && isSafeHttpUrl(rawUrl) ? rawUrl : undefined
  const prompt = typeof task.payload?.message === 'string' ? task.payload.message : typeof task.message === 'string' ? task.message : undefined
  const phone = typeof task.payload?.phone === 'string' ? task.payload.phone : undefined
  const asksInput = needsInput(task.type)
  const extracted = asksInput ? extractVerificationValue(input) : { value: 'ok' }
  // A settled submission keeps the card busy too: the task is answered (it leaves login.list).
  const busy = receiptBlocksActions(receipt.state) || receipt.state.phase === 'succeeded' || receipt.state.phase === 'partial'
  const prepare = (kind: 'submit' | 'cancel') => {
    const value = asksInput ? extracted.value : 'ok'
    const payload: PendingLoginAction = { kind, value }
    receipt.prepare(kind === 'cancel'
      ? { title: i18n.t('取消 {0} 的登录验证', [task.endpointKey]), danger: false, confirmLabel: i18n.t('取消验证'), payload }
      : { title: i18n.t('提交 {0} 的{1}', [task.endpointKey, typeLabel(task.type)]), ...(asksInput ? { changes: [i18n.t('验证值：{0}', [value.length > 28 ? `${value.slice(0, 28)}…` : value])] } : {}), confirmLabel: i18n.t('提交验证'), payload })
  }
  return (
    <div className="console-login-card">
      <div className="console-login-card-head">
        <QrCode aria-hidden="true" />
        <span className="font-medium">{typeLabel(task.type)}</span>
        {task.expiresAt ? <span className="text-xs text-muted-foreground">{i18n.t('{0} 前有效', [new Date(task.expiresAt).toLocaleTimeString(i18n.locale)])}</span> : null}
      </div>
      <div className="console-login-card-body">
        {image && isImageSource(image) ? <img src={image} alt={`${typeLabel(task.type)} (${task.endpointKey})`} className="console-login-card-qr" /> : null}
        <div className="console-login-card-controls">
          {prompt ? <p className="text-sm">{prompt}</p> : null}
          {phone ? <p className="text-xs text-muted-foreground">{i18n.t('验证手机号：{0}', [phone])}</p> : null}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="console-login-card-link">
              <ExternalLink aria-hidden="true" />{task.type === 'slider' ? i18n.t('打开滑块验证页面') : i18n.t('打开验证链接')}
            </a>
          ) : null}
          {asksInput && !readOnly ? (
            <div className="space-y-1.5">
              <Input value={input} disabled={busy} onChange={event => setInput(event.target.value)}
                placeholder={i18n.t('输入验证码，或直接粘贴含 ticket 的 JSON / 回调链接…')} aria-label={i18n.t('输入验证码，或直接粘贴含 ticket 的 JSON / 回调链接…')} />
              {extracted.extractedFrom ? (
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><KeyRound className="h-3 w-3" aria-hidden="true" />
                  {i18n.t('已自动提取 Ticket：{0}', [extracted.value.length > 28 ? `${extracted.value.slice(0, 28)}…` : extracted.value])}</p>
              ) : null}
            </div>
          ) : null}
          {readOnly ? <p className="text-xs text-muted-foreground">{i18n.t('完成登录验证需要 endpoint.operate 权限。')}</p> : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || (asksInput && !extracted.value)} onClick={() => prepare('submit')}>
                {asksInput ? i18n.t('提交验证') : task.type === 'qrcode' ? i18n.t('已扫码，继续') : i18n.t('完成验证')}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => prepare('cancel')}>{i18n.t('取消')}</Button>
            </div>
          )}
          <ActionReceipt controller={receipt} />
        </div>
      </div>
    </div>
  )
}

/** Small badge for a waiting login task (lists of accounts). */
export function WaitingLoginBadge() {
  const i18n = useI18n()
  return <Badge variant="warning" size="sm" className="whitespace-nowrap"><QrCode className="h-3 w-3" aria-hidden="true" />{i18n.t('等待登录')}</Badge>
}
