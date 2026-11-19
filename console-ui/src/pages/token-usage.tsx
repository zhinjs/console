import { useI18n } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { StatusState } from '../components/StatusState'
import { ScopeFilterBar, useScopeFilter } from './insights/ScopeFilterBar'
import { usageSessionPattern } from './insights/scope-filter.mjs'
import { RefreshCw } from 'lucide-react'
import { pluginRpc } from '../utils/plugin-rpc'
import {
  Button, DateTimeField, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ErrorAlert, Input, PageHeader, PageShell,
  SearchableSelectField, SelectField, Skeleton,
} from '@zhin.js/console-ui'
import { UsageBasisHint, UsageReport, type UsageView } from './token-usage-report'
import {
  USAGE_BUCKETS,
  USAGE_METHOD,
  USAGE_RANGES,
  buildUsageInput,
  isPermissionDenied,
  mergeUsageModels,
  parseLocalDateTime,
  previousUsagePlan,
  toLocalDateTime,
  usageSessionNames,
  validateUsageStats,
  type UsageFilter,
  type UsageStats,
  type UsageTotals,
} from './token-usage-model.mjs'

const ALL_SESSIONS = '__all__'
const VIEWS: readonly UsageView[] = ['models', 'sessions', 'agents', 'purposes']
type SessionOption = { value: string; label: string; description?: string }

/**
 * 「机器人 → Token 用量」：读 plugin.root.usage-stats（只读）。汇总带「较上一周期」：Host 带回完整的 `previous`
 * （`compare: 'previous'`，zhin 第 58 批，31 天以内都不截短）时直接用它；只有它被截短或旧 Host 没给时，
 * Console 才再请求一次紧挨在前、等长的窗口（与主请求同一时区）。
 * 范围（range）和明细维度（view）写进 URL，便于分享。
 */
