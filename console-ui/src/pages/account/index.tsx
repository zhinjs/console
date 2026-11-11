import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { EmptyState } from '../../components/empty-state'
import { useToast } from '../../components/toast'
import { useConsoleSession } from '../../hooks/use-console-session'
import { changeOwnPassword, createOwnToken, listOwnTokens, revokeOwnToken } from '../../utils/console-auth-api'
import {
  MIN_PASSWORD_LENGTH, TOKEN_EXPIRY_DAYS, authErrorMessage, newPasswordProblem, principalLabel, tokenExpiresAt,
  tokenNameProblem, tokenState, type AuthFailure,
} from '../../utils/console-auth-model.mjs'
import { copyText } from '../clipboard-copy.mjs'
import type { ConsoleApiTokenView, ConsoleMe } from '../../contracts/console-auth'

/** Personal settings (ADR 0049 §5): who I am, change my password, my API tokens (`/auth/tokens`). */
export default function AccountPage() {
  const i18n = useI18n()
  const { me, legacy } = useConsoleSession()
  const signedInUser = me?.kind === 'user' || me?.kind === 'api-token'

  return <PageShell>
    <PageHeader title={i18n.t('个人设置')} description={i18n.t('你的账号、密码与 API 令牌。')} />
    {!signedInUser && <Alert><AlertDescription>
      {legacy
        ? i18n.t('此 Host 版本较旧，不支持账号：请升级 Host 后使用账号登录。')
        : i18n.t('当前没有用账号登录，没有个人设置可改。')}
    </AlertDescription></Alert>}
    {me && signedInUser && <>
      <ProfileCard me={me} />
      <PasswordCard />
      <TokensCard />
    </>}
  </PageShell>
}

function ProfileCard({ me }: { me: ConsoleMe }) {
  const i18n = useI18n()
  const roles = [...new Set(me.bindings.map(binding => {
    const scope = binding.scope.kind === 'global' ? '' : ` @ ${binding.scope.key}`
    return `${binding.role ?? '?'}${scope}`
  }))]
  return <Card>
    <CardHeader><CardTitle className="text-base">{principalLabel(me, i18n.t)}</CardTitle>
      <CardDescription>{me.user?.username}</CardDescription></CardHeader>
    <CardContent className="space-y-2 text-sm">
      <p>{me.kind === 'api-token' ? i18n.t('当前通过 API 令牌访问。') : i18n.t('当前通过账号登录访问。')}</p>
      <div className="flex flex-wrap gap-2" aria-label={i18n.t('角色')}>
        {roles.length ? roles.map(role => <Badge key={role} variant="secondary">{role}</Badge>) : <span className="text-muted-foreground">{i18n.t('没有分配角色')}</span>}
      </div>
    </CardContent>
  </Card>
}

function PasswordCard() {
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

  const row = (id: string, label: string, value: string, set: (value: string) => void, autoComplete: string) => <div className="space-y-1">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <Input id={id} type="password" autoComplete={autoComplete} value={value} disabled={busy}
      onChange={event => { set(event.target.value); setError('') }} />
  </div>

  return <Card>
    <CardHeader><CardTitle className="text-base">{i18n.t('修改密码')}</CardTitle>
      <CardDescription>{i18n.t('修改后，你在其他设备上的登录会全部退出；这里会自动换成新的登录。')}</CardDescription></CardHeader>
    <CardContent>
      <form className="grid gap-3 max-w-md" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
        {row('account-current-password', i18n.t('当前密码'), current, setCurrent, 'current-password')}
        {row('account-new-password', i18n.t('新密码'), next, setNext, 'new-password')}
        {row('account-confirm-password', i18n.t('确认新密码'), confirm, setConfirm, 'new-password')}
        <p className="text-xs text-muted-foreground">{i18n.t('至少 {0} 位。', [MIN_PASSWORD_LENGTH])}</p>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div><Button type="submit" disabled={busy}>{busy ? i18n.t('保存中…') : i18n.t('修改密码')}</Button></div>
      </form>
    </CardContent>
  </Card>
}

