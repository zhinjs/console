import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

const ROOT = new URL('..', import.meta.url).pathname
const SOURCE_ROOT = join(ROOT, 'console-ui', 'src')

function sourceFiles(directory = SOURCE_ROOT) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(name) ? [path] : []
  })
}

function sourceText(path) {
  return readFileSync(path, 'utf8')
}

test('Console does not call removed Zhin APIs or legacy Endpoint aliases', () => {
  const removed = [
    '/api/agent/orchestration',
    'endpoint:list',
    'endpoint:info',
    'endpoint:sendMessage',
    'endpoint:friends',
    'endpoint:groups',
    'endpoint:channels',
    'endpoint:deleteFriend',
    'endpoint:groupMembers',
    'endpoint:groupKick',
    'endpoint:groupMute',
    'endpoint:groupAdmin',
    'endpoint:requests',
    'endpoint:inboxMessages',
    'endpoint:inboxRequests',
    'endpoint:inboxNotices',
  ]

  for (const path of sourceFiles()) {
    const source = sourceText(path)
    for (const token of removed) {
      assert.equal(
        source.includes(token),
        false,
        `${relative(ROOT, path)} still references removed API ${token}`,
      )
    }
  }
})

test('built-in Agent navigation exposes Workbench, Workroom board/catalog and Sessions', () => {
  const source = sourceText(join(SOURCE_ROOT, 'registerBuiltinShell.tsx'))
  assert.match(source, /path: '\/agent\/workbench'/)
  assert.match(source, /path: '\/agent\/workrooms'/)
  assert.match(source, /path: '\/agent\/workrooms\/catalog'/)
  assert.match(source, /path: '\/agent\/sessions'/)
  assert.match(source, /NAV_GROUPS\.AGENTS/)
  assert.match(source, /NAV_GROUPS\.CONVERSATIONS/)
  assert.match(source, /NAV_GROUPS\.AUTOMATION/)
  assert.match(source, /NAV_GROUPS\.SYSTEM/)
  assert.match(source, /path: '\/agent\/workrooms\/catalog'[\s\S]*hideInMenu: true/)
  assert.doesNotMatch(source, /\/agent\/(?:studio|orchestration)/)
  const taxonomy = sourceText(join(SOURCE_ROOT, 'navigation-taxonomy.ts'))
  assert.match(taxonomy, /对话与渠道/)
  assert.match(taxonomy, /Agent 与 Workroom/)
  assert.match(taxonomy, /自动化与扩展/)
  assert.match(taxonomy, /系统/)
})

test('Command Center exposes task-oriented actions in addition to route navigation', () => {
  const source = sourceText(join(SOURCE_ROOT, 'components', 'ConsoleCommandCenter.tsx'))
  assert.match(source, /QUICK_ACTIONS/)
  assert.match(source, /快捷动作/)
  assert.match(source, /查看错误日志/)
  assert.match(source, /试运行命令/)
  assert.match(source, /预览消息组件/)
  assert.match(source, /搜索页面或执行动作/)
  const logs = sourceText(join(SOURCE_ROOT, 'pages', 'logs.tsx'))
  assert.match(logs, /useSearchParams/)
  assert.match(logs, /searchParams\.get\('level'\)/)
  assert.match(logs, /logsInFlightRef/)
  assert.match(logs, /statsInFlightRef/)
  assert.match(logs, /LOG_STATS_TIMEOUT_MS/)
  assert.match(logs, /invalidateLogReads/)
  assert.match(logs, /data\.deletedCount/)
  assert.doesNotMatch(logs, /data\.data\.deletedCount/)
  assert.match(logs, /setTimeout\(\(\) => void poll\(\), 3000\)/)
  assert.doesNotMatch(logs, /setInterval/)
})

