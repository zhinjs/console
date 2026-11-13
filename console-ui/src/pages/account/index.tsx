import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw, Trash2, UserCog } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { StatusState } from '../../components/StatusState'
import { ActionReceipt, useActionReceipt } from '../../components/ActionReceipt'
import { receiptBlocksActions } from '../../components/action-receipt-model.mjs'
import { useToast } from '../../components/toast'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { useConsoleSession } from '../../hooks/use-console-session'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { requestSetup } from '../../utils/console-session.mjs'
import { changeOwnPassword, createOwnToken, listOwnTokens, revokeOwnToken } from '../../utils/console-auth-api'
import {
  MIN_PASSWORD_LENGTH, TOKEN_EXPIRY_DAYS, authErrorMessage, newPasswordProblem, principalLabel, tokenExpiresAt,
  tokenNameProblem, tokenState, type AuthFailure,
} from '../../utils/console-auth-model.mjs'
import { CONSOLE_PATHS as P } from '../../console-routes.mjs'
import { builtinRoleLabel, scopeLabel } from '../access/access-model.mjs'
import { IssuedTokenDialog } from '../access/tokens'
import type { ConsoleApiTokenView, ConsoleMe } from '../../contracts/console-auth'
import '../admin-pages.css'

/** Personal settings (ADR 0049 §5): who I am, change my password, my API tokens (`/auth/tokens`). */
export default function AccountPage() {
  const i18n = useI18n()
  const { me, legacy } = useConsoleSession()
  const signedInUser = me?.kind === 'user' || me?.kind === 'api-token'

  return <PageShell>
    <PageHeader title={i18n.t('个人设置')} description={i18n.t('你的身份、密码与 API 令牌。这些都由管理网关保存，实例离线时也能修改。')} />
    {!signedInUser ? (
      legacy ? <StatusState kind="unsupported" description={i18n.t('此 Host 版本较旧，不支持账号：升级 Host 后用账号登录，这里会出现个人设置。')} />
        : me?.kind === 'bootstrap' ? (
          <StatusState kind="empty" title={i18n.t('还没有账号')}
            description={me.open
              ? i18n.t('本机以开放模式运行，没有账号可改。创建第一个所有者后，用账号登录即可修改密码和签发令牌。')
              : i18n.t('你正在使用初始化令牌。先完成初始化、创建所有者，再用账号登录。')}
            actions={<Button size="sm" onClick={() => requestSetup(true)}>{i18n.t('创建所有者')}</Button>} />
        ) : <StatusState kind="empty" title={i18n.t('没有用账号登录')} description={i18n.t('当前没有用账号登录，没有个人设置可改。退出后用账号重新登录。')} />
    ) : null}
    {me && signedInUser ? <>
      <IdentitySection me={me} />
      {me.kind === 'user' ? <PasswordSection /> : null}
      <TokensSection />
    </> : null}
  </PageShell>
}

function IdentitySection({ me }: { me: ConsoleMe }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const canManageUsers = hasConsolePermission('iam.manage', access)
  const roles = me.bindings.filter(binding => binding.role)
  return <ObjectSection title={i18n.t('身份')} description={me.kind === 'api-token' ? i18n.t('当前通过 API 令牌访问，权限不超过令牌所属用户。') : i18n.t('当前通过账号登录访问。')}>
    <Card className="console-admin-card">
      <dl className="console-object-facts">
        <div><dt>{i18n.t('显示名')}</dt><dd>{principalLabel(me, i18n.t)}</dd></div>
        <div><dt>{i18n.t('用户名')}</dt><dd><code className="console-access-id" title={me.user?.username}>{me.user?.username ?? '—'}</code></dd></div>
        <div><dt>{i18n.t('登录方式')}</dt><dd>{me.kind === 'api-token' ? i18n.t('API 令牌') : i18n.t('账号密码')}</dd></div>
        <div><dt>{i18n.t('全局权限')}</dt><dd>{i18n.t('{0} 项', [me.permissions.length])}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2" aria-label={i18n.t('角色')}>
        {roles.length ? roles.map((binding, index) => (
          <Badge key={`${binding.role}-${index}`} variant={binding.role === 'owner' && binding.scope.kind === 'global' ? 'info' : 'secondary'}>
            {builtinRoleLabel(binding.role ?? '', i18n.t) ?? binding.role} · {scopeLabel(binding.scope, i18n.t)}
          </Badge>
        )) : <span className="console-admin-note">{i18n.t('没有分配角色：请联系所有者在「访问控制 → 用户」里绑定角色。')}</span>}
      </div>
      <p className="console-admin-note">
        {canManageUsers
          ? <>{i18n.t('显示名和角色在「访问控制 → 用户」修改。')} <Link className="underline" to={P.accessUsers}>{i18n.t('打开用户列表')}</Link></>
          : i18n.t('显示名和角色由有 iam.manage 权限的管理员修改。')}
      </p>
    </Card>
  </ObjectSection>
}

