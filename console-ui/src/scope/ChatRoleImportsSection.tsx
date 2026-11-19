import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Check, FileInput, KeyRound, Link2, RefreshCw, X } from 'lucide-react'
import { Badge, Button, Card, Skeleton } from '@zhin.js/console-ui'
import { useI18n } from '../i18n'
import { StatusState } from '../components/StatusState'
import { ActionReceipt, useActionReceipt } from '../components/ActionReceipt'
import { receiptBlocksActions, type ReceiptPlan } from '../components/action-receipt-model.mjs'
import { outcomeFromChatRoleWrite } from '../components/apply-outcome-model.mjs'
import { statusFromError, type StatusReading } from '../components/status-state-model.mjs'
import { requestConsole } from '../utils/console-rpc'
import { useConsoleAccess } from '../hooks/use-console-access'
import { iamRequest } from '../pages/access/use-iam'
import { IAM_RPC, readUsers, type IamUser } from '../pages/access/access-model.mjs'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { ObjectSection } from './ObjectPageLayout'
import { CHAT_ROLE_COPY, chatRoleRefusal } from './chat-roles-model.mjs'
import {
  CHAT_ROLE_IMPORT_COPY, CHAT_ROLE_IMPORTS_ANCHOR, CHAT_ROLE_IMPORTS_PERMISSION,
  canResolveChatRoleImports, chatRoleImportAlreadyHandled, chatRoleImportDanger, chatRoleImportEffect, chatRoleImportSkipped, chatRoleImportGranted, chatRoleImportOutcomeCopy, chatRoleImportResolveRequest,
  chatRoleImportResolved, chatRoleImportSummary, chatRoleImportsListRequest, chatRoleImportsUnsupported,
  readChatRoleImportResolve, readChatRoleImports,
  type ChatRoleImportDecision, type ChatRoleImportRow,
} from './chat-role-imports-model.mjs'

type ImportsState = { status: 'loading' | 'ready' | 'failed' | 'unsupported'; rows: ChatRoleImportRow[]; failure: StatusReading | null; error: unknown }

function useChatRoleImports(enabled: boolean) {
  const [state, setState] = useState<ImportsState>({ status: 'loading', rows: [], failure: null, error: null })
  const ticket = useRef(0)
  const read = useCallback(async () => readChatRoleImports(await requestConsole<unknown>(chatRoleImportsListRequest())).rows, [])
  const load = useCallback(() => {
    const current = ++ticket.current
    // Without a global iam.manage the RPC is never called (the Host would refuse it anyway).
    if (!enabled) return
    setState(previous => ({ ...previous, status: previous.status === 'ready' ? 'ready' : 'loading' }))
    read().then(rows => {
      if (current === ticket.current) setState({ status: 'ready', rows, failure: null, error: null })
    }, (error: unknown) => {
      if (current !== ticket.current) return
      // An older Host without chat-roles.imports.*: the section stays out of the way.
      if (chatRoleImportsUnsupported(error)) setState({ status: 'unsupported', rows: [], failure: null, error: null })
      else setState(previous => ({ ...previous, status: 'failed', failure: statusFromError(error), error }))
    })
  }, [enabled, read])
  useEffect(() => {
    load()
    return () => { ticket.current += 1 }
  }, [load])
  return { ...state, refresh: load, read }
}

interface PendingImport { readonly decision: ChatRoleImportDecision; readonly id: string; readonly kind: ChatRoleImportRow['kind'] }
const pendingImport = (plan: ReceiptPlan) => plan.payload as PendingImport | undefined

/** Scrolls to `#chat-role-imports` (「去处理」 of the attention item) once the section has content. */
function useScrollToAnchor(ready: boolean) {
  const location = useLocation()
  const done = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || location.hash !== `#${CHAT_ROLE_IMPORTS_ANCHOR}` || done.current === location.key) return
    done.current = location.key
    document.getElementById(CHAT_ROLE_IMPORTS_ANCHOR)?.scrollIntoView({ block: 'start' })
  }, [ready, location.hash, location.key])
}

/**
 * 待确认的导入 on the global 角色 tab (ADR 0060 §4.2): configured people lists and
 * `ai.personalPrincipals` links that wait for 「导入」 / 「忽略」, one by one. Only a global
 * `iam.manage` may list or resolve them; an older Host without the RPC shows nothing. Each decision
 * goes through an ActionReceipt: an unknown outcome is only re-read (刷新核对), never resent.
 */
