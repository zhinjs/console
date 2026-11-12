import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
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
  CHAT_ROLE_LABELS, CHAT_ROLE_SOURCE_LABELS, CHAT_ROLES, chatRoleApplied, chatRoleGrantRequest, chatRoleRevokeRequest, chatRoleRows,
  chatRolesListRequest, readChatRoleChange, readChatRoles, type ChatRole, type ChatRoleEntry, type ChatRoleRow,
} from './chat-roles-model.mjs'
import { SCOPE_LEVEL_LABELS, parseScopeKey, scopeHref, scopeKey, type Scope } from './scope-tree.mjs'

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

/**
 * 角色 tab of every object page (ADR 0056): chat roles granted here, inherited from above, and
 * the config / platform-mapping entries the Host reports, each with its source. Grant and revoke
 * go through an ActionReceipt; an unknown outcome is only re-read, never resent.
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
  const prepareGrant = () => {
    const adapter = alias ?? platform.trim()
    let plan
    try {
      chatRoleGrantRequest(scope, { adapter, userId, role })
      plan = {
        title: i18n.t('授予 {0}：{1} / {2}', [i18n.t(CHAT_ROLE_LABELS[role]), adapter, userId.trim()]),
        summary: i18n.t('在这一层及其下所有范围生效。授予者需要不低于该角色的权限。'),
        confirmLabel: i18n.t('授予'),
        danger: role === 'owner',
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
      return
    }
    setFormError(null)
    pendingAction.current = { action: 'grant', adapter, userId: userId.trim(), role }
    receipt.prepare(plan)
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
          <Card className="overflow-hidden p-0">
            <Table aria-label={i18n.t('聊天角色')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{i18n.t('身份')}</TableHead>
                  <TableHead>{i18n.t('角色')}</TableHead>
                  <TableHead>{i18n.t('来源')}</TableHead>
                  <TableHead>{i18n.t('作用范围')}</TableHead>
                  <TableHead className="text-right">{i18n.t('操作')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell><code className="text-sm">{row.adapter} / {row.userId}</code></TableCell>
                    <TableCell><Badge variant={row.role === 'owner' ? 'warning' : row.role === 'admin' ? 'info' : 'outline'}>{i18n.t(CHAT_ROLE_LABELS[row.role])}</Badge></TableCell>
                    <TableCell>
                      <span className="inline-flex flex-col">
                        <span>{i18n.t(CHAT_ROLE_SOURCE_LABELS[row.source])}</span>
                        {row.detail ? <code className="text-xs text-muted-foreground">{row.detail}</code> : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.relation === 'direct' ? <Badge variant="secondary" size="sm">{i18n.t('本层')}</Badge>
                        : row.relation === 'inherited'
                          ? <Link className="text-sm underline" to={scopeHref(parseScopeKey(row.key) ?? {}, 'roles')}>{i18n.t('继承自 {0}', [inheritedFrom(row)])}</Link>
                          : <span className="text-sm text-muted-foreground">{row.key}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.revocable ? (
                        <Button variant="ghost" size="sm" onClick={() => prepareRevoke(row)} disabled={busy} aria-label={i18n.t('撤销 {0}', [`${row.adapter} / ${row.userId}`])}><Trash2 />{i18n.t('撤销')}</Button>
                      ) : <span className="text-xs text-muted-foreground">{row.source === 'grant' ? i18n.t('在上级撤销') : i18n.t('不可在此撤销')}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </ObjectSection>
      <ObjectSection title={i18n.t('授予角色')} description={alias ? i18n.t('身份属于适配器 {0}。', [alias]) : i18n.t('全局角色可为每个平台登记一个身份。')}>
        <Card className="grid gap-3 p-4 md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,10rem)_auto] md:items-end">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{i18n.t('适配器')}</span>
            <Input value={alias ?? platform} onChange={event => setPlatform(event.target.value)} disabled={Boolean(alias)} placeholder="qq" />
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
        <ActionReceipt controller={receipt} />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{i18n.t('聊天角色只影响机器人在聊天里的权限，不影响 Console 登录与权限。')}</p>
      </ObjectSection>
    </>
  )
}
