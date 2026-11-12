import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { EyeOff, Plus, RefreshCw, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { useI18n } from '../i18n'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { SelectField } from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { StatusState } from '../components/StatusState'
import { ActionReceipt, useActionReceipt } from '../components/ActionReceipt'
import { receiptBlocksActions, type ReceiptPlan } from '../components/action-receipt-model.mjs'
import { requestConsole } from '../utils/console-rpc'
import { useConsoleAccess } from '../hooks/use-console-access'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { statusFromError, type StatusReading } from '../components/status-state-model.mjs'
import { ObjectSection } from './ObjectPageLayout'
import {
  CHAT_ROLE_COPY, CHAT_ROLE_LABELS, CHAT_ROLES,
  chatRoleApplied, chatRoleGrantRequest, chatRoleNeedsGlobalManage, chatRoleRefusal, chatRoleRevokeRequest, chatRoleRows, chatRolesListRequest,
  grantableChatRoles, readChatRoleChange, readChatRoles,
  type ChatRole, type ChatRoleEntry, type ChatRoleRow,
} from './chat-roles-model.mjs'
import { SCOPE_LEVEL_LABELS, parseScopeKey, scopeHref, scopeKey, type Scope } from './scope-tree.mjs'
import './chat-roles.css'

type ListState = { status: 'loading' | 'ready' | 'failed'; entries: ChatRoleEntry[]; failure: StatusReading | null; error: unknown }

function useChatRoles(scope: Scope) {
  const [state, setState] = useState<ListState>({ status: 'loading', entries: [], failure: null, error: null })
  const ticket = useRef(0)
  const body = JSON.stringify(scopeKey(scope) === null ? null : chatRolesListRequest(scope))
  const read = useCallback(async () => readChatRoles(await requestConsole<unknown>(JSON.parse(body))), [body])
  const load = useCallback(() => {
    const current = ++ticket.current
    if (body === 'null') return
    setState(previous => ({ ...previous, status: previous.entries.length ? previous.status : 'loading' }))
    read().then(entries => {
      if (current === ticket.current) setState({ status: 'ready', entries, failure: null, error: null })
    }, (error: unknown) => {
      if (current === ticket.current) setState(previous => ({ ...previous, status: 'failed', failure: statusFromError(error), error }))
    })
  }, [body, read])
  useEffect(() => {
    load()
    return () => { ticket.current += 1 }
  }, [load])
  return { ...state, refresh: load, read }
}

const ROLE_BADGE: Record<ChatRole, 'warning' | 'info' | 'outline'> = { owner: 'warning', admin: 'info', trusted: 'outline' }

function RoleTable({ rows, label, busy, globalManage, onRevoke, inheritedFrom }: {
  rows: readonly ChatRoleRow[]
  label: string
  busy: boolean
  /** Global `iam.manage`: needed to revoke an owner grant at any level. */
  globalManage: boolean
  onRevoke: (row: ChatRoleRow) => void
  inheritedFrom: (row: ChatRoleRow) => string
}) {
  const i18n = useI18n()
  const idPrefix = useId()
  return (
    <Table aria-label={label} className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[42%] max-md:w-[55%]">{i18n.t('身份')}</TableHead>
          <TableHead className="w-[14%] max-md:w-[20%]">{i18n.t('角色')}</TableHead>
          <TableHead className="w-[28%] max-md:hidden">{i18n.t('授予于')}</TableHead>
          <TableHead className="w-[16%] max-md:w-[25%] text-right">{i18n.t('操作')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.id}>
            <TableCell>
              {row.redacted ? (
                // An inherited grant at a scope this identity does not manage: role and level only.
                <span className="console-chat-role-identity is-redacted">
                  <EyeOff aria-hidden="true" />
                  <span className="min-w-0">{i18n.t(CHAT_ROLE_COPY.redacted)}</span>
                </span>
              ) : <span className="console-chat-role-identity">
                <UserRound aria-hidden="true" />
                <span className="min-w-0">
                  <code title={`${row.adapter} / ${row.userId}`}>{row.adapter} / {row.userId}</code>
                  {row.grantedBy || row.grantedAt ? (
                    <span className="console-chat-role-sub">
                      {[row.grantedBy ? i18n.t('由 {0} 授予', [row.grantedBy]) : '', row.grantedAt ? new Date(row.grantedAt).toLocaleDateString(i18n.locale) : ''].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </span>
              </span>}
            </TableCell>
            <TableCell><Badge variant={ROLE_BADGE[row.role]} size="sm">{i18n.t(CHAT_ROLE_LABELS[row.role])}</Badge></TableCell>
            <TableCell className="max-md:hidden">
              <span className="inline-flex flex-col">
                {/* Every zhin role is a grant (ADR 0056); what matters is the level it was granted at. */}
                {row.relation === 'inherited'
                  ? <Link className="text-sm underline" to={scopeHref(parseScopeKey(row.key) ?? {}, 'roles')}>{inheritedFrom(row)}</Link>
                  : row.relation === 'below' ? <code className="text-sm">{row.key}</code> : <span className="text-sm">{i18n.t('这一层')}</span>}
                {row.detail ? <code className="console-chat-role-sub">{row.detail}</code> : null}
              </span>
            </TableCell>
            <TableCell className="text-right">
              {row.redacted ? <span className="text-xs text-muted-foreground">{i18n.t('不可操作')}</span>
                : row.revocable && chatRoleNeedsGlobalManage(row.role) && !globalManage ? (
                  <span className="console-chat-role-blocked">
                    <Button variant="ghost" size="sm" disabled title={i18n.t(CHAT_ROLE_COPY.ownerNeedsGlobal)} aria-describedby={`${idPrefix}-blocked-${index}`}><Trash2 />{i18n.t('撤销')}</Button>
                    <span id={`${idPrefix}-blocked-${index}`} className="console-chat-role-sub">{i18n.t('需要全局 iam.manage')}</span>
                  </span>
                ) : row.revocable ? (
                  <Button variant="ghost" size="sm" onClick={() => onRevoke(row)} disabled={busy} aria-label={i18n.t('撤销 {0}', [`${row.adapter} / ${row.userId}`])}><Trash2 />{i18n.t('撤销')}</Button>
                ) : <span className="text-xs text-muted-foreground">{i18n.t('在上级撤销')}</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * 角色 tab of every object page (ADR 0056): chat roles granted here and inherited from above, then
 * the grant form. zhin roles come only from grants; platform standing (群主 / 管理员) is a separate
 * platform identity and is not shown here. Grant and revoke go through an ActionReceipt; an unknown
 * outcome is only re-read, never resent.
 */
interface PendingRoleAction { readonly action: 'grant' | 'revoke'; readonly adapter: string; readonly userId: string; readonly role?: ChatRole }
const pendingRoleAction = (plan: ReceiptPlan) => plan.payload as PendingRoleAction | undefined

export function ChatRolesPanel({ scope }: { scope: Scope }) {
  const i18n = useI18n()
  const key = scopeKey(scope)
  const roles = useChatRoles(scope)
  const access = useConsoleAccess()
  // Owner grants need a global iam.manage whatever the scope (ADR 0056 §3); a scoped binding is not enough.
  const globalManage = hasConsolePermission('iam.manage', access)
  const offered = grantableChatRoles(globalManage)
  const [userId, setUserId] = useState('')
  const [platform, setPlatform] = useState('')
  const [role, setRole] = useState<ChatRole>('admin')
  const [formError, setFormError] = useState<string | null>(null)
  // The action rides on the plan, and the receipt outlives the tab (action-receipt-store): an
  // unknown grant / revoke stays 结果未知 after switching tabs and back, never resent.
  const receipt = useActionReceipt({
    persistKey: `chat-roles:${key ?? ''}`,
    submit: async plan => {
      const target = pendingRoleAction(plan)
      if (!target) throw new Error('No action')
      const request = target.action === 'grant'
        ? chatRoleGrantRequest(scope, { adapter: target.adapter, userId: target.userId, role: target.role! })
        : chatRoleRevokeRequest(scope, { adapter: target.adapter, userId: target.userId })
      try {
        return readChatRoleChange(await requestConsole<unknown>(request))
      } catch (error) {
        // A certain refusal shows its reason in the receipt (未执行); anything else stays 结果未知.
        const refusal = chatRoleRefusal(statusFromError(error))
        if (!refusal) throw error
        return { status: 'failed', message: refusal.code === 'unpersisted' ? i18n.t(CHAT_ROLE_COPY.unpersisted) : refusal.message }
      }
    },
    verify: async plan => {
      const target = pendingRoleAction(plan)
      if (!target) return undefined
      return { applied: chatRoleApplied(await roles.read(), scope, target, target.action) }
    },
    onSettled: () => {
      setUserId('')
      roles.refresh()
    },
  })
  if (key === null) {
    return <StatusState kind="unsupported" title={i18n.t('这个范围不能设置聊天角色')}
      description={i18n.t('适配器名称不是实例别名，或账号 ID 含有不支持的字符。')} />
  }
  const alias = scope.level === 'global' ? null : scope.adapter!
  const rows = chatRoleRows(roles.entries, scope)
  const direct = rows.filter(row => row.relation === 'direct')
  const inherited = rows.filter(row => row.relation !== 'direct')
  const counts = CHAT_ROLES.map(item => ({ role: item, count: rows.filter(row => row.role === item && row.relation !== 'below').length }))
  const grantRole: ChatRole = offered.includes(role) ? role : 'admin'
  const prepareGrant = () => {
    const role = grantRole
    const adapter = alias ?? platform.trim()
    try {
      chatRoleGrantRequest(scope, { adapter, userId, role })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
      return
    }
    setFormError(null)
    receipt.prepare({
      payload: { action: 'grant', adapter, userId: userId.trim(), role } satisfies PendingRoleAction,
      title: i18n.t('授予 {0}：{1} / {2}', [i18n.t(CHAT_ROLE_LABELS[role]), adapter, userId.trim()]),
      summary: i18n.t('在这一层及其下所有范围生效。不能授予或覆盖与你同级或更高的角色；Host 拒绝时这里显示原因。'),
      confirmLabel: i18n.t('授予'),
      danger: role === 'owner',
    })
  }
  const prepareRevoke = (row: ChatRoleRow) => {
    // Redacted rows have no identity and are never revocable.
    if (!row.revocable || row.adapter === undefined || row.userId === undefined) return
    receipt.prepare({
      payload: { action: 'revoke', adapter: row.adapter, userId: row.userId } satisfies PendingRoleAction,
      title: i18n.t('撤销 {0}：{1} / {2}', [i18n.t(CHAT_ROLE_LABELS[row.role]), row.adapter, row.userId]),
      summary: i18n.t('只撤销在这一层直接授予的角色；从上级继承的角色不受影响。'),
      confirmLabel: i18n.t('撤销'),
      danger: true,
    })
  }
  const busy = receiptBlocksActions(receipt.state)
  const inheritedFrom = (row: ChatRoleRow) => {
    const from = parseScopeKey(row.key)
    if (!from) return row.key
    return from.level === 'global' ? i18n.t('全局') : `${i18n.t(SCOPE_LEVEL_LABELS[from.level])} ${row.key}`
  }
  return (
    <>
      <ObjectSection
        title={i18n.t('聊天角色')}
        description={i18n.t('所有者 ⊃ 管理员 ⊃ 受信任。在某一层授予的角色对其下所有范围有效。zhin 角色只来自授予；平台群主/管理员是平台身份，单独影响平台相关能力。')}
        actions={<Button variant="outline" size="sm" onClick={roles.refresh} disabled={roles.status === 'loading'}><RefreshCw className={roles.status === 'loading' ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>}
      >
        {roles.status === 'failed' && roles.failure ? (
          <StatusState error={roles.error} onRetry={roles.refresh}
            {...(roles.failure.kind === 'unsupported' ? { description: i18n.t('当前 Host 还没有聊天角色（chat-roles.*），升级后可在这里管理。') } : {})} />
        ) : roles.status === 'loading' ? (
          <div className="space-y-2">{[0, 1, 2].map(index => <Skeleton key={index} className="h-10" />)}</div>
        ) : !rows.length ? (
          <StatusState kind="empty" title={i18n.t('这一层还没有聊天角色')} description={i18n.t('在下方授予，或在聊天里用「角色 授予」命令。')} />
        ) : (
          <>
            <div className="console-chat-role-counts" aria-label={i18n.t('在这一层有效的角色')}>
              {counts.map(item => (
                <span key={item.role} className="console-chat-role-count">
                  <Badge variant={ROLE_BADGE[item.role]} size="sm">{i18n.t(CHAT_ROLE_LABELS[item.role])}</Badge>
                  <strong>{item.count}</strong>
                </span>
              ))}
            </div>
            <Card className="overflow-hidden p-0">
              <h3 className="console-chat-role-card-title">{i18n.t('在这一层授予')}<span>{direct.length}</span></h3>
              {direct.length ? <RoleTable rows={direct} label={i18n.t('在这一层授予')} busy={busy} globalManage={globalManage} onRevoke={prepareRevoke} inheritedFrom={inheritedFrom} />
                : <p className="console-chat-role-empty">{i18n.t('这一层没有直接授予的角色。')}</p>}
            </Card>
            {inherited.length ? (
              <Card className="overflow-hidden p-0">
                <h3 className="console-chat-role-card-title">{i18n.t('从上级继承')}<span>{inherited.length}</span></h3>
                <RoleTable rows={inherited} label={i18n.t('从上级继承')} busy={busy} globalManage={globalManage} onRevoke={prepareRevoke} inheritedFrom={inheritedFrom} />
              </Card>
            ) : null}
          </>
        )}
        <ActionReceipt controller={receipt} />
      </ObjectSection>
      <ObjectSection title={i18n.t('授予角色')} description={alias ? i18n.t('身份属于适配器 {0}。', [alias]) : i18n.t('全局角色可为每个平台登记一个身份。')}>
        <Card className="grid gap-3 p-4 sm:grid-cols-2 sm:items-end xl:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,10rem)_auto]">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{i18n.t('适配器')}</span>
            <Input value={alias ?? platform} onChange={event => setPlatform(event.target.value)} disabled={Boolean(alias)} placeholder="qq"
              title={alias ? i18n.t('这一层的身份只能属于它自己的适配器。') : undefined} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{i18n.t('平台用户 ID')}</span>
            <Input value={userId} onChange={event => setUserId(event.target.value)} placeholder="10001" />
          </label>
          <div className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{i18n.t('角色')}</span>
            <SelectField aria-label={i18n.t('角色')} value={grantRole} onValueChange={value => setRole(value as ChatRole)}
              options={offered.map(value => ({ value, label: i18n.t(CHAT_ROLE_LABELS[value]) }))} />
          </div>
          <Button onClick={prepareGrant} disabled={busy || !userId.trim() || (!alias && !platform.trim())}><Plus />{i18n.t('授予')}</Button>
        </Card>
        {!globalManage ? <p className="text-xs text-muted-foreground">{i18n.t('授予或撤销所有者需要全局 iam.manage 权限；当前身份可以授予管理员和受信任。')}</p> : null}
        {formError ? <p role="alert" className="text-sm text-destructive">{i18n.t('无法授予：{0}', [formError])}</p> : null}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{i18n.t('聊天角色只影响机器人在聊天里的权限，不影响 Console 登录与权限。')}</p>
      </ObjectSection>
    </>
  )
}
