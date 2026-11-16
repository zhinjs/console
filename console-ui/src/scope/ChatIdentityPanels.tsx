import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Copy, Crown, KeyRound, Link2, RefreshCw, Search, UserRound } from 'lucide-react'
import { useI18n } from '../i18n'
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from '@zhin.js/console-ui'
import { StatusState } from '../components/StatusState'
import { requestConsole } from '../utils/console-rpc'
import { copyText } from '../pages/clipboard-copy.mjs'
import { statusFromError } from '../components/status-state-model.mjs'
import { ObjectSection } from './ObjectPageLayout'
import { useConsoleAccess } from '../hooks/use-console-access'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { CHAT_ROLE_LABELS } from './chat-roles-model.mjs'
import {
  CHAT_IDENTITY_SELF_PERMISSION, CHAT_PRINCIPALS_RPC, LINK_METHOD_LABELS, bindCountdown, bindInstruction, grantCandidates, isMissingIdentityRpc, principalName,
  promoteGlobalOwnerRequest, readBindCode, readIdentityMe, readPrincipals, readRecentIdentities, recentIdentitiesRequest, principalsListRequest,
  type ChatGrantCandidate, type ChatIdentityMe, type ChatIdentityView, type ChatPrincipalView,
} from './chat-identity-model.mjs'
import type { ScopeRef } from './scope-tree.mjs'
import './chat-roles.css'

type MeState =
  | { status: 'loading' }
  | { status: 'ready'; me: ChatIdentityMe }
  | { status: 'unsupported' }
  | { status: 'forbidden' }
  | { status: 'failed'; error: unknown }

/**
 * `chat-identities.me`; `unsupported` on a Host without it (the entries stay hidden); `forbidden`
 * without `self.chat-identity` (ADR 0060 Q4) — not asked at all, or refused by the Host.
 */
export function useMyChatIdentity() {
  const access = useConsoleAccess()
  const allowed = hasConsolePermission(CHAT_IDENTITY_SELF_PERMISSION, access)
  const [state, setState] = useState<MeState>(() => allowed ? { status: 'loading' } : { status: 'forbidden' })
  const ticket = useRef(0)
  const load = useCallback(() => {
    const current = ++ticket.current
    if (!allowed) { setState({ status: 'forbidden' }); return }
    setState(previous => previous.status === 'forbidden' ? { status: 'loading' } : previous)
    requestConsole<unknown>({ type: CHAT_PRINCIPALS_RPC.ME }).then(
      payload => { if (current === ticket.current) setState({ status: 'ready', me: readIdentityMe(payload) }) },
      (error: unknown) => {
        if (current !== ticket.current) return
        setState(isMissingIdentityRpc(error) ? { status: 'unsupported' } : statusFromError(error).kind === 'forbidden' ? { status: 'forbidden' } : { status: 'failed', error })
      },
    )
  }, [allowed])
  useEffect(() => { load(); return () => { ticket.current += 1 } }, [load])
  return { state, refresh: load }
}

/** One identity as a compact chip: `adapter / userId`, display name and how it joined the person. */
export function IdentityChip({ identity }: { identity: ChatIdentityView }) {
  const i18n = useI18n()
  return (
    <span className="console-chat-identity-chip" title={`${identity.adapter} / ${identity.userId}`}>
      <code>{identity.adapter} / {identity.userId}</code>
      {identity.lastDisplayName ? <span>{identity.lastDisplayName}</span> : null}
      {identity.linkMethod && identity.linkMethod !== 'implicit' ? <em>{i18n.t(LINK_METHOD_LABELS[identity.linkMethod])}</em> : null}
    </span>
  )
}

/**
 * 「我的聊天身份」 and 「把聊天身份绑定到我」 (ADR 0060 §2.4 / §3.1): the person linked to the
 * signed-in user, a one-time bind code to send as `绑定 <码>` in a private chat, and — when there is
 * no global owner and the caller holds a global iam.manage — 「设为全局 owner」. Hidden on a Host
 * without these RPCs.
 */