test('Dashboard fails closed from loading into a navigable degraded control plane', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'dashboard.tsx'))
  assert.match(source, /DASHBOARD_REQUEST_TIMEOUT_MS/)
  assert.match(source, /AbortSignal\.timeout/)
  assert.match(source, /Host 暂时不可达/)
  assert.match(source, /控制面仍可继续使用/)
  assert.match(source, /setStats\(null\)/)
  assert.match(source, /setSystemStatus\(null\)/)
})

test('introspection surface is the exact current Host capability set', () => {
  const source = sourceText(join(SOURCE_ROOT, 'contracts', 'zhin-console.ts'))
  for (const kind of ['commands', 'middlewares', 'components', 'endpoints', 'bindings', 'tools', 'prompt-sections', 'mcp']) {
    assert.match(source, new RegExp(`\\| '${kind}'`))
  }
  assert.match(source, /COMPONENT_PREVIEW: '\/api\/introspection\/components\/render'/)
})

test('runtime capabilities use purpose-built views with a shared inspector', () => {
  const page = sourceText(join(SOURCE_ROOT, 'pages', 'introspection', 'index.tsx'))
  const explorer = sourceText(join(SOURCE_ROOT, 'pages', 'introspection', 'CapabilityExplorer.tsx'))

  assert.match(page, /CapabilityExplorer/)
  assert.doesNotMatch(page, /<table/)
  assert.match(explorer, /命令目录/)
  assert.match(explorer, /执行管线/)
  assert.match(explorer, /组件画廊/)
  assert.match(explorer, /Agent 关系/)
  assert.match(explorer, /提示词片段目录/)
  assert.match(explorer, /contentChars/)
  assert.doesNotMatch(explorer, /entry\.item\.content\b/)
  assert.match(explorer, /能力 Inspector/)
  assert.match(explorer, /原始运行时投影/)
  assert.match(explorer, /\/agent\/workbench/)
  assert.match(explorer, /Preserve that projection order/)
  assert.doesNotMatch(explorer, /sort\(\(a, b\).*item\.order/)
  assert.match(explorer, /console-runtime-binding-provider/)
  assert.match(page, /error \? null : \(/)
  const model = sourceText(join(SOURCE_ROOT, 'pages', 'introspection', 'capability-model.ts'))
  assert.match(model, /interface CapabilityRowMap/)
  assert.match(model, /commands: CommandRow/)
  assert.match(model, /middlewares: MiddlewareRow/)
  assert.match(model, /'prompt-sections': PromptSectionRow/)
  assert.match(explorer, /entriesForKind/)
  assert.match(explorer, /CollectionProps<'commands'>/)
  assert.match(explorer, /CollectionProps<'mcp'>/)
  assert.match(explorer, /CollectionProps<'prompt-sections'>/)
})

test('operations pages form a URL-addressable diagnostic loop', () => {
  const logs = sourceText(join(SOURCE_ROOT, 'pages', 'logs.tsx'))
  const workbench = sourceText(join(SOURCE_ROOT, 'pages', 'logs', 'LogWorkbench.tsx'))
  const plugin = sourceText(join(SOURCE_ROOT, 'pages', 'plugin-detail.tsx'))
  const cron = sourceText(join(SOURCE_ROOT, 'pages', 'cron.tsx'))

  assert.match(logs, /searchParams\.get\('q'\)/)
  assert.match(logs, /searchParamsRef/)
  assert.match(logs, /LogWorkbench/)
  assert.match(workbench, /事件 Inspector/)
  assert.match(workbench, /来源聚合/)
  assert.match(workbench, /连续事件流/)
  assert.match(workbench, /\/introspection\?tab=/)
  assert.match(workbench, /debug:/)
  assert.match(workbench, /getLevelMeta/)
  assert.match(workbench, /const occurrences = new Map<string, number>/)
  assert.doesNotMatch(workbench, /logIdentity\(log\).*index/)
  assert.doesNotMatch(workbench, /\.slice\(0, 8\)/)
  assert.match(workbench, /copyState === 'failed'/)
  assert.match(logs, /statsInFlightRef/)
  assert.match(logs, /logSnapshot/)
  assert.match(plugin, /\/logs\?q=/)
  assert.match(cron, /\/logs\?q=/)
})

test('the shared shell adapts across PC, Pad and Phone widths', () => {
  const layout = sourceText(join(SOURCE_ROOT, 'layouts', 'dashboard.tsx'))
  const design = sourceText(join(SOURCE_ROOT, 'design-system.css'))
  const grids = ['pages/endpoints.tsx', 'pages/plugins.tsx', 'pages/marketplace.tsx']
    .map((path) => sourceText(join(SOURCE_ROOT, path))).join('\n')

  assert.match(layout, /console-content-frame/)
  assert.doesNotMatch(layout, /max-w-7xl/)
  assert.match(design, /max-width: 105rem/)
  assert.match(design, /min-width: 768px.*max-width: 1199px/s)
  assert.match(design, /min-width: 1600px/)
  assert.match(grids, /2xl:grid-cols-4/)
})

test('Console shell only consumes public route metadata', () => {
  const layout = sourceText(join(SOURCE_ROOT, 'layouts', 'dashboard.tsx'))
  const routes = sourceText(join(SOURCE_ROOT, 'registerBuiltinShell.tsx'))
  assert.doesNotMatch(layout, /meta\?\.flush|"flush"|'flush'/)
  assert.doesNotMatch(routes, /flush\s*:/)
})

test('Endpoint transport uses canonical endpointKey and the public typed client event API', () => {
  const endpointSources = [
    'pages/endpoint-detail/useMessageHistory.ts',
    'pages/endpoint-detail/useEndpointConsole.tsx',
    'pages/endpoint-detail/useChannelManager.tsx',
    'pages/endpoint-detail/useGroupActions.ts',
    'pages/endpoint-detail/conversation-labels.ts',
  ].map((path) => sourceText(join(SOURCE_ROOT, path))).join('\n')
  assert.doesNotMatch(endpointSources, /data:\s*\{\s*adapter,\s*endpointId(?:\s*[,}])/)
  assert.match(endpointSources, /endpointKey/)

  const push = sourceText(join(SOURCE_ROOT, 'utils', 'endpoint-push.ts'))
  assert.match(push, /getWebSocketManager/)
  assert.match(push, /onConsoleEvent\(/)
  assert.match(push, /onConsoleEventRecoveryGap\(/)
  assert.match(push, /KnownConsoleEventEnvelope/)
  assert.doesNotMatch(push, /zhin-console-bot-push|zhin-console-event-recovery-gap/)
  assert.doesNotMatch(push, /addEventListener|dispatchEvent|callbacks/)
  assert.equal(sourceFiles().some((path) => path.endsWith('/sse-bridge.ts')), false)
  const history = sourceText(join(SOURCE_ROOT, 'pages', 'endpoint-detail', 'useMessageHistory.ts'))
  assert.match(history, /subscribeConsoleRecoveryGap/)
  const endpointConsole = sourceText(join(SOURCE_ROOT, 'pages', 'endpoint-detail', 'useEndpointConsole.tsx'))
  assert.match(endpointConsole, /subscribeConsoleRecoveryGap/)
  assert.match(endpointConsole, /loadRequestsFromServer\(\)/)
  assert.match(endpointConsole, /loadNoticesFromServer\(\)/)
  assert.match(endpointConsole, /loadInboxRequests\(false\)/)
  assert.match(endpointConsole, /loadInboxNotices\(false\)/)
  assert.match(endpointConsole, /unreadOnly:\s*true/)
  assert.match(history, /loadInboxMessages\(\)/)
})

test('Workroom selection is represented by projectId and runId in the URL', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'workrooms.tsx'))
  assert.match(source, /searchParams\.get\('projectId'\)/)
  assert.match(source, /searchParams\.get\('runId'\)/)
  assert.match(source, /setSearchParams\(\{ projectId, runId \}\)/)
})

test('Workroom configuration uses the runtime Catalog CAS contract', () => {
  const contract = sourceText(join(SOURCE_ROOT, 'contracts', 'zhin-console.ts'))
  assert.match(contract, /WORKROOMS_GET: 'workrooms:get'/)
  assert.match(contract, /WORKROOMS_SET: 'workrooms:set'/)
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'workroom-catalog.tsx'))
  assert.match(source, /type: CONSOLE_RPC\.WORKROOMS_GET/)
  assert.match(source, /type: CONSOLE_RPC\.WORKROOMS_SET/)
  assert.match(source, /expectedRevision: catalog\.revision/)
  assert.match(source, /restartRequired: false/)
  assert.doesNotMatch(source, /config:set|ai\.workrooms/)
})

