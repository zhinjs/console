import { useId, useMemo, useRef, useState } from 'react'
import { KeyRound, MoreHorizontal, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { StatusState } from '../../components/StatusState'
import { ActionReceipt, useActionReceipt } from '../../components/ActionReceipt'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { useToast } from '../../components/toast'
import {
  IAM_RPC, bindingInputs, breaksLastOwner, displayNameProblem, isGlobalOwner, passwordProblem, readRoles, readUsers, usernameProblem,
  type IamBinding, type IamRole, type IamUser,
} from './access-model.mjs'
import { BindingBadges, BindingsEditor, FormField, IamLoadError, ReadOnlyNotice } from './access-components'
import { iamRequest, useCanManageIam, useIamRead, useIamUsers } from './use-iam'
import '../admin-pages.css'

type Pending =
  | { kind: 'create' }
  | { kind: 'profile'; user: IamUser }
  | { kind: 'bindings'; user: IamUser }
  | { kind: 'password'; user: IamUser }
  | { kind: 'delete'; user: IamUser }

const EMPTY_ROLES: IamRole[] = []

export default function AccessUsersPage() {
  const i18n = useI18n()
  const toast = useToast()
  const canManage = useCanManageIam()
  const users = useIamUsers()
  const roles = useIamRead(IAM_RPC.ROLES_LIST, readRoles, EMPTY_ROLES)
  const [pending, setPending] = useState<Pending | null>(null)
  const close = () => setPending(null)
  const done = (message: string) => { toast.success(message); users.refresh() }
  // Enable / disable goes through the receipt (禁用 is a danger plan); the target rides in a ref.
  const target = useRef<{ user: IamUser; disabled: boolean } | null>(null)
  const receipt = useActionReceipt({
    submit: async () => {
      const current = target.current
      if (!current) throw new Error('no target')
      await iamRequest(IAM_RPC.USERS_DISABLE, { id: current.user.id, disabled: current.disabled }, i18n.t)
    },
    verify: async () => {
      const current = target.current
      if (!current) return undefined
      const reply = await iamRequest<unknown>(IAM_RPC.USERS_LIST, {}, i18n.t)
      const found = readUsers(reply).find(user => user.id === current.user.id)
      return { applied: found ? found.disabled === current.disabled : undefined }
    },
    onSettled: () => users.refresh(),
  })
  const prepareDisabled = (user: IamUser, disabled: boolean) => {
    target.current = { user, disabled }
    const lastOwner = disabled && breaksLastOwner(users.data, user.id, { disable: true })
    receipt.prepare(disabled ? {
      title: i18n.t('禁用用户 {0}', [user.username]),
      changes: [
        i18n.t('{0} 的会话和 API 令牌立即失效', [user.username]),
        i18n.t('之后无法登录，直到重新启用'),
        ...(lastOwner ? [i18n.t('这是最后一个启用的所有者，Host 会拒绝禁用；请先给另一个用户绑定全局所有者')] : []),
      ],
      danger: true,
      confirmLabel: i18n.t('禁用'),
    } : {
      title: i18n.t('启用用户 {0}', [user.username]),
      changes: [i18n.t('{0} 可以重新登录，角色绑定保持不变', [user.username])],
      confirmLabel: i18n.t('启用'),
    })
  }
  const remove = async (user: IamUser) => {
    await iamRequest(IAM_RPC.USERS_DELETE, { id: user.id }, i18n.t)
    done(i18n.t("已删除 {0}", [user.username]))
  }
  const busy = receipt.state.phase === 'submitting' || receipt.state.phase === 'verifying'

  return (
    <PageShell>
      <PageHeader
        title={i18n.t("用户")}
        description={i18n.t("能登录 Console 的账号与它们的角色绑定。禁用、删除或改密码会让该用户的会话立即失效。")}
        actions={<>
          <Button variant="outline" size="sm" onClick={users.refresh} disabled={users.loading}><RefreshCw className={users.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
          {canManage ? <Button size="sm" onClick={() => setPending({ kind: 'create' })} disabled={!roles.loaded}><Plus />{i18n.t("新建用户")}</Button> : null}
        </>}
      />
      {!canManage ? <ReadOnlyNotice /> : null}
      <ActionReceipt controller={receipt} />
      {users.error && !users.loaded ? <IamLoadError error={users.error} kind={users.errorKind} failure={users.failure} onRetry={users.refresh} /> : (
        <Card className="overflow-hidden p-0">
          {users.error ? <IamLoadError error={users.error} kind={users.errorKind} failure={users.failure} onRetry={users.refresh} /> : null}
          {users.loading && !users.loaded ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9" />)}</div>
          ) : !users.data.length ? (
            <StatusState kind="empty" title={i18n.t("还没有用户")} description={i18n.t("初始化完成后，所有者会出现在这里。用「新建用户」给同事开账号。")} />
          ) : (
            <Table aria-label={i18n.t("用户")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{i18n.t("用户")}</TableHead>
                  <TableHead className="hidden md:table-cell">{i18n.t("角色")}</TableHead>
                  <TableHead>{i18n.t("状态")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{i18n.t("密码修改于")}</TableHead>
                  {canManage ? <TableHead><span className="sr-only">{i18n.t("操作")}</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.map(user => (
                  <TableRow key={user.id}>
                    <TableCell className="min-w-0">
                      <div className="font-medium break-words">{user.displayName}</div>
                      <code className="console-access-id" title={user.username}>{user.username}</code>
                      <div className="mt-1 md:hidden"><BindingBadges bindings={user.bindings} /></div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell"><BindingBadges bindings={user.bindings} /></TableCell>
                    <TableCell>
                      {user.disabled
                        ? <Badge variant="outline" className="whitespace-nowrap">{i18n.t("已禁用")}</Badge>
                        : <Badge variant="success" className="whitespace-nowrap">{i18n.t("启用")}</Badge>}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                      {user.passwordChangedAt ? i18n.date(user.passwordChangedAt, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => setPending({ kind: 'bindings', user })} disabled={!roles.loaded}><ShieldCheck />{i18n.t("角色")}</Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={i18n.t("管理 {0}", [user.username])} disabled={busy}><MoreHorizontal /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setPending({ kind: 'profile', user })}><Pencil />{i18n.t("修改显示名")}</DropdownMenuItem>
                              <DropdownMenuItem disabled={!roles.loaded} onSelect={() => setPending({ kind: 'bindings', user })}><ShieldCheck />{i18n.t("角色绑定")}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setPending({ kind: 'password', user })}><KeyRound />{i18n.t("重置密码")}</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => prepareDisabled(user, !user.disabled)}>
                                {user.disabled ? <UserCheck /> : <UserX />}{user.disabled ? i18n.t("启用") : i18n.t("禁用")}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onSelect={() => setPending({ kind: 'delete', user })}><Trash2 />{i18n.t("删除")}</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {pending?.kind === 'create' ? (
        <CreateUserDialog roles={roles.data} onClose={close} onCreated={user => { close(); done(i18n.t("已创建 {0}", [user])) }} />
      ) : null}
      {pending?.kind === 'profile' ? (
        <ProfileDialog user={pending.user} onClose={close} onSaved={() => { close(); done(i18n.t("已更新 {0} 的显示名", [pending.user.username])) }} />
      ) : null}
      {pending?.kind === 'bindings' ? (
        <BindingsDialog user={pending.user} users={users.data} roles={roles.data} onClose={close}
          onSaved={() => { close(); done(i18n.t("已更新 {0} 的角色", [pending.user.username])) }} />
      ) : null}
      {pending?.kind === 'password' ? (
        <ResetPasswordDialog user={pending.user} onClose={close} onDone={() => { close(); toast.success(i18n.t("已重置 {0} 的密码，其会话已全部失效", [pending.user.username])) }} />
      ) : null}
      {pending?.kind === 'delete' ? (
        <ConfirmDialog open onOpenChange={open => { if (!open) close() }} variant="destructive"
          title={i18n.t("删除 {0}？", [pending.user.username])}
          description={breaksLastOwner(users.data, pending.user.id, { remove: true })
            ? i18n.t("这是最后一个启用的所有者，Host 会拒绝删除。请先给另一个用户绑定全局所有者。")
            : i18n.t("删除后不可恢复：该用户的会话、API 令牌和角色绑定一并删除。")}
          confirmLabel={i18n.t("删除")}
          confirmText={pending.user.username}
          onConfirm={() => remove(pending.user)} />
      ) : null}
    </PageShell>
  )
}

/** `iam.users.update { id, displayName }` (ADR 0049 §5). The username never changes. */
function ProfileDialog({ user, onClose, onSaved }: { user: IamUser; onClose: () => void; onSaved: () => void }) {
  const i18n = useI18n()
  const id = useId()
  const [displayName, setDisplayName] = useState(user.displayName)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const problem = displayNameProblem(displayName, i18n.t)
  const submit = async () => {
    setTouched(true)
    if (problem) return
    setSaving(true)
    setError(null)
    try {
      await iamRequest(IAM_RPC.USERS_UPDATE, { id: user.id, displayName: displayName.trim() }, i18n.t)
      onSaved()
    } catch (caught) {
      setError(caught)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{i18n.t("修改 {0} 的显示名", [user.username])}</DialogTitle>
          <DialogDescription>{i18n.t("显示名出现在顶栏、审计日志和用户列表里。用户名用于登录，创建后不能修改。")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit() }}>
          <FormField htmlFor={`${id}-username`} label={i18n.t("用户名")} hint={i18n.t("用于登录，不能修改")}>
            <Input id={`${id}-username`} value={user.username} disabled readOnly />
          </FormField>
          <FormField htmlFor={`${id}-display`} label={i18n.t("显示名")} error={touched ? problem : null} hint={i18n.t("最多 128 个字符")}>
            <Input id={`${id}-display`} value={displayName} maxLength={128} autoComplete="off" disabled={saving} onChange={event => setDisplayName(event.target.value)} />
          </FormField>
          {error ? <StatusState compact error={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>{i18n.t("取消")}</Button>
            <Button type="submit" size="sm" disabled={saving}>{saving ? i18n.t("处理中...") : i18n.t("保存")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CreateUserDialog({ roles, onClose, onCreated }: { roles: readonly IamRole[]; onClose: () => void; onCreated: (username: string) => void }) {
  const i18n = useI18n()
  const id = useId()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [bindings, setBindings] = useState<readonly IamBinding[]>([])
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameError = usernameProblem(username, i18n.t)
  const passwordError = passwordProblem(password, confirm, i18n.t)
  const submit = async () => {
    setTouched(true)
    if (nameError || passwordError) return
    setSaving(true)
    setError(null)
    try {
      await iamRequest(IAM_RPC.USERS_CREATE, {
        username: username.trim().toLowerCase(),
        password,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        bindings: bindingInputs(bindings),
      }, i18n.t)
      onCreated(username.trim().toLowerCase())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{i18n.t("新建用户")}</DialogTitle>
          <DialogDescription>{i18n.t("把初始密码通过可信渠道交给对方，并请对方登录后在个人设置里修改。")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit() }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField htmlFor={`${id}-username`} label={i18n.t("用户名")} error={touched ? nameError : null}>
              <Input id={`${id}-username`} value={username} autoComplete="off" spellCheck={false} onChange={event => setUsername(event.target.value)} />
            </FormField>
            <FormField htmlFor={`${id}-display`} label={i18n.t("显示名（可选）")}>
              <Input id={`${id}-display`} value={displayName} autoComplete="off" onChange={event => setDisplayName(event.target.value)} />
            </FormField>
            <FormField htmlFor={`${id}-password`} label={i18n.t("初始密码")} hint={i18n.t("至少 10 位")} error={touched && password.length < 10 ? passwordError : null}>
              <Input id={`${id}-password`} type="password" value={password} autoComplete="new-password" onChange={event => setPassword(event.target.value)} />
            </FormField>
            <FormField htmlFor={`${id}-confirm`} label={i18n.t("确认密码")} error={touched && password.length >= 10 ? passwordError : null}>
              <Input id={`${id}-confirm`} type="password" value={confirm} autoComplete="new-password" onChange={event => setConfirm(event.target.value)} />
            </FormField>
          </div>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{i18n.t("角色绑定")}</h3>
            <BindingsEditor bindings={bindings} roles={roles} onChange={setBindings} disabled={saving} />
          </section>
          {error ? <p role="alert" className="text-sm text-destructive break-words">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>{i18n.t("取消")}</Button>
            <Button type="submit" size="sm" disabled={saving}>{saving ? i18n.t("处理中...") : i18n.t("创建")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BindingsDialog({ user, users, roles, onClose, onSaved }: {
  user: IamUser; users: readonly IamUser[]; roles: readonly IamRole[]; onClose: () => void; onSaved: () => void
}) {
  const i18n = useI18n()
  const [bindings, setBindings] = useState<readonly IamBinding[]>(user.bindings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastOwner = useMemo(() => breaksLastOwner(users, user.id, { bindings }), [users, user.id, bindings])
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await iamRequest(IAM_RPC.BINDINGS_SET, { userId: user.id, bindings: bindingInputs(bindings) }, i18n.t)
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{i18n.t("{0} 的角色", [user.username])}</DialogTitle>
          <DialogDescription>{i18n.t("保存会替换该用户的全部绑定；已建立的长连接（终端、事件流）会按新权限重新授权。")}</DialogDescription>
        </DialogHeader>
        <BindingsEditor bindings={bindings} roles={roles} onChange={setBindings} disabled={saving} />
        {lastOwner ? <p role="note" className="text-sm text-[hsl(var(--warning))]">{i18n.t("这是最后一个所有者：移除其全局所有者绑定会被 Host 拒绝。")}</p> : null}
        {isGlobalOwner(user) && !lastOwner && !bindings.some(item => item.role === 'owner' && item.scope.kind === 'global')
          ? <p role="note" className="text-sm text-muted-foreground">{i18n.t("该用户将不再是所有者。")}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive break-words">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>{i18n.t("取消")}</Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>{saving ? i18n.t("处理中...") : i18n.t("保存")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: IamUser; onClose: () => void; onDone: () => void }) {
  const i18n = useI18n()
  const id = useId()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = passwordProblem(password, confirm, i18n.t)
  const submit = async () => {
    setTouched(true)
    if (problem) return
    setSaving(true)
    setError(null)
    try {
      await iamRequest(IAM_RPC.USERS_RESET_PASSWORD, { id: user.id, password }, i18n.t)
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{i18n.t("重置 {0} 的密码", [user.username])}</DialogTitle>
          <DialogDescription>{i18n.t("该用户的所有会话会立即失效，API 令牌不受影响。")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit() }}>
          <FormField htmlFor={`${id}-password`} label={i18n.t("新密码")} hint={i18n.t("至少 10 位")} error={touched && password.length < 10 ? problem : null}>
            <Input id={`${id}-password`} type="password" value={password} autoComplete="new-password" onChange={event => setPassword(event.target.value)} />
          </FormField>
          <FormField htmlFor={`${id}-confirm`} label={i18n.t("确认密码")} error={touched && password.length >= 10 ? problem : null}>
            <Input id={`${id}-confirm`} type="password" value={confirm} autoComplete="new-password" onChange={event => setConfirm(event.target.value)} />
          </FormField>
          {error ? <p role="alert" className="text-sm text-destructive break-words">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>{i18n.t("取消")}</Button>
            <Button type="submit" size="sm" variant="destructive" disabled={saving}>{saving ? i18n.t("处理中...") : i18n.t("重置密码")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
