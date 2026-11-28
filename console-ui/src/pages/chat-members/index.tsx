import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { GitMerge, Pencil, RefreshCw, Scissors, Search, ShieldAlert, UserRound } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, PageHeader, PageShell, Skeleton } from '@zhin.js/console-ui'
import { StatusState } from '../../components/StatusState'
import { statusFromError } from '../../components/status-state-model.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission, scopedAdapters } from '../../utils/console-access.mjs'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { IdentityChip, MyChatIdentitySection } from '../../scope/ChatIdentityPanels'
import { CHAT_ROLE_COPY, CHAT_ROLE_LABELS } from '../../scope/chat-roles-model.mjs'
import {
  filterPrincipals, isMissingIdentityRpc, isSimulatedOnly, lastSeen, mergeRequest, principalActions, principalName, principalsListPlan, readPrincipals, settlePrincipalLists,
  renameRequest, splitRequest, type ChatIdentityView, type ChatPrincipalView,
} from '../../scope/chat-identity-model.mjs'
import '../admin-pages.css'
import '../../scope/chat-roles.css'

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; principals: ChatPrincipalView[]; failedAdapters: string[] }
  | { status: 'unsupported' }
  | { status: 'failed'; error: unknown }

type Editing =
  | { kind: 'rename'; principal: ChatPrincipalView }
  | { kind: 'merge'; principal: ChatPrincipalView }
  | { kind: 'split'; principal: ChatPrincipalView; identity: ChatIdentityView }

/**
 * 聊天成员 (ADR 0060 §7): the people behind chat identities — their platform identities, chat
 * roles, last message and the Console user linked to them; rename / merge / split for operators
 * with iam.manage (a person holding a global role needs a global binding). 「我的聊天身份」 is on top
 * for every signed-in user. On a Host without `chat-principals.*` the page says so.
 */