export function MyChatIdentitySection({ highlight = false }: { highlight?: boolean }) {
  const i18n = useI18n()
  const { state, refresh } = useMyChatIdentity()
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOwner, setConfirmOwner] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const sectionRef = useRef<HTMLDivElement>(null)
  const linkedBefore = useRef<string | null>(null)
  const me = state.status === 'ready' ? state.me : null
  const linkedId = me?.principal?.id ?? null
  // While a code is open, look again every few seconds so 「已绑定」 shows once the chat side used it.
  useEffect(() => {
    if (!code) return
    const timer = setInterval(() => { setNow(Date.now()); if (Date.now() < code.expiresAt) refresh() }, 4000)
    return () => clearInterval(timer)
  }, [code, refresh])
  useEffect(() => {
    if (code && linkedId && linkedBefore.current !== linkedId && !me?.pendingCodeExpiresAt) {
      setCode(null)
      setNotice(i18n.t('已绑定：聊天身份已链接到你的 Console 账号。'))
    }
    linkedBefore.current = linkedId
  }, [code, linkedId, me?.pendingCodeExpiresAt, i18n])
  useEffect(() => {
    if (highlight && state.status === 'ready') sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [highlight, state.status])
  if (state.status === 'unsupported') return null
  const createCode = async () => {
    setBusy(true); setError(null); setNotice(null)
    try {
      setCode(readBindCode(await requestConsole<unknown>({ type: CHAT_PRINCIPALS_RPC.BIND_CODE_CREATE })))
      setNow(Date.now())
    } catch (failure) {
      setError(statusFromError(failure).message || i18n.t('生成绑定码失败'))
    } finally { setBusy(false) }
  }
  const promote = async () => {
    if (!me?.principal) return
    setBusy(true); setError(null)
    try {
      await requestConsole<unknown>(promoteGlobalOwnerRequest(me.principal))
      setConfirmOwner(false)
      setNotice(i18n.t('已设为全局 owner。'))
      refresh()
    } catch (failure) {
      setError(statusFromError(failure).message || i18n.t('设置失败'))
    } finally { setBusy(false) }
  }
  const instruction = code ? bindInstruction(code.code, i18n.locale === 'en' ? 'en' : 'zh-CN') : ''
  return (
    <div ref={sectionRef} className={highlight ? 'console-chat-me is-highlighted' : 'console-chat-me'}>
      <ObjectSection title={i18n.t('我的聊天身份')}
        description={i18n.t('链接到你 Console 账号的「人」：它在各平台的身份与聊天角色。链接不带来任何权限，只用于 Sandbox「以我的聊天身份发言」、个人推理主体与显示授予者。')}
        actions={<Button variant="outline" size="sm" onClick={refresh} disabled={state.status === 'loading'}><RefreshCw className={state.status === 'loading' ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>}>
        {state.status === 'forbidden' ? <StatusState kind="forbidden" permissions={[CHAT_IDENTITY_SELF_PERMISSION]} />
          : state.status === 'failed' ? <StatusState error={state.error} onRetry={refresh} />
          : state.status === 'loading' ? <StatusState kind="loading" />
          : (
            <Card className="console-chat-me-card">
              {me?.principal ? (
                <div className="console-chat-me-person">
                  <div className="console-chat-me-head">
                    <UserRound aria-hidden="true" />
                    <strong>{principalName(me.principal)}</strong>
                    <code className="console-chat-person-id">{me.principal.id}</code>
                  </div>
                  <div className="console-chat-identity-list" aria-label={i18n.t('平台身份')}>
                    {me.principal.identities.map(identity => <IdentityChip key={`${identity.adapter}/${identity.userId}`} identity={identity} />)}
                  </div>
                  <div className="console-chat-role-list" aria-label={i18n.t('聊天角色')}>
                    {me.principal.roles.length ? me.principal.roles.map((role, index) => (
                      <Badge key={index} variant={role.role === 'owner' ? 'warning' : role.role === 'admin' ? 'info' : 'outline'} size="sm">
                        {i18n.t(CHAT_ROLE_LABELS[role.role])} · {role.key || i18n.t('全局')}
                      </Badge>
                    )) : <span className="console-admin-note">{i18n.t('还没有聊天角色。')}</span>}
                  </div>
                </div>
              ) : <p className="console-admin-note">{i18n.t('还没有把聊天身份绑定到你的 Console 账号。')}</p>}
              {me?.suggestGlobalOwner && me.principal ? (
                <div className="console-chat-me-owner" role="note">
                  <Crown aria-hidden="true" />
                  <span>{i18n.t('还没有聊天主人（全局 owner）。你持有全局 iam.manage，可以把这个人设为全局 owner。')}</span>
                  <Button size="sm" onClick={() => setConfirmOwner(true)} disabled={busy}>{i18n.t('设为全局 owner')}</Button>
                </div>
              ) : null}
              <div className="console-chat-bind">
                <div>
                  <strong><Link2 aria-hidden="true" />{i18n.t('把聊天身份绑定到我')}</strong>
                  <p className="console-admin-note">{i18n.t('生成一次性绑定码（10 分钟内有效、只能用一次），然后在聊天里私聊机器人发送它。群聊里发送会让码立即作废。')}</p>
                </div>
                {code && now < code.expiresAt ? (
                  <div className="console-chat-bind-code" aria-live="polite">
                    <span className="console-admin-note">{i18n.t('在私聊里给机器人发送：')}</span>
                    <code className="console-chat-bind-instruction">{instruction}</code>
                    <Button variant="outline" size="sm" onClick={() => { void copyText(instruction, navigator.clipboard, document).then(ok => setNotice(ok ? i18n.t('已复制') : null)) }}><Copy />{i18n.t('复制')}</Button>
                    <span className="console-chat-bind-countdown">{i18n.t('剩余 {0}', [bindCountdown(code.expiresAt, now)])}</span>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => { void createCode() }} disabled={busy}>
                    <KeyRound />{me?.pendingCodeExpiresAt ? i18n.t('重新生成绑定码') : i18n.t('生成绑定码')}
                  </Button>
                )}
              </div>
              {notice ? <p role="status" className="console-chat-me-notice">{notice}</p> : null}
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </Card>
          )}
      </ObjectSection>
      {confirmOwner && me?.principal ? (
        <Dialog open onOpenChange={open => { if (!open && !busy) setConfirmOwner(false) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{i18n.t('把 {0} 设为全局 owner？', [principalName(me.principal)])}</DialogTitle>
              <DialogDescription>{i18n.t('全局 owner 在每个平台的聊天里都是机器人的主人：可以改配置、重启、使用危险工具。这条授予会写入审计日志（chat-roles.grant）。')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOwner(false)} disabled={busy}>{i18n.t('取消')}</Button>
              <Button onClick={() => { void promote() }} disabled={busy}>{i18n.t('设为全局 owner')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

type PickerSource = { status: 'loading' | 'ready' | 'unsupported'; recent: ChatIdentityView[]; principals: ChatPrincipalView[] }

/** Recent speakers at the scope and known people (both best effort); `unsupported` on an older Host. */
export function useGrantCandidates(scope: ScopeRef) {
  const [source, setSource] = useState<PickerSource>({ status: 'loading', recent: [], principals: [] })
  const body = JSON.stringify(scope)
  useEffect(() => {
    let alive = true
    const target = JSON.parse(body) as ScopeRef
    setSource(previous => ({ ...previous, status: 'loading' }))
    Promise.allSettled([
      requestConsole<unknown>(recentIdentitiesRequest(target, 100)),
      requestConsole<unknown>(principalsListRequest(target)),
    ]).then(([recent, people]) => {
      if (!alive) return
      const missing = [recent, people].every(result => result.status === 'rejected' && isMissingIdentityRpc(result.reason))
      setSource({
        status: missing ? 'unsupported' : 'ready',
        recent: recent.status === 'fulfilled' ? readRecentIdentities(recent.value) : [],
        principals: people.status === 'fulfilled' ? readPrincipals(people.value) : [],
      })
    })
    return () => { alive = false }
  }, [body])
  return source
}

/**
 * Searchable identity picker of the grant form (ADR 0060 §7): recent speakers of this scope and
 * known people's identities, below 全局 only on the scope's own adapter.
 */
export function GrantIdentityPicker({ scope, alias, value, onPick, onUnsupported }: {
  scope: ScopeRef
  alias: string | null
  value: { adapter: string; userId: string } | null
  onPick: (candidate: ChatGrantCandidate) => void
  /** An older Host without `chat-identities.recent` / `chat-principals.list`: only typing an id remains. */
  onUnsupported?: () => void
}) {
  const i18n = useI18n()
  const listId = useId()
  const source = useGrantCandidates(scope)
  const [query, setQuery] = useState('')
  useEffect(() => { if (source.status === 'unsupported') onUnsupported?.() }, [source.status, onUnsupported])
  if (source.status === 'unsupported') return null
  const candidates = grantCandidates({ recent: source.recent, principals: source.principals, alias, query }).slice(0, 30)
  return (
    <div className="console-chat-picker">
      <label className="console-chat-picker-search">
        <Search aria-hidden="true" />
        <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={i18n.t('搜索最近发言人或已知的人')} aria-controls={listId} aria-label={i18n.t('搜索最近发言人或已知的人')} />
      </label>
      <div id={listId} role="listbox" aria-label={i18n.t('选择要授予的人')} className="console-chat-picker-list">
        {source.status === 'loading' ? <p className="console-admin-note">{i18n.t('正在读取最近发言人…')}</p>
          : candidates.length ? candidates.map(candidate => {
            const selected = value?.adapter === candidate.adapter && value.userId === candidate.userId
            return (
              <button key={candidate.key} type="button" role="option" aria-selected={selected}
                className={selected ? 'console-chat-picker-option is-selected' : 'console-chat-picker-option'} onClick={() => onPick(candidate)}>
                <span className="console-chat-picker-name">{candidate.label}</span>
                <code>{candidate.adapter} / {candidate.userId}</code>
                <em>{candidate.source === 'recent' ? i18n.t('最近发言') : candidate.personName && candidate.personName !== candidate.label ? candidate.personName : i18n.t('已知的人')}</em>
              </button>
            )
          }) : <p className="console-admin-note">{query ? i18n.t('没有匹配的人。') : i18n.t('这一层最近没有人发言，可展开「高级」手动填写。')}</p>}
      </div>
    </div>
  )
}