test('Workroom members can bind a dedicated message projection Endpoint', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'workroom-catalog.tsx'))
  assert.match(source, /messageRoute\?: WorkroomMessageRoute/)
  assert.match(source, /消息出口投影/)
  assert.match(source, /继承主空间 Endpoint/)
  assert.match(source, /parseEndpointRouteKey\(selected\)/)
  assert.match(source, /validateWorkroomMessageRoutes/)
  assert.match(source, /firstMessageRouteIssue/)
  assert.match(source, /aria-invalid/)
  assert.doesNotMatch(source, /Promise\.allSettled/)
  assert.match(source, /const endpointRequest = requestConsole/)
  assert.match(source, /setLoading\(false\)[\s\S]*await endpointRequest/)
  assert.match(source, /useState<'loading' \| 'ready' \| 'error'>\('loading'\)/)
  assert.match(source, /validateKnownEndpoints: endpointInventoryState === 'ready'/)
  assert.match(source, /endpoint\.connected \? ' · online' : ' · offline'/)
  assert.match(source, /已由 .* 使用/)
})

test('Demo-capable mutation pages expose explicit read-only branches', () => {
  for (const path of [
    'pages/config.tsx',
    'pages/env.tsx',
    'pages/files/files-page.tsx',
    'pages/database/database-page.tsx',
    'pages/agent-sessions.tsx',
    'pages/endpoint-detail/index.tsx',
    'pages/logs.tsx',
    'pages/cron.tsx',
    'pages/dashboard.tsx',
    'pages/workroom-catalog.tsx',
    'pages/workrooms.tsx',
  ]) {
    const source = sourceText(join(SOURCE_ROOT, path))
    assert.match(source, /isDemoMode/, `${path} must derive its Demo permission boundary`)
    assert.match(source, /readOnly|DemoConfigPage|DemoWorkroom/, `${path} must render a read-only Demo state`)
  }
})