export function ChatRoleImportsSection({ onChanged }: { onChanged?: () => void }) {
  // One session per connection: another Host never sees this list or its receipt (an unknown
  // outcome on Host A must not be 「核对」ed against Host B's list).
  const scope = useInboxCacheScope()
  return <ChatRoleImportsSession key={scope ?? 'disconnected'} scope={scope} onChanged={onChanged} />
}

function ChatRoleImportsSession({ scope, onChanged }: { scope?: string; onChanged?: () => void }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const allowed = canResolveChatRoleImports(access)
  const imports = useChatRoleImports(allowed)
  useScrollToAnchor(!allowed || imports.status !== 'loading')
  if (!allowed) {
    return (
      <ObjectSection id={CHAT_ROLE_IMPORTS_ANCHOR} className="console-chat-imports" title={i18n.t('待确认的导入')}>
        <p className="console-chat-import-note"><KeyRound aria-hidden="true" />
          <span>{i18n.t('处理配置中的人员名单与身份关联需要全局 {0} 权限；账号或适配器范围的授权不够。', [CHAT_ROLE_IMPORTS_PERMISSION])}</span>
        </p>
      </ObjectSection>
    )
  }
  if (imports.status === 'unsupported') return null
  return <ChatRoleImportsList scope={scope} imports={imports} onChanged={onChanged} />
}

/**
 * Names of the Console users behind personal links (`iam.users.list`, which needs `iam.view`):
 * read only when permissions are reported, `iam.view` is held and there is a personal row.
 */
function useConsoleUserNames(needed: boolean): IamUser[] {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const enabled = needed && !access.unrestricted && hasConsolePermission('iam.view', access)
  const [users, setUsers] = useState<IamUser[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    iamRequest<unknown>(IAM_RPC.USERS_LIST, {}, i18n.t).then(reply => { if (alive) setUsers(readUsers(reply)) }, () => { if (alive) setUsers([]) })
    return () => { alive = false }
  }, [enabled, i18n.t])
  return enabled ? users : []
}