function TokensCard() {
  const i18n = useI18n()
  const toast = useToast()
  const [tokens, setTokens] = useState<readonly ConsoleApiTokenView[] | null>(null)
  const [loadError, setLoadError] = useState<AuthFailure | null>(null)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null)
  const [revoking, setRevoking] = useState<ConsoleApiTokenView | null>(null)

  const load = useCallback(async () => {
    const result = await listOwnTokens()
    if (result.ok) { setTokens(result.data); setLoadError(null) } else setLoadError(result)
  }, [])
  useEffect(() => { void load() }, [load])

  const when = (value: number | null) => value ? i18n.date(value, { dateStyle: 'medium', timeStyle: 'short' }) : '—'

  return <Card>
    <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
      <div className="space-y-1">
        <CardTitle className="text-base">{i18n.t('我的 API 令牌')}</CardTitle>
        <CardDescription>{i18n.t('给脚本和自动化使用（环境变量 ZHIN_CONSOLE_TOKEN）。令牌的权限不超过你自己的权限。')}</CardDescription>
      </div>
      <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />{i18n.t('新建令牌')}</Button>
    </CardHeader>
    <CardContent>
      {loadError && <p className="text-sm text-destructive" role="alert">{authErrorMessage(loadError, i18n.t, 'tokens')}</p>}
      {tokens && tokens.length === 0 && <EmptyState icon={KeyRound} compact title={i18n.t('还没有 API 令牌')} description={i18n.t('新建一个令牌后，在脚本里用它代替你的密码。')} />}
      {tokens && tokens.length > 0 && <div className="overflow-x-auto"><Table>
        <TableHeader><TableRow>
          <TableHead>{i18n.t('名称')}</TableHead>
          <TableHead>{i18n.t('权限')}</TableHead>
          <TableHead>{i18n.t('创建于')}</TableHead>
          <TableHead>{i18n.t('最近使用')}</TableHead>
          <TableHead>{i18n.t('过期时间')}</TableHead>
          <TableHead><span className="sr-only">{i18n.t('操作')}</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{tokens.map(token => <TableRow key={token.id}>
          <TableCell className="font-medium">{token.name}</TableCell>
          <TableCell>{token.permissions === null ? i18n.t('与我相同') : i18n.t('{0} 项', [token.permissions.length])}</TableCell>
          <TableCell>{when(token.createdAt)}</TableCell>
          <TableCell>{token.lastUsedAt ? when(token.lastUsedAt) : i18n.t('从未使用')}</TableCell>
          <TableCell>{token.expiresAt === null ? i18n.t('永不过期') : <>
            {when(token.expiresAt)}{tokenState(token) === 'expired' && <Badge variant="outline" className="ml-2">{i18n.t('已过期')}</Badge>}
          </>}</TableCell>
          <TableCell className="text-right">
            <Button size="sm" variant="ghost" aria-label={i18n.t('吊销 {0}', [token.name])} onClick={() => setRevoking(token)}><Trash2 className="h-4 w-4" /></Button>
          </TableCell>
        </TableRow>)}</TableBody>
      </Table></div>}
    </CardContent>

    <CreateTokenDialog open={creating} onOpenChange={setCreating} onCreated={(name, token) => { setCreated({ name, token }); void load() }} />

    <Dialog open={created !== null} onOpenChange={open => { if (!open) setCreated(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{i18n.t('令牌「{0}」已创建', [created?.name ?? ''])}</DialogTitle>
          <DialogDescription>{i18n.t('这是唯一一次显示它。请现在复制并妥善保存；关闭后无法再次查看。')}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={created?.token ?? ''} aria-label={i18n.t('新令牌')} spellCheck={false} onFocus={event => event.target.select()} />
          <Button variant="outline" size="icon" aria-label={i18n.t('复制令牌')} onClick={async () => {
            const ok = await copyText(created?.token ?? '', navigator.clipboard, document)
            if (ok) toast.success(i18n.t('已复制'))
            else toast.warning(i18n.t('无法自动复制，请手动选中复制。'))
          }}><Copy className="h-4 w-4" /></Button>
        </div>
        <DialogFooter><Button onClick={() => setCreated(null)}>{i18n.t('我已保存')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <ConfirmDialog open={revoking !== null} onOpenChange={open => { if (!open) setRevoking(null) }} variant="destructive"
      title={i18n.t('吊销令牌「{0}」？', [revoking?.name ?? ''])}
      description={i18n.t('使用这个令牌的脚本会立即无法访问。此操作不能撤销。')}
      confirmLabel={i18n.t('吊销')}
      onConfirm={async () => {
        if (!revoking) return
        const result = await revokeOwnToken(revoking.id)
        if (!result.ok) throw new Error(authErrorMessage(result, i18n.t, 'tokens'))
        setRevoking(null)
        toast.success(i18n.t('令牌已吊销'))
        void load()
      }} />
  </Card>
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
    <DialogContent>
      <form noValidate onSubmit={event => { event.preventDefault(); void submit() }} className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{i18n.t('新建 API 令牌')}</DialogTitle>
          <DialogDescription>{i18n.t('令牌拥有与你相同的权限。用途写清楚，方便以后吊销。')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="account-token-name" className="text-sm font-medium">{i18n.t('名称')}</label>
          <Input id="account-token-name" value={name} maxLength={128} disabled={busy} placeholder={i18n.t('例如：部署脚本')}
            onChange={event => { setName(event.target.value); setError('') }} />
        </div>
        <div className="space-y-1">
          <label htmlFor="account-token-expiry" className="text-sm font-medium">{i18n.t('有效期')}</label>
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