test('Demo config is split before the full-config hook can execute', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'config.tsx'))
  const editableStart = source.indexOf('function EditableConfigPage()')
  const hookCall = source.indexOf('useConfigYaml()', editableStart)
  const wrapper = source.indexOf('export default function ConfigPage()')
  assert.ok(editableStart >= 0 && hookCall > editableStart)
  assert.ok(wrapper > hookCall)
  assert.match(source.slice(wrapper), /isDemoMode\(\) \? <DemoConfigPage \/> : <EditableConfigPage \/>/)
})

test('released Zhin rich-message renderer is the single Markdown implementation', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'endpoint-detail', 'MessageBody.tsx'))
  assert.match(source, /import \{ MarkdownContent, cn, pickMediaRawUrl, resolveMediaSrc \} from '@zhin\.js\/client'/)
  assert.doesNotMatch(source, /function MarkdownContent\(/)
})

test('package manifest targets the released Zhin contract generation', () => {
  const manifest = JSON.parse(sourceText(join(ROOT, 'package.json')))
  assert.equal(manifest.dependencies['@zhin.js/client'], '^2.1.11')
  assert.equal(manifest.dependencies['@zhin.js/contract'], '^1.0.16')
  assert.equal(manifest.dependencies['@zhin.js/ai'], '^1.5.6')
  assert.match(manifest.dependencies.zod, /^\^4\./)
})