export default function ChatMembersPage() {
  const i18n = useI18n()
  const [params] = useSearchParams()
  const access = useConsoleAccess()
  const globalManage = hasConsolePermission('iam.manage', access)
  const [state, setState] = useState<ListState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const ticket = useRef(0)
  // Without global iam.manage the Host answers only per adapter: ask for each managed adapter.
  const adapters = scopedAdapters('iam.manage', access).join('\u0000')
  const load = useCallback(() => {
    const current = ++ticket.current
    // One adapter failing (or an alias that is not a scope key) leaves the others listed.
    const plan = principalsListPlan(adapters ? adapters.split('\u0000') : [])
    void Promise.allSettled(plan.requests.map(({ request }) => requestConsole<unknown>(request))).then(results => {
      if (current !== ticket.current) return
      const settled = settlePrincipalLists(plan, results)
      if ('error' in settled) setState(isMissingIdentityRpc(settled.error) ? { status: 'unsupported' } : { status: 'failed', error: settled.error })
      else setState({ status: 'ready', principals: readPrincipals(settled.payload), failedAdapters: settled.failedAdapters })
    })
  }, [adapters])
  useEffect(() => { load(); return () => { ticket.current += 1 } }, [load])
  const principals = state.status === 'ready' ? state.principals : []
  const shown = useMemo(() => filterPrincipals(principals, query), [principals, query])
  // A list reply means the caller manages at least the scopes it shows (the Host filtered it).
  const manage = state.status === 'ready'
  return (
    <PageShell>
      <PageHeader title={i18n.t('聊天成员')}
        description={i18n.t('聊天里的「人」：一个人可以有多个平台身份，角色授予属于人。在这里核对身份、归并同一个人在不同平台的账号，或拆分误归并的身份。')}
        actions={<Button variant="secondary" size="sm" onClick={load} disabled={state.status === 'loading'}><RefreshCw className={state.status === 'loading' ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>} />
      <MyChatIdentitySection highlight={params.get('me') === '1'} />
      <ObjectSection title={i18n.t('全部成员')} description={i18n.t('有全局 iam.manage 时列出全部成员；只在部分适配器上有 iam.manage 时，只列出这些适配器上的身份，同一个人在其他适配器上的身份只显示数量。')}>
        {state.status === 'unsupported' ? <StatusState kind="unsupported" description={i18n.t('当前 Host 还没有「聊天成员」（chat-principals.*），升级后可在这里管理。')} />
          : state.status === 'failed' ? <StatusState error={state.error} onRetry={load} permissions={['iam.manage']} />
          : state.status === 'loading' ? <StatusState kind="loading" placeholder={<div className="space-y-2">{[0, 1, 2].map(index => <Skeleton key={index} className="h-16" />)}</div>} />
          : (
            <>
              {state.failedAdapters.length ? (
                <Alert variant="warning" role="status">
                  <AlertDescription className="flex flex-wrap items-center gap-2">
                    <span>{i18n.t('无法读取这些适配器上的成员：{0}。其他适配器的成员照常列出。', [state.failedAdapters.join(i18n.t('、'))])}</span>
                    <Button variant="secondary" size="sm" onClick={load}><RefreshCw />{i18n.t('重试')}</Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              <label className="console-chat-picker-search console-chat-members-search">
                <Search aria-hidden="true" />
                <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={i18n.t('按名字、平台用户 ID 或 Console 用户搜索')} aria-label={i18n.t('搜索成员')} />
              </label>
              {!principals.length ? <StatusState kind="empty" title={i18n.t('还没有「人」')} description={i18n.t('授予角色、绑定或归并后，这里会列出对应的人。')} />
                : !shown.length ? <StatusState kind="empty" title={i18n.t('没有匹配的成员')} />
                : <div className="console-chat-members" role="list" aria-label={i18n.t('全部成员')}>
                  {shown.map(principal => <MemberCard key={principal.id} principal={principal} manage={manage} globalManage={globalManage} onEdit={setEditing} />)}
                </div>}
            </>
          )}
      </ObjectSection>
      {editing ? <EditDialog editing={editing} principals={principals} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} /> : null}
    </PageShell>
  )
}

function MemberCard({ principal, manage, globalManage, onEdit }: {
  principal: ChatPrincipalView
  manage: boolean
  globalManage: boolean
  onEdit: (editing: Editing) => void
}) {
  const i18n = useI18n()
  const actions = principalActions(principal, { manage, globalManage })
  const seen = lastSeen(principal)
  return (
    <Card className="console-chat-member" role="listitem">
      <div className="console-chat-member-head">
        <UserRound aria-hidden="true" />
        <strong>{principalName(principal)}</strong>
        <code className="console-chat-person-id" title={i18n.t('在聊天中可用 #{0} 引用这个人', [principal.id.slice(0, 9)])}>{principal.stored ? principal.id : i18n.t('单身份')}</code>
        {principal.unverified ? <Badge variant="warning" size="sm" title={i18n.t('有身份是运营者归并的，未经本人证明')}>{i18n.t('未验证')}</Badge> : null}
        <span className="console-chat-member-seen">{seen ? i18n.t('最近发言 {0}', [new Date(seen).toLocaleString(i18n.locale)])
          : isSimulatedOnly(principal) ? i18n.t(CHAT_ROLE_COPY.simulatedSender) : i18n.t('90 天内没有发言')}</span>
      </div>
      <div className="console-chat-member-body">
        <div>
          <span className="console-chat-member-label">{i18n.t('平台身份')}</span>
          <div className="console-chat-identity-list">
            {principal.identities.map(identity => (
              <span key={`${identity.adapter}/${identity.userId}`} className="console-chat-member-identity">
                <IdentityChip identity={identity} />
                {actions.split ? <Button variant="ghost" size="sm" onClick={() => onEdit({ kind: 'split', principal, identity })} aria-label={i18n.t('拆分 {0}', [`${identity.adapter} / ${identity.userId}`])}><Scissors /></Button> : null}
              </span>
            ))}
            {principal.hiddenIdentities ? <span className="console-admin-note">{i18n.t('另有 {0} 个身份在你不管理的适配器上', [principal.hiddenIdentities])}</span> : null}
          </div>
        </div>
        <div>
          <span className="console-chat-member-label">{i18n.t('聊天角色')}</span>
          <div className="console-chat-role-list">
            {principal.roles.length ? principal.roles.map((role, index) => (
              <Badge key={index} variant={role.role === 'owner' ? 'default' : role.role === 'admin' ? 'secondary' : 'outline'} size="sm"
                title={role.grantedByName ?? role.grantedBy ? i18n.t('由 {0} 授予', [role.grantedByName ?? role.grantedBy!]) : undefined}>
                {i18n.t(CHAT_ROLE_LABELS[role.role])} · {role.redacted ? i18n.t('上级授予') : role.key || i18n.t('全局')}
              </Badge>
            )) : <span className="console-admin-note">{i18n.t('没有角色')}</span>}
          </div>
        </div>
        <div>
          <span className="console-chat-member-label">{i18n.t('Console 用户')}</span>
          <span>{principal.consoleLink ? <>{principal.consoleLink.consoleDisplayName ?? principal.consoleLink.consoleUserId} <code className="console-access-id">{principal.consoleLink.consoleUserId}</code></> : <span className="console-admin-note">{globalManage ? i18n.t('未链接') : i18n.t('需要全局 iam.manage 才能查看')}</span>}</span>
        </div>
      </div>
      {actions.rename || actions.merge || actions.needsGlobal ? (
        <div className="console-chat-member-actions">
          {actions.rename ? <Button variant="secondary" size="sm" onClick={() => onEdit({ kind: 'rename', principal })}><Pencil />{i18n.t('改名')}</Button> : null}
          {actions.merge ? <Button variant="secondary" size="sm" onClick={() => onEdit({ kind: 'merge', principal })}><GitMerge />{i18n.t('归并另一个人…')}</Button> : null}
          {actions.needsGlobal ? <span className="console-admin-note"><ShieldAlert aria-hidden="true" />{i18n.t('持有全局角色：改名、归并或拆分需要全局 iam.manage')}</span> : null}
        </div>
      ) : null}
    </Card>
  )
}

function EditDialog({ editing, principals, onClose, onDone }: {
  editing: Editing
  principals: readonly ChatPrincipalView[]
  onClose: () => void
  onDone: () => void
}) {
  const i18n = useI18n()
  const [name, setName] = useState(editing.kind === 'rename' ? editing.principal.displayName ?? '' : '')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState<ChatPrincipalView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const others = filterPrincipals(principals.filter(person => person.id !== editing.principal.id), query).slice(0, 20)
  const submit = async () => {
    setBusy(true); setError(null)
    try {
      await requestConsole<unknown>(editing.kind === 'rename' ? renameRequest(editing.principal.id, name)
        : editing.kind === 'split' ? splitRequest(editing.identity)
        : mergeRequest(editing.principal.id, from!.id))
      onDone()
    } catch (failure) {
      setError(statusFromError(failure).message || i18n.t('操作失败'))
    } finally { setBusy(false) }
  }
  const target = principalName(editing.principal)
  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing.kind === 'rename' ? i18n.t('给 {0} 改名', [target])
            : editing.kind === 'split' ? i18n.t('从 {0} 拆分身份', [target]) : i18n.t('把另一个人归并到 {0}', [target])}</DialogTitle>
          <DialogDescription>{editing.kind === 'rename' ? i18n.t('名字只用于显示，不影响任何权限。')
            : editing.kind === 'split' ? i18n.t('{0} 将成为一个新的人。全局角色留在原来的人身上；只在这个适配器上生效的角色，若原来的人在该适配器上没有其他身份，会随身份一起移走。', [`${editing.identity.adapter} / ${editing.identity.userId}`])
            : i18n.t('被归并的人的全部身份与角色并入这里（同一范围保留较高的角色）。运营者归并未经本人证明，会标注「未验证」并写入审计。')}</DialogDescription>
        </DialogHeader>
        {editing.kind === 'rename' ? (
          <Input value={name} maxLength={256} onChange={event => setName(event.target.value)} aria-label={i18n.t('显示名')} placeholder={i18n.t('留空表示清除名字')} />
        ) : editing.kind === 'merge' ? (
          <div className="console-chat-picker">
            <label className="console-chat-picker-search">
              <Search aria-hidden="true" />
              <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={i18n.t('搜索要并入的人')} aria-label={i18n.t('搜索要并入的人')} />
            </label>
            <div role="listbox" aria-label={i18n.t('要并入的人')} className="console-chat-picker-list">
              {others.length ? others.map(person => (
                <button key={person.id} type="button" role="option" aria-selected={from?.id === person.id}
                  className={from?.id === person.id ? 'console-chat-picker-option is-selected' : 'console-chat-picker-option'} onClick={() => setFrom(person)}>
                  <span className="console-chat-picker-name">{principalName(person)}</span>
                  <code>{person.identities.map(identity => `${identity.adapter}/${identity.userId}`).join('、')}</code>
                </button>
              )) : <p className="console-admin-note">{i18n.t('没有匹配的人。')}</p>}
            </div>
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{i18n.t('取消')}</Button>
          <Button onClick={() => { void submit() }} disabled={busy || (editing.kind === 'merge' && !from)}>
            {editing.kind === 'rename' ? i18n.t('保存') : editing.kind === 'split' ? i18n.t('拆分') : i18n.t('归并')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
