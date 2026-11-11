import { useMemo, useState } from 'react'
import { KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { SelectField } from '../../components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { EmptyState } from '../../components/empty-state'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { useToast } from '../../components/toast'
import { IAM_RPC, readTokens, tokenExpired, type IamToken } from './access-model.mjs'
import { IamLoadError, ReadOnlyNotice } from './access-components'
import { iamRequest, useCanManageIam, useIamRead, useIamUsers } from './use-iam'

const EMPTY_TOKENS: IamToken[] = []
const ALL = '*'

export default function AccessTokensPage() {
  const i18n = useI18n()
  const toast = useToast()
  const canManage = useCanManageIam()
  const users = useIamUsers()
  const [userFilter, setUserFilter] = useState(ALL)
  const payload = useMemo(() => (userFilter === ALL ? {} : { userId: userFilter }), [userFilter])
  const tokens = useIamRead(IAM_RPC.TOKENS_LIST, readTokens, EMPTY_TOKENS, payload)
  const usersById = useMemo(() => new Map(users.data.map(user => [user.id, user])), [users.data])
  const [revoking, setRevoking] = useState<IamToken | null>(null)
  const now = Date.now()
  const when = (value: number | null) => (value ? i18n.date(value, { dateStyle: 'medium', timeStyle: 'short' }) : '—')

  return (
    <PageShell>
      <PageHeader
        title={i18n.t("API 令牌")}
        description={i18n.t("所有用户签发的 API 令牌。令牌的权限不会超过签发它的用户；吊销立即生效。用户在个人设置里签发自己的令牌。")}
        actions={<>
          <SelectField className="h-8 w-48" aria-label={i18n.t("按用户筛选")} value={userFilter} onValueChange={setUserFilter}
            options={[{ value: ALL, label: i18n.t("全部用户") }, ...users.data.map(user => ({ value: user.id, label: user.username }))]} />
          <Button variant="outline" size="sm" onClick={() => { tokens.refresh(); users.refresh() }} disabled={tokens.loading}><RefreshCw className={tokens.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
        </>}
      />
      {!canManage ? <ReadOnlyNotice /> : null}
      {tokens.error ? <IamLoadError error={tokens.error} kind={tokens.errorKind} onRetry={tokens.refresh} /> : null}
      <Card className="overflow-hidden p-0">
        {tokens.loading && !tokens.loaded ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9" />)}</div>
        ) : !tokens.data.length ? (
          <EmptyState icon={KeyRound} title={i18n.t("没有 API 令牌")} description={tokens.loaded ? i18n.t("自动化脚本使用用户签发的 API 令牌（ZHIN_CONSOLE_TOKEN）。") : undefined} />
        ) : (
          <Table aria-label={i18n.t("API 令牌")}>
            <TableHeader>
              <TableRow>
                <TableHead>{i18n.t("名称")}</TableHead>
                <TableHead>{i18n.t("所属用户")}</TableHead>
                <TableHead>{i18n.t("权限")}</TableHead>
                <TableHead>{i18n.t("创建于")}</TableHead>
                <TableHead>{i18n.t("最近使用")}</TableHead>
                <TableHead>{i18n.t("过期")}</TableHead>
                {canManage ? <TableHead><span className="sr-only">{i18n.t("操作")}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.data.map(token => (
                <TableRow key={token.id}>
                  <TableCell><div className="font-medium">{token.name}</div><div className="font-mono text-xs text-muted-foreground">{token.id}</div></TableCell>
                  <TableCell>{usersById.get(token.userId)?.username ?? token.userId}</TableCell>
                  <TableCell>
                    {token.permissions === null
                      ? <span className="text-muted-foreground">{i18n.t("与用户相同")}</span>
                      : <span title={token.permissions.join(', ')}>{i18n.t("收窄为 {0} 项", [token.permissions.length])}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{when(token.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{token.lastUsedAt ? when(token.lastUsedAt) : i18n.t("从未使用")}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {tokenExpired(token, now)
                      ? <Badge variant="outline">{i18n.t("已过期")}</Badge>
                      : token.expiresAt ? when(token.expiresAt) : <span className="text-muted-foreground">{i18n.t("永不过期")}</span>}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRevoking(token)}><Trash2 />{i18n.t("吊销")}</Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {revoking ? (
        <ConfirmDialog open onOpenChange={open => { if (!open) setRevoking(null) }} variant="destructive"
          title={i18n.t("吊销令牌 {0}？", [revoking.name])}
          description={i18n.t("使用这个令牌的脚本和集成会立即收到 401，此操作不可恢复。")}
          confirmLabel={i18n.t("吊销")}
          onConfirm={async () => {
            await iamRequest(IAM_RPC.TOKENS_REVOKE, { id: revoking.id }, i18n.t)
            toast.success(i18n.t("已吊销令牌 {0}", [revoking.name]))
            tokens.refresh()
          }} />
      ) : null}
    </PageShell>
  )
}