function PasswordSection() {
  const i18n = useI18n()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!current) { setError(i18n.t('请输入当前密码。')); return }
    const problem = newPasswordProblem(next, confirm)
    if (problem === 'empty') { setError(i18n.t('请输入新密码。')); return }
    if (problem === 'short') { setError(i18n.t('密码至少 {0} 位。', [MIN_PASSWORD_LENGTH])); return }
    if (problem === 'mismatch') { setError(i18n.t('两次输入的密码不一致。')); return }
    setBusy(true)
    setError('')
    const result = await changeOwnPassword(current, next)
    setBusy(false)
    if (!result.ok) { setError(authErrorMessage(result, i18n.t, 'password')); return }
    setCurrent(''); setNext(''); setConfirm('')
    toast.success(i18n.t('密码已修改。其他设备上的登录已全部退出。'))
  }

  const row = (id: string, label: string, value: string, set: (value: string) => void, autoComplete: string) => <div className="space-y-1.5">
    <label htmlFor={id} className="block text-sm font-medium">{label}</label>
    <Input id={id} type="password" autoComplete={autoComplete} value={value} disabled={busy}
      onChange={event => { set(event.target.value); setError('') }} />
  </div>

  return <ObjectSection title={i18n.t('修改密码')} description={i18n.t('修改后，你在其他设备上的登录会全部退出；这里会自动换成新的登录。')}>
    <Card className="console-admin-card">
      <form className="console-admin-form" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
        {row('account-current-password', i18n.t('当前密码'), current, setCurrent, 'current-password')}
        {row('account-new-password', i18n.t('新密码'), next, setNext, 'new-password')}
        {row('account-confirm-password', i18n.t('确认新密码'), confirm, setConfirm, 'new-password')}
        <p className="console-admin-note">{i18n.t('至少 {0} 位。', [MIN_PASSWORD_LENGTH])}</p>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div><Button type="submit" disabled={busy}>{busy ? i18n.t('保存中…') : i18n.t('修改密码')}</Button></div>
      </form>
    </Card>
  </ObjectSection>
}

