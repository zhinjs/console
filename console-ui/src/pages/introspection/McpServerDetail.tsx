import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, Loader2, PlugZap, Settings } from 'lucide-react'
import { useI18n } from '../../i18n'
import { CONSOLE_REST } from '../../contracts/zhin-console'
import { apiFetch } from '../../utils/auth'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { Alert, AlertDescription, AlertTitle, Button } from '@zhin.js/console-ui'
import {
  MCP_CONFIG_HREF,
  isStdioMcp,
  mcpRowState,
  mcpTestPresentation,
  mcpTestRequestError,
  readMcpTestResponse,
  type McpTestOutcome,
} from './mcp-status-model.mjs'
import type { CapabilityItem } from './capability-model'

/** 测试连接需要的权限（`POST /api/introspection/mcp/test`，`CONSOLE_HTTP_PERMISSIONS`）。 */
export const MCP_TEST_PERMISSION = 'agent.configure'

interface TestState {
  name: string
  outcome: McpTestOutcome
  at: number
}

/**
 * MCP 服务行详情：当前状态与失败原因、「测试连接」与它的结果、配置入口。
 * 测试结果单独展示，不改行状态（行状态只来自列表接口）。
 */
export function McpServerDetail({ item }: { item: CapabilityItem }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  const state = mcpRowState(item, i18n.locale)
  const canTest = Boolean(name) && hasConsolePermission(MCP_TEST_PERMISSION, access)
  const canConfigure = hasConsolePermission('ops.config.read', access)
  const stdio = isStdioMcp(item)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestState | null>(null)
  const sequence = useRef(0)

  useEffect(() => {
    sequence.current++
    setTesting(false)
    setTest(null)
  }, [name])

  async function runTest() {
    if (!name || testing) return
    const seq = ++sequence.current
    setTesting(true)
    let outcome: McpTestOutcome
    try {
      const response = await apiFetch(CONSOLE_REST.MCP_TEST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const body = await response.json().catch(() => null)
      outcome = readMcpTestResponse({ status: response.status, body, retryAfter: response.headers.get('retry-after') })
    } catch (caught) {
      outcome = mcpTestRequestError(caught instanceof Error ? caught.message : String(caught))
    }
    if (seq !== sequence.current) return
    setTest({ name, outcome, at: Date.now() })
    setTesting(false)
  }

  const presentation = test ? mcpTestPresentation(test.outcome, i18n.locale) : null

  return (
    <div className="console-inspector-section" aria-label={i18n.t('连接状态')}>
      <div className="console-inspector-section-title">
        <span>{i18n.t('连接状态')}</span>
      </div>
      <p className={state.status === 'failed' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{state.detail}</p>
      {state.failure?.at ? (
        <p className="text-xs text-muted-foreground">{i18n.t('失败于 {0}', [new Date(state.failure.at).toLocaleString(i18n.locale)])}</p>
      ) : null}

      {canTest ? (
        <div className="mt-3 grid gap-2">
          {stdio ? (
            <Alert role="note">
              <Info />
              <AlertDescription>{i18n.t('测试会另起一个进程，独占资源的服务（如占用端口或文件锁）可能与正在运行的连接冲突。')}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={testing} onClick={() => void runTest()}>
              {testing ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <PlugZap className="size-3.5 mr-1.5" />}
              {testing ? i18n.t('正在测试…') : i18n.t('测试连接')}
            </Button>
            <span className="text-xs text-muted-foreground">{i18n.t('只做一次临时连接，不改变 Agent 的连接和上面的状态。')}</span>
          </div>
          {presentation && test ? (
            <Alert variant={presentation.tone} role={presentation.role} aria-live="polite">
              <AlertTitle>{presentation.label}</AlertTitle>
              <AlertDescription>
                <p>{presentation.detail}</p>
                <p className="text-xs text-muted-foreground">{i18n.t('测试于 {0}', [new Date(test.at).toLocaleTimeString(i18n.locale)])}</p>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {canConfigure ? (
        <div className="mt-3">
          <Button asChild size="sm" variant="ghost">
            <Link to={MCP_CONFIG_HREF}><Settings className="size-3.5 mr-1.5" />{i18n.t('在配置中修改（ai.mcpServers）')}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
