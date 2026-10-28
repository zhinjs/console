import { useI18n } from '../i18n'
import { Link } from 'react-router-dom'
import { Bot, ChevronRight, GitBranch, History, Loader2, MessagesSquare } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { parseImSessionKey, isLikelySessionKey, SESSION_SCOPE_LABELS } from '../utils/agent-session'
import { relativeSince, type RecentSession } from '../pages/agent-session-recent.mjs'

interface AgentSessionPickerProps {
  value: string
  history: string[]
  /** Sessions the Host recorded Agent activity for; null while unknown or unavailable. */
  recent?: RecentSession[] | null
  loading?: boolean
  actionLabel?: string
  onChange: (value: string) => void
  onLoad: (value: string) => void
}

function SessionIdentity({ sessionKey, activity }: { sessionKey: string; activity?: RecentSession }) {
  const i18n = useI18n()
  const parsed = parseImSessionKey(sessionKey)
  if (!parsed) {
    return (
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold">{i18n.t("自定义会话")}</span>
        <code className="mt-1 block truncate text-xs text-muted-foreground">{sessionKey}</code>
      </span>
    )
  }

  return (
    <span className="min-w-0 flex-1 text-left">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-semibold">{parsed.sceneId}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {i18n.t(SESSION_SCOPE_LABELS[parsed.scope])}
        </span>
      </span>
      <span className="mt-1 block truncate text-xs text-muted-foreground">
        {parsed.platform} · {parsed.endpointId}
        {activity ? <> · {i18n.t("{0} 轮", [activity.turns])} · {relativeSince(activity.lastAt, Date.now(), i18n.locale)}</> : null}
      </span>
    </span>
  )
}

export function AgentSessionPicker({
  value,
  history,
  recent,
  loading,
  actionLabel,
  onChange,
  onLoad,
}: AgentSessionPickerProps) {
  const i18n = useI18n()
  const valid = isLikelySessionKey(value)
  const invalid = Boolean(value.trim()) && !valid
  const activity = new Map((recent ?? []).map((row) => [row.sessionKey, row]))
  const candidates = Array.from(new Set([value, ...(recent ?? []).map((row) => row.sessionKey), ...history].filter(isLikelySessionKey))).slice(0, 9)

  return (
    <section className="console-agent-session-picker" aria-labelledby="session-picker-title">
      <div className="console-panel-heading mb-3">
        <div>

          <h2 id="session-picker-title">{i18n.t("选择对话")}</h2>

        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/endpoints">
            <MessagesSquare />
            {i18n.t("浏览渠道会话")}</Link>
        </Button>
      </div>

      {candidates.length > 0 ? (
        <div className="console-session-candidates">
          {candidates.map((key) => {
            const active = value === key
            return (
              <button
                key={key}
                type="button"
                className={cn('console-session-candidate', active && 'is-active')}
                onClick={() => {
                  onChange(key)
                  onLoad(key)
                }}
                title={key}
              >
                <span className="console-session-candidate-icon">
                  {active ? <GitBranch /> : <History />}
                </span>
                <SessionIdentity sessionKey={key} activity={activity.get(key)} />
                {loading && active ? <Loader2 className="animate-spin" /> : <ChevronRight />}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="console-session-picker-empty">
          <span><Bot /></span>
          <div>
            <h3>{i18n.t("还没有最近对话")}</h3>
            <p>{i18n.t("从“聊天账号”选择联系人、群组或频道。")}</p>
          </div>
          <Button size="sm" asChild>
            <Link to="/endpoints">{i18n.t("选择会话")}</Link>
          </Button>
        </div>
      )}

      <details className="console-session-advanced">
        <summary>{i18n.t("输入会话标识")}</summary>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && valid && !loading && onLoad(value)}
            aria-label={i18n.t("会话标识")}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'session-key-error' : undefined}
            placeholder="platform:endpoint:scope:scene"
            className="font-mono text-xs"
            list="agent-session-picker-history"
          />
          <datalist id="agent-session-picker-history">
            {history.map((key) => <option key={key} value={key} />)}
          </datalist>
          <Button onClick={() => onLoad(value)} disabled={loading || !valid}>
            {loading ? <Loader2 className="animate-spin" /> : <GitBranch />}
            {actionLabel ?? i18n.t('打开会话')}
          </Button>
        </div>
        {invalid ? <p id="session-key-error" className="mt-2 text-xs text-destructive">{i18n.t("请输入完整标识：平台:渠道:private|group|channel:会话。")}</p> : null}
      </details>
    </section>
  )
}
