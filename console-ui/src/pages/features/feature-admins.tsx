import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useToast } from '../../components/toast'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { EmptyState } from '../../components/empty-state'
import { ErrorAlert } from '../../components/error-alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { classifyFeatureRpcError, type FeatureLevel, type FeatureRpcFailure } from './feature-model.mjs'
import {
  adminMutationRequest, adminRemovable, adminScopeChain, adminsApplyingTo, adminsListRequest, readAdminPage,
  type FeatureAdmin, type FeatureAdminRow,
} from './feature-admins-model.mjs'

// Upper bound on pages read per level; admin lists are short.
const MAX_ADMIN_PAGES = 20

type AdminStatus = 'loading' | 'ready' | FeatureRpcFailure

/** Direct and inherited admins of one level (the Host includes the scopes above in one answer). */
function useFeatureAdmins(level: FeatureLevel, levelKey?: string) {
  const [state, setState] = useState<{ items: FeatureAdmin[]; status: AdminStatus; error: string | null }>({ items: [], status: 'loading', error: null })
  const sequence = useRef(0)
  const load = useCallback(() => {
    const ticket = ++sequence.current
    try {
      adminScopeChain(level, levelKey)
    } catch (error) {
      setState({ items: [], status: 'error', error: error instanceof Error ? error.message : String(error) })
      return
    }
    const readScope = async (scope: { level: FeatureLevel; key?: string }) => {
      const items: FeatureAdmin[] = []
      let cursor: string | undefined
      for (let page = 0; page < MAX_ADMIN_PAGES; page += 1) {
        const result = readAdminPage(await requestConsole<unknown>(adminsListRequest({ ...scope, cursor })))
        items.push(...result.items)
        cursor = result.cursor
        if (!cursor) break
      }
      return items
    }
    void readScope({ level, key: levelKey }).then(items => {
      if (ticket !== sequence.current) return
      setState({ items, status: 'ready', error: null })
    }, (error: unknown) => {
      if (ticket !== sequence.current) return
      setState(previous => ({ ...previous, status: classifyFeatureRpcError(error), error: error instanceof Error ? error.message : String(error) }))
    })
  }, [level, levelKey])
  useEffect(() => {
    load()
    return () => { sequence.current += 1 }
  }, [load])
  return { ...state, refresh: load }
}

function inheritedLabel(level: FeatureLevel, i18n: ReturnType<typeof useI18n>): string {
  return level === 'global' ? i18n.t("继承自全局") : level === 'adapter' ? i18n.t("继承自适配器") : i18n.t("继承自账号")
}

function AdminSourceBadges({ row }: { row: FeatureAdminRow }) {
  const i18n = useI18n()
  return (
    <span className="inline-flex flex-wrap gap-1">
      {row.source === 'master' ? <Badge variant="secondary" size="sm">{i18n.t("账号主人")}</Badge> : null}
      {row.source === 'platform' ? <Badge variant="secondary" size="sm">{i18n.t("群管理员")}</Badge> : null}
      {row.source === 'config' ? <Badge variant="secondary" size="sm" title={i18n.t("在配置文件 features.selfService.admins 中声明，这里只读。")}>{i18n.t("配置文件")}</Badge> : null}
      {row.inherited ? <Badge variant="outline" size="sm">{inheritedLabel(row.level, i18n)}</Badge> : null}
      {!row.inherited && row.source === 'grant' ? <Badge variant="info" size="sm">{i18n.t("在此授予")}</Badge> : null}
    </span>
  )
}

interface FeatureAdminsSectionProps {
  readonly level: FeatureLevel
  /** Omitted on the global level. */
  readonly levelKey?: string
  /** Adapter aliases offered when adding a global admin. */
  readonly adapters?: readonly string[]
}

/**
 * 「管理员」: platform identities that manage features in chat with `功能 …` commands at this level
 * and every level below it. Hidden on a Host without `feature.admins.*`, apart from a short hint.
 */
export function FeatureAdminsSection(props: FeatureAdminsSectionProps) {
  const access = useConsoleAccess()
  // The Host lists admins only for `feature.configure` (scoped to the level's adapter / endpoint).
  if (!hasConsolePermission('feature.configure', access)) return null
  // Keys the Host cannot scope (e.g. an endpoint id with `/`) have no admins.
  try { adminScopeChain(props.level, props.levelKey) } catch { return null }
  return <FeatureAdminsBody {...props} />
}