function ChatRoleImportsList({ scope, imports, onChanged }: { scope?: string; imports: ReturnType<typeof useChatRoleImports>; onChanged?: () => void }) {
  const i18n = useI18n()
  const users = useConsoleUserNames(imports.rows.some(row => row.kind === 'personal'))
  const receipt = useActionReceipt({
    persistKey: `chat-roles:imports:${scope ?? 'disconnected'}`,
    submit: async plan => {
      const target = pendingImport(plan)
      if (!target) throw new Error('No action')
      let payload: unknown
      try {
        payload = await requestConsole<unknown>(chatRoleImportResolveRequest(target.decision, target.id))
      } catch (error) {
        // 404: already handled elsewhere — say so and re-list, nothing was refused.
        if (chatRoleImportAlreadyHandled(error)) return { status: 'unchanged', message: i18n.t(CHAT_ROLE_IMPORT_COPY.unchanged) }
        // A certain refusal (403 without a global iam.manage, 503 unpersisted …) shows its reason; anything else stays 结果未知.
        const refusal = chatRoleRefusal(statusFromError(error))
        if (!refusal) throw error
        return { status: 'failed', message: refusal.code === 'unpersisted' ? i18n.t(CHAT_ROLE_COPY.unpersisted) : refusal.message }
      }
      let reply: ReturnType<typeof readChatRoleImportResolve>
      // A reply the Console cannot read is not success: 结果未知, settled by 刷新核对.
      try { reply = readChatRoleImportResolve(payload) } catch { return { status: 'unknown', message: i18n.t('Host 的答复无法识别，不确定这一条是否已处理。请刷新核对。') } }
      const message = i18n.t(CHAT_ROLE_IMPORT_COPY[chatRoleImportOutcomeCopy(reply, target.kind)])
      // skipped: the Host removed it from the list without importing it — partial, not 已完成.
      if (chatRoleImportSkipped(reply)) {
        return { status: 'partial', message, items: [{ label: i18n.t('移出待确认列表'), ok: true }, { label: i18n.t('导入'), ok: false }] }
      }
      return { status: reply.status === 'unchanged' ? 'unchanged' : 'succeeded', message, ...(chatRoleImportGranted(reply, target.kind) ? { apply: outcomeFromChatRoleWrite() } : {}) }
    },
    verify: async plan => {
      const target = pendingImport(plan)
      if (!target) return undefined
      const applied = chatRoleImportResolved(await imports.read(), target.id)
      return { applied, message: applied ? i18n.t('已核对：这一条已不在待确认列表里，已经处理。') : i18n.t('已核对：这一条仍在待确认列表里，没有处理。') }
    },
    onSettled: () => {
      imports.refresh()
      onChanged?.()
    },
  })
  const busy = receiptBlocksActions(receipt.state)
  const inFlight = (receipt.state.phase === 'submitting' || receipt.state.phase === 'verifying') && receipt.state.plan ? pendingImport(receipt.state.plan)?.id : undefined
  const prepare = (row: ChatRoleImportRow, decision: ChatRoleImportDecision) => {
    const summary = chatRoleImportSummary(row, i18n.t, users)
    receipt.prepare({
      payload: { decision, id: row.id, kind: row.kind } satisfies PendingImport,
      title: decision === 'import' ? i18n.t('导入：{0}', [summary]) : i18n.t('忽略：{0}', [summary]),
      summary: decision === 'import' ? chatRoleImportEffect(row, i18n.t) : i18n.t('这一条不会导入，也不会授予任何角色或关联。'),
      confirmLabel: decision === 'import' ? i18n.t('导入') : i18n.t('忽略'),
      danger: chatRoleImportDanger(row, decision),
    })
  }
  return (
    <ObjectSection
      id={CHAT_ROLE_IMPORTS_ANCHOR}
      className="console-chat-imports"
      title={i18n.t('待确认的导入')}
      description={i18n.t('配置里再次出现的人员名单与个人身份关联，确认前不会生效。逐条「导入」或「忽略」。')}
      actions={<Button variant="outline" size="sm" onClick={imports.refresh} disabled={imports.status === 'loading'}><RefreshCw className={imports.status === 'loading' ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>}
    >
      {imports.status === 'failed' && imports.failure ? (
        <StatusState compact error={imports.error} onRetry={imports.refresh} />
      ) : imports.status === 'loading' ? (
        <StatusState kind="loading" placeholder={<div className="space-y-2">{[0, 1].map(index => <Skeleton key={index} className="h-14" />)}</div>} />
      ) : !imports.rows.length ? (
        <p className="console-chat-import-note"><Check aria-hidden="true" /><span>{i18n.t('没有待确认的导入')}</span></p>
      ) : (
        <Card className="overflow-hidden p-0">
          <h3 className="console-chat-role-card-title">{i18n.t('等待确认')}<span>{imports.rows.length}</span></h3>
          <ul className="console-chat-import-list" aria-label={i18n.t('待确认的导入')}>
            {imports.rows.map(row => {
              const summary = chatRoleImportSummary(row, i18n.t, users)
              return (
                <li key={row.id} className="console-chat-import-row" aria-busy={inFlight === row.id || undefined}>
                  {row.kind === 'personal' ? <Link2 aria-hidden="true" /> : <FileInput aria-hidden="true" />}
                  <div className="console-chat-import-body">
                    <p className="console-chat-import-summary">
                      <Badge variant={row.kind === 'personal' ? 'info' : row.kind === 'role' && row.role === 'owner' ? 'warning' : 'outline'} size="sm">{row.kind === 'personal' ? i18n.t('身份关联') : i18n.t('角色')}</Badge>
                      {/* The raw key of an entry the Console cannot read, on hover. */}
                      <span className="min-w-0" title={row.kind === 'unrecognized' ? row.rawKey : undefined}>{summary}</span>
                    </p>
                    <p className="console-chat-role-sub">{chatRoleImportEffect(row, i18n.t)}</p>
                    {row.source || row.seenAt ? (
                      <p className="console-chat-role-sub">
                        {row.source ? <>{i18n.t('来自配置')} <code>{row.source}</code></> : null}
                        {row.source && row.seenAt ? ' · ' : null}
                        {row.seenAt ? i18n.t('配置于 {0} 再次列出', [new Date(row.seenAt).toLocaleString(i18n.locale)]) : null}
                      </p>
                    ) : null}
                  </div>
                  <div className="console-chat-import-actions">
                    {row.kind === 'unrecognized' ? null
                      : <Button size="sm" variant="soft" disabled={busy} onClick={() => prepare(row, 'import')} aria-label={i18n.t('导入 {0}', [summary])}><Check />{i18n.t('导入')}</Button>}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => prepare(row, 'ignore')} aria-label={i18n.t('忽略 {0}', [summary])}><X />{i18n.t('忽略')}</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
      <ActionReceipt controller={receipt} verifyLabel={i18n.t('刷新核对')} />
    </ObjectSection>
  )
}
