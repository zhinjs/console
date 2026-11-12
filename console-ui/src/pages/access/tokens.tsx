import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { SelectField } from '../../components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { StatusState } from '../../components/StatusState'
import { ActionReceipt, useActionReceipt } from '../../components/ActionReceipt'
import { useToast } from '../../components/toast'
import { TOKEN_EXPIRY_DAYS, tokenExpiresAt, tokenNameProblem } from '../../utils/console-auth-model.mjs'
import { copyText } from '../clipboard-copy.mjs'
import { IAM_RPC, readTokens, tokenExpired, type IamToken, type IamUser } from './access-model.mjs'
import { FormField, IamLoadError, ReadOnlyNotice } from './access-components'
import { iamRequest, useCanManageIam, useIamRead, useIamUsers } from './use-iam'
import '../admin-pages.css'

const EMPTY_TOKENS: IamToken[] = []
const ALL = '*'

export default function AccessTokensPage() {
  const i18n = useI18n()
  const canManage = useCanManageIam()
  const users = useIamUsers()
  const [userFilter, setUserFilter] = useState(ALL)
  const payload = useMemo(() => (userFilter === ALL ? {} : { userId: userFilter }), [userFilter])
  const tokens = useIamRead(IAM_RPC.TOKENS_LIST, readTokens, EMPTY_TOKENS, payload)
  const usersById = useMemo(() => new Map(users.data.map(user => [user.id, user])), [users.data])
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState<{ name: string; token: string; user: string } | null>(null)
  const now = Date.now()
  const when = (value: number | null) => (value ? i18n.date(value, { dateStyle: 'medium', timeStyle: 'short' }) : '—')

  const target = useRef<IamToken | null>(null)
  const receipt = useActionReceipt({
    submit: async () => {
      if (!target.current) throw new Error('no target')
      await iamRequest(IAM_RPC.TOKENS_REVOKE, { id: target.current.id }, i18n.t)
    },
    verify: async () => {
      const current = target.current
      if (!current) return undefined
      const list = readTokens(await iamRequest<unknown>(IAM_RPC.TOKENS_LIST, { userId: current.userId }, i18n.t))
      return { applied: !list.some(token => token.id === current.id) }
    },
    onSettled: () => tokens.refresh(),
  })
  const prepareRevoke = (token: IamToken) => {
    target.current = token
    const owner = usersById.get(token.userId)?.username ?? token.userId
    receipt.prepare({
      title: i18n.t('吊销令牌 {0}', [token.name]),
      changes: [
        i18n.t('所属用户：{0}', [owner]),
        i18n.t('使用这个令牌的脚本和集成会立即收到 401'),
        i18n.t('吊销不可恢复；需要时重新签发一个新令牌'),
      ],
      danger: true,
      confirmLabel: i18n.t('吊销'),
    })
  }
  const busy = receipt.state.phase === 'submitting' || receipt.state.phase === 'verifying'

  return (
    <PageShell>
      <PageHeader
        title={i18n.t("API 令牌")}
        description={i18n.t("所有用户的 API 令牌。令牌的权限不会超过所属用户；吊销立即生效。用户也可以在个人设置里签发自己的令牌。")}
        actions={<>
          <SelectField className="h-8 w-full sm:w-48" aria-label={i18n.t("按用户筛选")} value={userFilter} onValueChange={setUserFilter}
            options={[{ value: ALL, label: i18n.t("全部用户") }, ...users.data.map(user => ({ value: user.id, label: user.username }))]} />
          <Button variant="outline" size="sm" onClick={() => { tokens.refresh(); users.refresh() }} disabled={tokens.loading}><RefreshCw className={tokens.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
          {canManage ? <Button size="sm" onClick={() => setIssuing(true)} disabled={!users.loaded}><Plus />{i18n.t("为用户签发")}</Button> : null}
        </>}
      />
      {!canManage ? <ReadOnlyNotice /> : null}
      <ActionReceipt controller={receipt} />
      {tokens.error && !tokens.loaded ? <IamLoadError error={tokens.error} kind={tokens.errorKind} failure={tokens.failure} onRetry={tokens.refresh} /> : (
        <Card className="overflow-hidden p-0">
          {tokens.error ? <IamLoadError error={tokens.error} kind={tokens.errorKind} failure={tokens.failure} onRetry={tokens.refresh} /> : null}
          {tokens.loading && !tokens.loaded ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9" />)}</div>
          ) : !tokens.data.length ? (
            <StatusState kind="empty" title={i18n.t("没有 API 令牌")}
              description={i18n.t("自动化脚本用 API 令牌访问 Console（环境变量 ZHIN_CONSOLE_TOKEN）。在个人设置里签发自己的令牌，或用「为用户签发」。")} />
          ) : (
            <Table aria-label={i18n.t("API 令牌")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{i18n.t("名称")}</TableHead>
                  <TableHead className="hidden md:table-cell">{i18n.t("所属用户")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{i18n.t("权限")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{i18n.t("最近使用")}</TableHead>
                  <TableHead>{i18n.t("过期")}</TableHead>
                  {canManage ? <TableHead><span className="sr-only">{i18n.t("操作")}</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.data.map(token => (
                  <TableRow key={token.id}>
                    <TableCell className="min-w-0">
                      <div className="font-medium break-words">{token.name}</div>
                      <code className="console-access-id" title={token.id}>{token.id}</code>
                      <div className="text-xs text-muted-foreground md:hidden">{usersById.get(token.userId)?.username ?? token.userId}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{usersById.get(token.userId)?.username ?? token.userId}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {token.permissions === null
                        ? <span className="text-muted-foreground">{i18n.t("与用户相同")}</span>
                        : <span title={token.permissions.join(', ')}>{i18n.t("收窄为 {0} 项", [token.permissions.length])}</span>}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{token.lastUsedAt ? when(token.lastUsedAt) : i18n.t("从未使用")}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {tokenExpired(token, now)
                        ? <Badge variant="outline">{i18n.t("已过期")}</Badge>
                        : token.expiresAt ? when(token.expiresAt) : <span className="text-muted-foreground">{i18n.t("永不过期")}</span>}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => prepareRevoke(token)}
                          aria-label={i18n.t("吊销 {0}", [token.name])}><Trash2 /><span className="hidden sm:inline">{i18n.t("吊销")}</span></Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
      {issuing ? (
        <IssueTokenDialog users={users.data} initialUser={userFilter === ALL ? '' : userFilter} onClose={() => setIssuing(false)}
          onIssued={value => { setIssuing(false); setIssued(value); tokens.refresh() }} />
      ) : null}
      <IssuedTokenDialog issued={issued} onClose={() => setIssued(null)} />
    </PageShell>
  )
}

/** `iam.tokens.create { userId, name, expiresAt? }`: a token carrying all of that user's permissions. */
function IssueTokenDialog({ users, initialUser, onClose, onIssued }: {
  users: readonly IamUser[]
  initialUser: string
  onClose: () => void
  onIssued: (value: { name: string; token: string; user: string }) => void
}) {
  const i18n = useI18n()
  const id = useId()
  const enabled = users.filter(user => !user.disabled)
  const [userId, setUserId] = useState(() => enabled.some(user => user.id === initialUser) ? initialUser : enabled[0]?.id ?? '')
  const [name, setName] = useState('')
  const [days, setDays] = useState(String(TOKEN_EXPIRY_DAYS[1]))
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const problem = tokenNameProblem(name)
  const nameError = problem === 'empty' ? i18n.t('请输入令牌名称。') : problem === 'long' ? i18n.t('名称最多 128 个字符。') : null
  const submit = async () => {
    setTouched(true)
    if (nameError || !userId) return
    setSaving(true)
    setError(null)
    try {
      const expiresAt = tokenExpiresAt(Number(days))
      const reply = await iamRequest<{ token?: unknown; record?: { name?: unknown } }>(IAM_RPC.TOKENS_CREATE, { userId, name: name.trim(), ...(expiresAt ? { expiresAt } : {}) }, i18n.t)
      if (typeof reply?.token !== 'string' || !reply.token) throw new Error(i18n.t('Host 没有返回令牌。请在列表里确认后重新签发。'))
      onIssued({ name: typeof reply.record?.name === 'string' ? reply.record.name : name.trim(), token: reply.token, user: users.find(user => user.id === userId)?.username ?? userId })
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
          <DialogTitle>{i18n.t("为用户签发 API 令牌")}</DialogTitle>
          <DialogDescription>{i18n.t("令牌拥有该用户的全部权限，用户被禁用或删除时一并失效。令牌只显示一次，请通过可信渠道交给对方。")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
          <FormField htmlFor={`${id}-user`} label={i18n.t("所属用户")} hint={enabled.length ? undefined : i18n.t("没有启用的用户")}>
            <SelectField id={`${id}-user`} value={userId} onValueChange={setUserId} disabled={saving || !enabled.length}
              options={enabled.map(user => ({ value: user.id, label: user.displayName === user.username ? user.username : `${user.username} · ${user.displayName}` }))} />
          </FormField>
          <FormField htmlFor={`${id}-name`} label={i18n.t("名称")} error={touched ? nameError : null}>
            <Input id={`${id}-name`} value={name} maxLength={128} disabled={saving} placeholder={i18n.t('例如：部署脚本')} onChange={event => setName(event.target.value)} />
          </FormField>
          <FormField htmlFor={`${id}-expiry`} label={i18n.t("有效期")}>
            <SelectField id={`${id}-expiry`} value={days} disabled={saving} onValueChange={setDays}
              options={TOKEN_EXPIRY_DAYS.map(value => ({ value: String(value), label: value > 0 ? i18n.t('{0} 天', [value]) : i18n.t('永不过期') }))} />
          </FormField>
          {error ? <StatusState compact error={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>{i18n.t("取消")}</Button>
            <Button type="submit" size="sm" disabled={saving || !userId}>{saving ? i18n.t("处理中...") : i18n.t("签发")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** One-time display of a new token. */
export function IssuedTokenDialog({ issued, onClose }: { issued: { name: string; token: string; user?: string } | null; onClose: () => void }) {
  const i18n = useI18n()
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  useEffect(() => { setCopied(false) }, [issued])
  return (
    <Dialog open={issued !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{i18n.t('令牌「{0}」已创建', [issued?.name ?? ''])}</DialogTitle>
          <DialogDescription>{issued?.user
            ? i18n.t('这是唯一一次显示 {0} 的这个令牌。请现在复制并通过可信渠道交给对方；关闭后无法再次查看。', [issued.user])
            : i18n.t('这是唯一一次显示它。请现在复制并妥善保存；关闭后无法再次查看。')}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={issued?.token ?? ''} aria-label={i18n.t('新令牌')} spellCheck={false} className="font-mono" onFocus={event => event.target.select()} />
          <Button variant="outline" size="icon" aria-label={i18n.t('复制令牌')} onClick={async () => {
            const ok = await copyText(issued?.token ?? '', navigator.clipboard, document)
            setCopied(ok)
            if (!ok) toast.warning(i18n.t('无法自动复制，请手动选中复制。'))
          }}><Copy /></Button>
        </div>
        {copied ? <p className="console-admin-note" role="status">{i18n.t('已复制')}</p> : null}
        <p className="console-admin-note"><KeyRound className="mr-1 inline h-4 w-4" aria-hidden="true" />{i18n.t('脚本里设置 ZHIN_CONSOLE_TOKEN=<令牌> 使用。')}</p>
        <DialogFooter><Button onClick={onClose}>{i18n.t('我已保存')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