function FeatureAdminsBody({ level, levelKey, adapters = [] }: FeatureAdminsSectionProps) {
  const i18n = useI18n()
  const toast = useToast()
  const admins = useFeatureAdmins(level, levelKey)
  const rows = useMemo(() => {
    try { return adminsApplyingTo(admins.items, level, levelKey) } catch { return [] }
  }, [admins.items, level, levelKey])
  const [pending, setPending] = useState<string | null>(null)
  const [platform, setPlatform] = useState('')
  const [userId, setUserId] = useState('')
  const headingId = `feature-admins-${level}`
  if (admins.status === 'unsupported') {
    return <p className="text-sm text-muted-foreground">{i18n.t("聊天内功能管理员需要新版 Host。")}</p>
  }
  if (admins.status === 'forbidden') return null
  const mutate = async (action: 'add' | 'remove', input: { adapter?: string; userId: string }, id: string) => {
    let body
    try {
      body = adminMutationRequest(action, { level, key: levelKey, ...input })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    }
    setPending(id)
    try {
      await requestConsole<unknown>(body)
      toast.success(action === 'add' ? i18n.t("已添加管理员。") : i18n.t("已移除管理员。"))
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error), i18n.t("保存失败"))
      return false
    } finally {
      setPending(null)
      admins.refresh()
    }
  }
  const add = async () => {
    if (await mutate('add', { adapter: level === 'global' ? platform : undefined, userId }, 'add')) setUserId('')
  }
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="h-4 w-4" aria-hidden="true" />{i18n.t("管理员")}</h2>
      <p className="text-sm text-muted-foreground">
        {i18n.t("管理员在聊天里用「功能 …」命令管理功能（例如「功能 列表」「功能 关闭 <插件>」），可以选择作用到哪一层。上级的管理员也管理下级；账号主人和群管理员自动是管理员。")}
      </p>
      {admins.error && admins.status === 'error' ? <ErrorAlert error={admins.error} onRetry={admins.refresh} /> : null}
      <Card className="overflow-hidden p-0">
        {admins.status === 'loading' ? (
          <div className="space-y-2 p-4">{[0, 1].map(index => <Skeleton key={index} className="h-9" />)}</div>
        ) : !rows.length ? (
          <EmptyState icon={ShieldCheck} compact title={i18n.t("还没有管理员")} />
        ) : (
          <Table aria-label={i18n.t("管理员")}>
            <TableHeader>
              <TableRow>
                <TableHead>{i18n.t("用户")}</TableHead>
                <TableHead>{i18n.t("平台")}</TableHead>
                <TableHead>{i18n.t("来源")}</TableHead>
                <TableHead className="text-right">{i18n.t("操作")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const id = `${row.level}\u0000${row.adapter}\u0000${row.userId}\u0000${row.source}`
                return (
                  <TableRow key={id}>
                    <TableCell>
                      <span className="font-medium">{row.displayName ?? row.userId}</span>
                      {row.displayName ? <code className="ml-2 text-xs text-muted-foreground">{row.userId}</code> : null}
                    </TableCell>
                    <TableCell>{row.adapter}</TableCell>
                    <TableCell><AdminSourceBadges row={row} /></TableCell>
                    <TableCell className="text-right">
                      {adminRemovable(row, true) ? (
                        <Button variant="outline" size="sm" disabled={pending === id}
                          aria-label={i18n.t("移除管理员 {0}", [row.displayName ?? row.userId])}
                          onClick={() => void mutate('remove', { adapter: row.adapter, userId: row.userId }, id)}>
                          <Trash2 />{i18n.t("移除")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void add() }}>
        {level === 'global' ? (
          <label className="flex min-w-[9rem] flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{i18n.t("平台（适配器）")}</span>
            <Input value={platform} onChange={event => setPlatform(event.target.value)} list={`${headingId}-adapters`} placeholder="qq" />
            <datalist id={`${headingId}-adapters`}>{adapters.map(alias => <option key={alias} value={alias} />)}</datalist>
          </label>
        ) : null}
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{i18n.t("平台用户 ID")}</span>
          <Input value={userId} onChange={event => setUserId(event.target.value)} />
        </label>
        <Button type="submit" size="sm" disabled={pending === 'add' || !userId.trim() || (level === 'global' && !platform.trim())}>
          <Plus />{i18n.t("添加管理员")}
        </Button>
      </form>
    </section>
  )
}