function TokensSection() {
  const i18n = useI18n()
  const [tokens, setTokens] = useState<readonly ConsoleApiTokenView[] | null>(null)
  const [loadError, setLoadError] = useState<AuthFailure | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listOwnTokens()
    setLoading(false)
    if (result.ok) { setTokens(result.data); setLoadError(null) } else setLoadError(result)
  }, [])
  useEffect(() => { void load() }, [load])

  const receipt = useActionReceipt({
    submit: async plan => {
      const target = plan.payload as ConsoleApiTokenView | undefined
      if (!target) throw new Error('no target')
      const result = await revokeOwnToken(target.id)
      if (!result.ok) return { status: 'failed', message: authErrorMessage(result, i18n.t, 'tokens') }
    },
    verify: async plan => {
      const current = plan.payload as ConsoleApiTokenView | undefined
      const result = await listOwnTokens()
      if (!result.ok || !current) return undefined
      setTokens(result.data)
      return { applied: !result.data.some(token => token.id === current.id) }
    },
    onSettled: () => { void load() },
  })
  const prepareRevoke = (token: ConsoleApiTokenView) => {
    receipt.prepare({
      payload: token,
      title: i18n.t('吊销令牌 {0}', [token.name]),
      changes: [i18n.t('使用这个令牌的脚本会立即无法访问'), i18n.t('吊销不可恢复；需要时重新签发一个新令牌')],
      danger: true,
      confirmLabel: i18n.t('吊销'),
    })
  }

  const when = (value: number | null) => value ? i18n.date(value, { dateStyle: 'medium', timeStyle: 'short' }) : '—'

  return <ObjectSection title={i18n.t('我的 API 令牌')}
    description={i18n.t('给脚本和自动化使用（环境变量 ZHIN_CONSOLE_TOKEN）。令牌的权限不超过你自己的权限。')}
    actions={<>
      <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>
      <Button size="sm" onClick={() => setCreating(true)}><Plus />{i18n.t('新建令牌')}</Button>
    </>}>
    <ActionReceipt controller={receipt} />
    {loadError ? <StatusState kind={loadError.code === 'database_busy' ? 'database-busy' : 'error'} description={authErrorMessage(loadError, i18n.t, 'tokens')} onRetry={() => void load()} /> : null}
    {!tokens && loading ? <StatusState kind="loading" placeholder={<Skeleton className="h-24" />} /> : null}
    {tokens && tokens.length === 0 ? <StatusState kind="empty" title={i18n.t('还没有 API 令牌')} description={i18n.t('新建一个令牌后，在脚本里用它代替你的密码。')} /> : null}
    {tokens && tokens.length > 0 ? <Card className="overflow-hidden p-0"><Table aria-label={i18n.t('我的 API 令牌')}>
      <TableHeader><TableRow>
        <TableHead>{i18n.t('名称')}</TableHead>
        <TableHead className="hidden md:table-cell">{i18n.t('权限')}</TableHead>
        <TableHead className="hidden lg:table-cell">{i18n.t('创建于')}</TableHead>
        <TableHead className="hidden md:table-cell">{i18n.t('最近使用')}</TableHead>
        <TableHead>{i18n.t('过期时间')}</TableHead>
        <TableHead><span className="sr-only">{i18n.t('操作')}</span></TableHead>
      </TableRow></TableHeader>
      <TableBody>{tokens.map(token => <TableRow key={token.id}>
        <TableCell className="min-w-0"><div className="font-medium break-words">{token.name}</div><code className="console-access-id" title={token.id}>{token.id}</code></TableCell>
        <TableCell className="hidden md:table-cell">{token.permissions === null ? i18n.t('与我相同') : i18n.t('{0} 项', [token.permissions.length])}</TableCell>
        <TableCell className="hidden lg:table-cell">{when(token.createdAt)}</TableCell>
        <TableCell className="hidden md:table-cell">{token.lastUsedAt ? when(token.lastUsedAt) : i18n.t('从未使用')}</TableCell>
        <TableCell>{token.expiresAt === null ? i18n.t('永不过期') : <>
          {when(token.expiresAt)}{tokenState(token) === 'expired' && <Badge variant="outline" className="ml-2">{i18n.t('已过期')}</Badge>}
        </>}</TableCell>
        <TableCell className="text-right">
          <Button size="sm" variant="ghost" className="text-destructive" aria-label={i18n.t('吊销 {0}', [token.name])} disabled={receiptBlocksActions(receipt.state)} onClick={() => prepareRevoke(token)}><Trash2 /><span className="hidden sm:inline">{i18n.t('吊销')}</span></Button>
        </TableCell>
      </TableRow>)}</TableBody>
    </Table></Card> : null}

    <CreateTokenDialog open={creating} onOpenChange={setCreating} onCreated={(name, token) => { setCreated({ name, token }); void load() }} />
    <IssuedTokenDialog issued={created} onClose={() => setCreated(null)} />
  </ObjectSection>
}

function CreateTokenDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (name: string, token: string) => void
}) {
  const i18n = useI18n()
  const [name, setName] = useState('')
  const [days, setDays] = useState(String(TOKEN_EXPIRY_DAYS[1]))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) { setName(''); setError(''); setDays(String(TOKEN_EXPIRY_DAYS[1])) } }, [open])

  const submit = async () => {
    const problem = tokenNameProblem(name)
    if (problem) { setError(problem === 'empty' ? i18n.t('请输入令牌名称。') : i18n.t('名称最多 128 个字符。')); return }
    setBusy(true)
    const result = await createOwnToken({ name: name.trim(), expiresAt: tokenExpiresAt(Number(days)) })
    setBusy(false)
    if (!result.ok) { setError(authErrorMessage(result, i18n.t, 'tokens')); return }
    onOpenChange(false)
    onCreated(result.data.record?.name ?? name.trim(), result.data.token)
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-md">
      <form noValidate onSubmit={event => { event.preventDefault(); void submit() }} className="grid gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserCog className="h-4 w-4" aria-hidden="true" />{i18n.t('新建 API 令牌')}</DialogTitle>
          <DialogDescription>{i18n.t('令牌拥有与你相同的权限。用途写清楚，方便以后吊销。')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor="account-token-name" className="block text-sm font-medium">{i18n.t('名称')}</label>
          <Input id="account-token-name" value={name} maxLength={128} disabled={busy} placeholder={i18n.t('例如：部署脚本')}
            onChange={event => { setName(event.target.value); setError('') }} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="account-token-expiry" className="block text-sm font-medium">{i18n.t('有效期')}</label>
          <SelectField id="account-token-expiry" value={days} disabled={busy} onValueChange={setDays}
            options={TOKEN_EXPIRY_DAYS.map(value => ({ value: String(value), label: value > 0 ? i18n.t('{0} 天', [value]) : i18n.t('永不过期') }))} />
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{i18n.t('取消')}</Button>
          <Button type="submit" disabled={busy}>{busy ? i18n.t('创建中…') : i18n.t('创建')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
