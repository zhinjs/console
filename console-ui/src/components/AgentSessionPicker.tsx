import { Link } from 'react-router-dom'
import { Bot, ChevronRight, GitBranch, History, Loader2, MessagesSquare } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { parseImSessionKey, SESSION_SCOPE_LABELS } from '../utils/agent-session'

interface AgentSessionPickerProps {
  value: string
  history: string[]
  loading?: boolean
  actionLabel?: string
  onChange: (value: string) => void
  onLoad: (value: string) => void
}

function SessionIdentity({ sessionKey }: { sessionKey: string }) {
  const parsed = parseImSessionKey(sessionKey)
  if (!parsed) {
    return (
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold">自定义会话</span>
        <code className="mt-1 block truncate text-[10px] text-muted-foreground">{sessionKey}</code>
      </span>
    )
  }

  return (
    <span className="min-w-0 flex-1 text-left">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-semibold">{parsed.sceneId}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {SESSION_SCOPE_LABELS[parsed.scope]}
        </span>
      </span>
      <span className="mt-1 block truncate text-[10px] text-muted-foreground">
        {parsed.platform} · {parsed.endpointId}
      </span>
    </span>
  )
}

export function AgentSessionPicker({
  value,
  history,
  loading,
  actionLabel = '打开会话',
  onChange,
  onLoad,
}: AgentSessionPickerProps) {
  const candidates = Array.from(new Set([value, ...history].filter(Boolean))).slice(0, 6)

  return (
    <section className="console-agent-session-picker" aria-labelledby="session-picker-title">
      <div className="console-panel-heading mb-3">
        <div>
          <span className="console-eyebrow">Conversation context</span>
          <h2 id="session-picker-title">选择一个对话</h2>
          <p>从渠道会话进入时会自动带上上下文，也可以从最近使用的对话继续。</p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/endpoints">
            <MessagesSquare />
            浏览渠道会话
          </Link>
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
                <SessionIdentity sessionKey={key} />
                {loading && active ? <Loader2 className="animate-spin" /> : <ChevronRight />}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="console-session-picker-empty">
          <span><Bot /></span>
          <div>
            <h3>还没有最近对话</h3>
            <p>进入“渠道与会话”，选择联系人、群组或频道，再打开 Agent 轨迹。</p>
          </div>
          <Button size="sm" asChild>
            <Link to="/endpoints">选择会话</Link>
          </Button>
        </div>
      )}

      <details className="console-session-advanced">
        <summary>高级：使用会话标识</summary>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && onLoad(value)}
            placeholder="platform:endpoint:scope:scene"
            className="font-mono text-xs"
            list="agent-session-picker-history"
          />
          <datalist id="agent-session-picker-history">
            {history.map((key) => <option key={key} value={key} />)}
          </datalist>
          <Button onClick={() => onLoad(value)} disabled={loading || !value.trim()}>
            {loading ? <Loader2 className="animate-spin" /> : <GitBranch />}
            {actionLabel}
          </Button>
        </div>
      </details>
    </section>
  )
}
