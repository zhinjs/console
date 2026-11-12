import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Plus, RefreshCw, ShieldCheck, Trash2, UserRound } from 'lucide-react'
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
import { requestConsole } from '../utils/console-rpc'
import { statusFromError, type StatusReading } from '../components/status-state-model.mjs'
import { ObjectSection } from './ObjectPageLayout'
import {
  CHAT_ROLE_LABELS, CHAT_ROLE_MAPPING_LEVEL_LABELS, CHAT_ROLE_MAPPINGS_HIDDEN_KEY, CHAT_ROLE_SOURCE_LABELS, CHAT_ROLES, PLATFORM_STANDING_LABELS,
  chatRoleApplied, chatRoleGrantRequest, chatRoleMappingsRequest, chatRoleRevokeRequest, chatRoleRows, chatRolesListRequest, mappingMatchParts,
  readChatRoleChange, readChatRoleMappings, readChatRoles,
  type ChatRole, type ChatRoleEntry, type ChatRoleMappings, type ChatRoleRow, type PlatformStanding,
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

function RoleTable({ rows, label, busy, onRevoke, inheritedFrom }: {
  rows: readonly ChatRoleRow[]
  label: string
  busy: boolean
  onRevoke: (row: ChatRoleRow) => void
  inheritedFrom: (row: ChatRoleRow) => string
}) {
  const i18n = useI18n()
  return (
    <Table aria-label={label} className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[42%] max-md:w-[55%]">{i18n.t('身份')}</TableHead>
          <TableHead className="w-[14%] max-md:w-[20%]">{i18n.t('角色')}</TableHead>
          <TableHead className="w-[28%] max-md:hidden">{i18n.t('来源')}</TableHead>
          <TableHead className="w-[16%] max-md:w-[25%] text-right">{i18n.t('操作')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row => (
          <TableRow key={row.id}>
            <TableCell>
              <span className="console-chat-role-identity">
                <UserRound aria-hidden="true" />
                <span className="min-w-0">
                  <code title={`${row.adapter} / ${row.userId}`}>{row.adapter} / {row.userId}</code>
                  {row.grantedBy || row.grantedAt ? (
                    <span className="console-chat-role-sub">
                      {[row.grantedBy ? i18n.t('由 {0} 授予', [row.grantedBy]) : '', row.grantedAt ? new Date(row.grantedAt).toLocaleDateString(i18n.locale) : ''].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </span>
              </span>
            </TableCell>
            <TableCell><Badge variant={ROLE_BADGE[row.role]} size="sm">{i18n.t(CHAT_ROLE_LABELS[row.role])}</Badge></TableCell>
            <TableCell className="max-md:hidden">
              <span className="inline-flex flex-col">
                <span className="text-sm">{i18n.t(CHAT_ROLE_SOURCE_LABELS[row.source])}</span>
                {row.relation === 'inherited'
                  ? <Link className="console-chat-role-sub underline" to={scopeHref(parseScopeKey(row.key) ?? {}, 'roles')}>{i18n.t('继承自 {0}', [inheritedFrom(row)])}</Link>
                  : row.relation === 'below' ? <code className="console-chat-role-sub">{row.key}</code> : null}
                {row.detail ? <code className="console-chat-role-sub">{row.detail}</code> : null}
              </span>
            </TableCell>
            <TableCell className="text-right">
              {row.revocable ? (
                <Button variant="ghost" size="sm" onClick={() => onRevoke(row)} disabled={busy} aria-label={i18n.t('撤销 {0}', [`${row.adapter} / ${row.userId}`])}><Trash2 />{i18n.t('撤销')}</Button>
              ) : <span className="text-xs text-muted-foreground">{row.source === 'grant' ? i18n.t('在上级撤销') : i18n.t('不可在此撤销')}</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * 角色 tab of every object page (ADR 0056): chat roles granted here, inherited from above, and the
 * configuration / platform-mapping entries the Host reports, each with its source; then the grant
 * form and the (hideable) mapping rules. Grant and revoke go through an ActionReceipt; an unknown
 * outcome is only re-read, never resent.
 */
export function ChatRolesPanel({ scope }: { scope: Scope }) {
  const i18n = useI18n()
  const key = scopeKey(scope)
  const roles = useChatRoles(scope)
  const [userId, setUserId] = useState('')
  const [platform, setPlatform] = useState('')
  const [role, setRole] = useState<ChatRole>('admin')
  const [formError, setFormError] = useState<string | null>(null)
  const pendingAction = useRef<{ action: 'grant' | 'revoke'; adapter: string; userId: string; role?: ChatRole } | null>(null)
  const receipt = useActionReceipt({
    submit: async () => {
      const target = pendingAction.current
      if (!target) throw new Error('No action')
      const request = target.action === 'grant'
        ? chatRoleGrantRequest(scope, { adapter: target.adapter, userId: target.userId, role: target.role! })
        : chatRoleRevokeRequest(scope, { adapter: target.adapter, userId: target.userId })
      return readChatRoleChange(await requestConsole<unknown>(request))
    },
    verify: async () => {
      const target = pendingAction.current
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
  const prepareGrant = () => {
    const adapter = alias ?? platform.trim()
    try {
      chatRoleGrantRequest(scope, { adapter, userId, role })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
      return
    }
    setFormError(null)
    pendingAction.current = { action: 'grant', adapter, userId: userId.trim(), role }
    receipt.prepare({
      title: i18n.t('授予 {0}：{1} / {2}', [i18n.t(CHAT_ROLE_LABELS[role]), adapter, userId.trim()]),
      summary: i18n.t('在这一层及其下所有范围生效。授予者需要不低于该角色的权限。'),
      confirmLabel: i18n.t('授予'),
      danger: role === 'owner',
    })
  }
  const prepareRevoke = (row: ChatRoleRow) => {
    pendingAction.current = { action: 'revoke', adapter: row.adapter, userId: row.userId }
    receipt.prepare({
      title: i18n.t('撤销 {0}：{1} / {2}', [i18n.t(CHAT_ROLE_LABELS[row.role]), row.adapter, row.userId]),
      summary: i18n.t('只撤销在这一层直接授予的角色；继承、配置文件与平台映射得到的角色不受影响。'),
      confirmLabel: i18n.t('撤销'),
      danger: true,
    })
  }
  const busy = receipt.state.phase !== 'idle' && receipt.state.phase !== 'succeeded' && receipt.state.phase !== 'failed' && receipt.state.phase !== 'partial'
  const inheritedFrom = (row: ChatRoleRow) => {
    const from = parseScopeKey(row.key)
    if (!from) return row.key
    return from.level === 'global' ? i18n.t('全局') : `${i18n.t(SCOPE_LEVEL_LABELS[from.level])} ${row.key}`
  }
  return (
    <>
      <ObjectSection
        title={i18n.t('聊天角色')}
        description={i18n.t('所有者 ⊃ 管理员 ⊃ 受信任。在某一层授予的角色对其下所有范围有效；平台群主、管理员按映射规则只在所在会话得到管理员。')}
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
              {direct.length ? <RoleTable rows={direct} label={i18n.t('在这一层授予')} busy={busy} onRevoke={prepareRevoke} inheritedFrom={inheritedFrom} />
                : <p className="console-chat-role-empty">{i18n.t('这一层没有直接授予的角色。')}</p>}
            </Card>
            {inherited.length ? (
              <Card className="overflow-hidden p-0">
                <h3 className="console-chat-role-card-title">{i18n.t('从上级继承与其他来源')}<span>{inherited.length}</span></h3>
                <RoleTable rows={inherited} label={i18n.t('从上级继承与其他来源')} busy={busy} onRevoke={prepareRevoke} inheritedFrom={inheritedFrom} />
              </Card>
            ) : null}
          </>
        )}
        <ActionReceipt controller={receipt} />
      </ObjectSection>
      <ObjectSection title={i18n.t('授予角色')} description={alias ? i18n.t('身份属于适配器 {0}。', [alias]) : i18n.t('全局角色可为每个平台登记一个身份。')}>
        <Card className="grid gap-3 p-4 md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,10rem)_auto] md:items-end">
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
            <SelectField aria-label={i18n.t('角色')} value={role} onValueChange={value => setRole(value as ChatRole)}
              options={CHAT_ROLES.map(value => ({ value, label: i18n.t(CHAT_ROLE_LABELS[value]) }))} />
          </div>
          <Button onClick={prepareGrant} disabled={busy || !userId.trim() || (!alias && !platform.trim())}><Plus />{i18n.t('授予')}</Button>
        </Card>
        {formError ? <p role="alert" className="text-sm text-destructive">{i18n.t('无法授予：{0}', [formError])}</p> : null}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{i18n.t('聊天角色只影响机器人在聊天里的权限，不影响 Console 登录与权限。')}</p>
      </ObjectSection>
      <ChatRoleMappingsSection scope={scope} />
    </>
  )
}

function readHidden(): boolean {
  try { return window.localStorage.getItem(CHAT_ROLE_MAPPINGS_HIDDEN_KEY) === '1' } catch { return false }
}

function writeHidden(hidden: boolean) {
  try { window.localStorage.setItem(CHAT_ROLE_MAPPINGS_HIDDEN_KEY, hidden ? '1' : '0') } catch { /* per-viewer convenience only */ }
}

/**
 * 映射规则 (ADR 0056 §4): which platform standings (群主 / 管理员 …) become which chat role, layer by
 * layer. Read-only while the protocol settles; a Host without `chat-roles.mappings` shows
 * 「需要新版 Host」. The section can be collapsed (remembered in this browser).
 */
function ChatRoleMappingsSection({ scope }: { scope: Scope }) {
  const i18n = useI18n()
  const [hidden, setHidden] = useState(readHidden)
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'failed'; value: ChatRoleMappings | null; error: unknown }>({ status: 'loading', value: null, error: null })
  const request = chatRoleMappingsRequest(scope)
  const body = request ? JSON.stringify(request) : ''
  const load = useCallback(() => {
    if (!body) return () => {}
    let cancelled = false
    setState(previous => ({ ...previous, status: 'loading' }))
    requestConsole<unknown>(JSON.parse(body)).then(
      payload => { if (!cancelled) setState({ status: 'ready', value: readChatRoleMappings(payload), error: null }) },
      (error: unknown) => { if (!cancelled) setState({ status: 'failed', value: null, error }) },
    )
    return () => { cancelled = true }
  }, [body])
  useEffect(() => hidden ? undefined : load(), [hidden, load])
  const toggle = () => setHidden(previous => { writeHidden(!previous); return !previous })
  const standing = (value: string) => Object.hasOwn(PLATFORM_STANDING_LABELS, value) ? i18n.t(PLATFORM_STANDING_LABELS[value as PlatformStanding]) : value
  const describe = (match: Parameters<typeof mappingMatchParts>[0]) => {
    const parts = mappingMatchParts(match)
    return [
      parts.standing.length ? i18n.t('平台身份：{0}', [parts.standing.map(standing).join(' / ')]) : '',
      parts.role.length ? i18n.t('平台角色：{0}', [parts.role.join(' / ')]) : '',
      parts.permission.length ? i18n.t('平台权限：{0}', [parts.permission.join(' / ')]) : '',
    ].filter(Boolean).join('；') || i18n.t('任何人')
  }
  return (
    <ObjectSection title={i18n.t('映射规则')}
      description={i18n.t('平台上的群主、管理员等身份按这些规则在会话里得到聊天角色，逐层继承。')}
      actions={<Button variant="ghost" size="sm" aria-expanded={!hidden} onClick={toggle}>{hidden ? <ChevronRight /> : <ChevronDown />}{hidden ? i18n.t('显示') : i18n.t('隐藏')}</Button>}>
      {hidden ? null : !request ? (
        <StatusState kind="empty" compact title={i18n.t('全局没有映射规则')} description={i18n.t('映射规则从适配器层开始设置（内置默认：平台群主、管理员在所在会话得到管理员）。打开某个适配器、账号或会话查看。')} />
      ) : state.status === 'loading' ? <Skeleton className="h-20" />
        : state.status === 'failed' ? (
          <StatusState compact error={state.error} onRetry={load}
            {...(statusFromError(state.error).kind === 'unsupported' ? { title: i18n.t('需要新版 Host'), description: i18n.t('当前 Host 还不能列出映射规则（chat-roles.mappings）。升级后这里会显示每一层的规则与最终生效的规则。') } : {})} />
        ) : state.value && state.value.effective.length ? (
          <Card className="overflow-hidden p-0">
            <Table aria-label={i18n.t('生效的映射规则')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{i18n.t('条件')}</TableHead>
                  <TableHead>{i18n.t('得到')}</TableHead>
                  <TableHead>{i18n.t('来源')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.value.effective.map((rule, index) => (
                  <TableRow key={index}>
                    <TableCell className="text-sm">{describe(rule.match)}</TableCell>
                    <TableCell>{rule.grant === 'none' ? null : <Badge variant={ROLE_BADGE[rule.grant]} size="sm">{i18n.t(CHAT_ROLE_LABELS[rule.grant])}</Badge>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{i18n.t(CHAT_ROLE_MAPPING_LEVEL_LABELS[rule.level])}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {state.value.layers.some(layer => !layer.inherit) ? (
              <p className="console-chat-role-empty">{i18n.t('有一层设置了「不继承」：上面的规则只来自这一层及以下。')}</p>
            ) : null}
          </Card>
        ) : (
          <StatusState kind="empty" compact title={i18n.t('没有生效的映射规则')} description={i18n.t('平台身份在这里不会自动得到聊天角色。')} />
        )}
    </ObjectSection>
  )
}