export default function TokenUsagePage() {
  const i18n = useI18n()
  const [params, setParams] = useSearchParams()
  const range = USAGE_RANGES.some(item => item.value === params.get('range')) ? params.get('range')! : '7d'
  const view: UsageView = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? params.get('view') as UsageView : 'models'
  const setParam = (key: string, value: string, fallback: string) => setParams(previous => {
    const next = new URLSearchParams(previous)
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    return next
  }, { replace: true })
  const setRange = (value: string) => setParam('range', value, '7d')
  const setView = (value: UsageView) => setParam('view', value, 'models')
  const [bucket, setBucket] = useState('auto')
  const [customSince, setCustomSince] = useState(() => toLocalDateTime(Date.now() - 24 * 3600_000))
  const [customUntil, setCustomUntil] = useState(() => toLocalDateTime(Date.now()))
  // 范围参数（adapter / endpoint / conversation）换成会话键条件，上级层用 `*` 通配。
  const scopeFilter = useScopeFilter()
  const [session, setSession] = useState(() => usageSessionPattern(scopeFilter.scope))
  const appliedScope = useRef(scopeFilter.identity)
  useEffect(() => {
    if (appliedScope.current === scopeFilter.identity) return
    appliedScope.current = scopeFilter.identity
    setSession(usageSessionPattern(scopeFilter.scope))
  }, [scopeFilter.identity]) // eslint-disable-line react-hooks/exhaustive-deps
  const [keyDialog, setKeyDialog] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [previous, setPrevious] = useState<UsageTotals | null>(null)
  // Sessions of the last unfiltered result: the 「会话 / 群」 choices stay while one of them is picked.
  const [sessionOptions, setSessionOptions] = useState<SessionOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  // 503 means the Host has no AI runtime yet: an expected empty state, not a failure to retry.
  const [unavailable, setUnavailable] = useState<string | null>(null)

  const filter: UsageFilter = useMemo(() => ({
    range,
    bucket,
    session,
    customSince: parseLocalDateTime(customSince) ?? undefined,
    customUntil: parseLocalDateTime(customUntil) ?? undefined,
  }), [range, bucket, session, customSince, customUntil])
  const built = useMemo(() => buildUsageInput(filter), [filter, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!built.input) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const input = built.input
    // An older Host ignores `compare`; a newer one answers with `previous` in the same response.
    pluginRpc<unknown>('root', USAGE_METHOD, { ...input, compare: 'previous' } as unknown as Record<string, unknown>)
      .then(data => {
        if (cancelled) return
        // One row per 「服务名 · 模型」 (displayName / modelLabels); opaque ids never become a name.
        const next = mergeUsageModels(validateUsageStats(data, i18n.locale), i18n.locale)
        setStats(next)
        if (!input.session) {
          const names = usageSessionNames(next.bySession, i18n.locale)
          setSessionOptions(next.bySession.map(row => {
            const name = names.get(row.sessionKey)!
            return { value: row.sessionKey, label: name.name, ...(name.qualifier ? { description: name.qualifier } : {}) }
          }))
        }
        setError(null)
        setDenied(false)
        setUnavailable(null)
        const plan = previousUsagePlan(next, input)
        setPrevious(plan.totals ?? null)
        if (plan.request) {
          pluginRpc<unknown>('root', USAGE_METHOD, plan.request as unknown as Record<string, unknown>)
            .then(old => { if (!cancelled) setPrevious(validateUsageStats(old, i18n.locale).totals) })
            // Without the previous window the summary just shows no change.
            .catch(() => { if (!cancelled) setPrevious(null) })
        }
      })
      .catch(caught => {
        if (cancelled) return
        if (isPermissionDenied(caught)) setDenied(true)
        else if ((caught as { status?: number }).status === 503) setUnavailable((caught as Error).message)
        else setError((caught as Error).message)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [built, i18n.locale])

  const applySession = (value: string) => setSession(value.trim())
  const sessionChoices = useMemo(() => {
    const options: SessionOption[] = [{ value: ALL_SESSIONS, label: i18n.t("全部会话") }, ...sessionOptions]
    // A pattern from the scope bar or the key dialog that is no listed session.
    if (session && !sessionOptions.some(option => option.value === session)) options.push({ value: session, label: i18n.t("会话键 {0}", [session]) })
    return options
  }, [sessionOptions, session, i18n])

  const empty = stats && stats.totals.calls === 0
  const retry = () => setRefreshTick(tick => tick + 1)

  return <PageShell>
    <PageHeader
      title={i18n.t("Token 用量")}
      description={i18n.t("机器人调用模型花了多少 token、花在谁身上，和上一周期相比是多是少。")}
      actions={<Button variant="outline" size="sm" onClick={retry} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
      moreActions={[{ key: 'session-key', label: i18n.t("按会话键筛选…"), onSelect: () => { setKeyDraft(session); setKeyDialog(true) } }]}
    />

    <ScopeFilterBar
      filter={scopeFilter}
      note={i18n.t("按会话键 {0} 统计；可在下方改动会话条件。", [usageSessionPattern(scopeFilter.scope)])}
    />

    {denied ? <StatusState kind="forbidden" permissions={['control:read']} /> : <>
      <div className="flex flex-wrap items-center gap-3">
        <SelectField aria-label={i18n.t("时间范围")} className="w-auto" value={range} onValueChange={setRange} options={USAGE_RANGES.map(item => ({ value: item.value, label: i18n.t(item.label) }))} />
        {range === 'custom' ? <>
          <DateTimeField className="w-52" aria-label={i18n.t("开始时间")} value={customSince} onValueChange={setCustomSince} max={customUntil || undefined} />
          <DateTimeField className="w-52" aria-label={i18n.t("结束时间")} value={customUntil} onValueChange={setCustomUntil} min={customSince || undefined} />
        </> : null}
        <SelectField aria-label={i18n.t("统计粒度")} className="w-auto" value={bucket} onValueChange={setBucket} options={USAGE_BUCKETS.map(item => ({ value: item.value, label: i18n.t(item.label) }))} />
        <div className="w-64 max-w-full">
          <SearchableSelectField aria-label={i18n.t("会话 / 群")} value={session || ALL_SESSIONS}
          onValueChange={value => applySession(value === ALL_SESSIONS ? '' : value)} options={sessionChoices}
          searchPlaceholder={i18n.t("搜索会话或群")} emptyText={i18n.t("没有匹配的会话")} />
        </div>
        {stats ? <UsageBasisHint stats={stats} /> : null}
      </div>
      {built.error ? <p className="text-xs text-destructive">{i18n.t("自定义范围的开始时间必须早于结束时间。")}</p> : null}

      {unavailable && !stats ? <StatusState kind="empty" title={i18n.t("还没有用量数据")} description={unavailable} />
        : loading && !stats ? <StatusState kind="loading" onRetry={retry} placeholder={<Skeleton className="h-64 w-full" />} />
        : error && !stats ? <StatusState error={error} onRetry={retry} />
          : stats ? <div aria-busy={loading} className="console-content-stack is-gap-section">
            {error ? <ErrorAlert error={error} onRetry={retry} /> : null}
            <UsageReport stats={stats} previous={previous} view={view} onViewChange={setView} onPickSession={applySession}
              empty={empty ? <StatusState kind="empty" title={i18n.t("这段时间没有模型调用记录。")} description={i18n.t("换一个时间范围或清除会话筛选试试。")}
                actions={<>
                  {range !== '30d' ? <Button size="sm" variant="outline" onClick={() => setRange('30d')}>{i18n.t("查看最近 30 天")}</Button> : null}
                  {session ? <Button size="sm" variant="outline" onClick={() => applySession('')}>{i18n.t("清除会话筛选")}</Button> : null}
                </>} /> : undefined} />
          </div> : null}
    </>}

    <Dialog open={keyDialog} onOpenChange={setKeyDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{i18n.t("按会话键筛选")}</DialogTitle>
          <DialogDescription>{i18n.t("输入完整会话键，或用 * 匹配一类会话，如 icqq:8596238:*。")}</DialogDescription>
        </DialogHeader>
        <form id="usage-session-key" onSubmit={event => { event.preventDefault(); applySession(keyDraft); setKeyDialog(false) }}>
          <Input aria-label={i18n.t("会话键")} placeholder="icqq:8596238:group:123" value={keyDraft} onChange={event => setKeyDraft(event.target.value)} />
        </form>
        <DialogFooter>
          {session ? <Button type="button" variant="ghost" onClick={() => { applySession(''); setKeyDialog(false) }}>{i18n.t("清除会话")}</Button> : null}
          <Button type="submit" form="usage-session-key">{i18n.t("筛选")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </PageShell>
}
