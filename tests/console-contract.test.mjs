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
  assert.match(source, /path: P\.agentWorkbench,/)
  assert.match(source, /path: P\.aiWorkrooms,/)
  assert.match(source, /path: P\.aiWorkroomCatalog,/)
  assert.match(source, /path: P\.agentSessions,/)
  assert.match(source, /path: P\.aiWorkroomCatalog,[\s\S]*?hideInMenu: true/)
  assert.doesNotMatch(source, /\/agent\/(?:studio|orchestration)/)
})

test('work-oriented navigation preserves ordinary-user names and legacy plugin groups', () => {
  const source = sourceText(join(SOURCE_ROOT, 'registerBuiltinShell.tsx'))
  const taxonomy = sourceText(join(SOURCE_ROOT, 'navigation-taxonomy.ts'))
  // Published plugin groups remain compatible; builtin placement follows the approved work navigation.
  assert.match(taxonomy, /BOT: '机器人'/)
  assert.match(taxonomy, /ADVANCED: '高级'/)
  assert.match(taxonomy, /'\/sandbox': \{ group: NAV_GROUPS\.WORK/)
  const routeGroup = (key) => {
    const start = source.indexOf(`path: P.${key},`)
    assert.notEqual(start, -1, key)
    const block = source.slice(start, source.indexOf('})', start))
    return { name: /name: '([^']+)'/.exec(block)?.[1], group: /group: NAV_GROUPS\.(\w+)/.exec(block)?.[1], hidden: /hideInMenu: true/.test(block) }
  }
  const primary = { dashboard: ['首页','OVERVIEW'], logs: ['运行日志','OVERVIEW'], scope: ['账号与会话','WORK'], agentSessions: ['聊天记录','WORK'], opsSchedules: ['定时任务','OPS'] }
  for (const [key, [name,group]] of Object.entries(primary)) assert.deepEqual(routeGroup(key), { name, group, hidden: false })
  assert.deepEqual(routeGroup('plugins'), { name: '插件管理', group: 'PLUGINS', hidden: false })
  assert.deepEqual(routeGroup('marketplace'), { name: '插件市场', group: 'PLUGINS', hidden: false })
  assert.deepEqual(routeGroup('aiAmbient'), { name: '群聊插话', group: 'FEATURES', hidden: false })
  assert.match(source, /path: P\.aiAmbient,[\s\S]*?requiredPermissions: \[AMBIENT_STATUS_PERMISSION\]/)
  assert.deepEqual(routeGroup('aiSkills'), { name: '技能助手', group: 'FEATURES', hidden: false })
  assert.match(source, /path: P\.aiSkills,[\s\S]*?requiredPermissions: \[SKILLS_STATUS_PERMISSION\]/)
  assert.equal(routeGroup('agentWorkbench').group, 'OVERVIEW')
  // 决策回放挂在「机器人状态」下（ADR 0036 切片 C），不进菜单，入口在机器人状态页
  assert.deepEqual(routeGroup('agentReplay'), { name: '决策回放', group: 'OVERVIEW', hidden: true })
  assert.match(source, /path: P\.agentReplay,[\s\S]*?parent: P\.agentWorkbench,[\s\S]*?requiredPermissions: \[REPLAY_PERMISSION\]/)
  assert.match(sourceText(join(SOURCE_ROOT, 'pages', 'agent-workbench.tsx')), /to="\/agent\/replay"/)
  for (const key of ['opsConfig', 'opsEnv', 'opsFiles', 'opsDatabase', 'opsInstance', 'opsTerminal']) assert.equal(routeGroup(key).group, 'OPS', key)
  for (const key of ['features', 'ai', 'introspection', 'scenarioLab', 'aiWorkrooms']) assert.equal(routeGroup(key).group, 'FEATURES', key)
  assert.doesNotMatch(source, /'对话分支'|'Agent 概览'|judge|decision|TypeSafe|shadow/)
  const entries = sourceText(join(SOURCE_ROOT, 'bootstrap', 'loadConsoleEntries.ts'))
  assert.match(entries, /placePluginRoute\(route, declaredSections\.get\(route\.path\)\)/)
  const layout = sourceText(join(SOURCE_ROOT, 'layouts', 'dashboard.tsx'))
  assert.match(layout, /buildNavigation\(routes, access\)/)
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
  assert.match(logs, /historyQuery\(searchParams\)/)
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
  assert.match(explorer, /aria-label=\{i18n\.t\("能力详情"\)\}/)
  assert.match(explorer, /<JsonViewer value=\{item\}/)
  const jsonViewer = sourceText(join(SOURCE_ROOT, 'pages', 'introspection', 'JsonViewer.tsx'))
  assert.match(jsonViewer, /查看 JSON 原文/)
  assert.match(jsonViewer, /highlightCode\(source, 'json'\)/)
  assert.match(explorer, /\/agent\/workbench/)
  assert.match(explorer, /Preserve that projection order/)
  assert.doesNotMatch(explorer, /sort\(\(a, b\).*item\.order/)
  assert.match(explorer, /console-runtime-binding-provider/)
  assert.match(page, /error && !data \? null : \(/)
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

  assert.match(logs, /historyQuery\(searchParams\)/)
  assert.match(logs, /searchParamsRef/)
  assert.match(logs, /LogWorkbench/)
  assert.match(workbench, /事件 Inspector/)
  assert.match(workbench, /全部历史来源/)
  assert.match(workbench, /历史事件/)
  assert.match(workbench, /\/introspection\?tab=/)
  assert.match(workbench, /debug:/)
  assert.match(workbench, /getLevelMeta/)
  assert.match(workbench, /id:String\(log\.id\)/)
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

test('remote Agent playground styles are retained by the Tailwind source scanner', () => {
  const source = sourceText(join(SOURCE_ROOT, 'agent-playground.css'))
  const contract = sourceText(join(SOURCE_ROOT, 'remote-entry-style-contract.ts'))
  const clientStyles = sourceText(join(ROOT, 'client', 'style.css'))
  const playgroundClasses = new Set(
    [...source.matchAll(/\.((?:agent-playground)[A-Za-z0-9_-]*)/g)].map((match) => match[1]),
  )
  const retainedClasses = new Set(
    [...contract.matchAll(/['"]((?:agent-playground)[A-Za-z0-9_-]*)['"]/g)].map((match) => match[1]),
  )
  const missing = [...playgroundClasses].filter((className) => !retainedClasses.has(className))

  assert.ok(playgroundClasses.size > 50, 'expected the complete remote Agent playground style contract')
  assert.deepEqual(missing, [])
  assert.match(clientStyles, /@import "\.\.\/console-ui\/src\/agent-playground\.css";/)
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
  assert.match(push, /getConsoleTransport/)
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
  assert.match(endpointConsole, /type: 'endpoint\.test'/)
  assert.match(endpointConsole, /测试失败/)
  assert.match(history, /loadInboxMessages\(\)/)
})

test('plugin package changes are gateway transactions with a plan, and config validation stays', () => {
  const marketplace = sourceText(join(SOURCE_ROOT, 'pages', 'marketplace.tsx'))
  const detail = sourceText(join(SOURCE_ROOT, 'pages', 'plugin-detail.tsx'))
  const action = sourceText(join(SOURCE_ROOT, 'pages', 'PackageAction.tsx'))
  const model = sourceText(join(SOURCE_ROOT, 'pages', 'plugin-package-model.mjs'))
  const config = sourceText(join(SOURCE_ROOT, 'components', 'PluginConfigForm', 'index.tsx'))

  // ADR 0054 §4: the instance-side install path is gone from every page.
  for (const text of [marketplace, detail, action, model]) assert.doesNotMatch(text, /'plugin:(?:install|update|uninstall|plan-install|plan-update|plan-uninstall)'/)
  assert.match(marketplace, /packageAction\.prepare\('install'/)
  assert.match(action, /GATEWAY_RPC\.PACKAGES_PLAN/)
  assert.match(action, /GATEWAY_RPC\.PACKAGES_LIST/)
  assert.match(model, /GATEWAY_RPC\.PACKAGES_INSTALL/)
  assert.match(model, /GATEWAY_RPC\.PACKAGES_UPDATE/)
  assert.match(model, /GATEWAY_RPC\.PACKAGES_UNINSTALL/)
  assert.match(action, /useActionReceipt/)
  assert.match(action, /ConfigurationNeedsPanel/)
  assert.match(detail, /plugin:diagnose/)
  assert.match(config, /plugin:validate-config/)
  assert.match(config, /missingEnv/)
})

test('Workroom records read the Engagement projection the current Host serves', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'workrooms.tsx'))
  const contract = sourceText(join(SOURCE_ROOT, 'contracts', 'zhin-console.ts'))
  // ADR 0048 replaced Run/Task/Assignment with Engagements; the removed REST path must not return.
  for (const text of [source, contract]) assert.doesNotMatch(text, /agent\/workroom\/runs|WORKROOM_RUNS|workroom\.profile/)
  assert.match(source, /useEngagements\(ENGAGEMENT_LIMIT\)/)
  assert.match(source, /useEngagementDetail\(selectedId\)/)
  assert.match(source, /useVenues\(\)/)
  assert.match(source, /from '@zhin\.js\/client'/)
})

test('Workroom selection is represented by engagementId in the URL', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'workrooms.tsx'))
  assert.match(source, /searchParams\.get\('engagementId'\)/)
  assert.match(source, /setSearchParams\(\{ engagementId: item\.engagementId \}\)/)
})

test('Workroom read errors never masquerade as an empty record list', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'workrooms.tsx'))
  assert.match(source, /\) : error \? \(\s*<StatusState error=\{error\}[^\n]*onRetry=\{refresh\} \/>/)
  assert.match(source, /\) : error \? \([\s\S]*无法读取协作记录[\s\S]*\) : \([\s\S]*还没有协作记录/)
  assert.match(source, /detail\.summary\.engagementId === selectedId/)
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

test('mutation pages derive their read-only state from Host-reported permissions', () => {
  for (const [path, permission] of [
    ['pages/env.tsx', 'ops.env.write'],
    ['pages/files/files-page.tsx', 'ops.files.write'],
    ['pages/database/database-page.tsx', 'ops.database.write'],
    ['pages/agent-sessions.tsx', 'endpoint.operate'],
    ['pages/endpoint-detail/index.tsx', 'endpoint.operate'],
    ['pages/logs.tsx', 'ops.config.write'],
    ['pages/cron.tsx', 'ops.schedule.write'],
    ['pages/dashboard.tsx', 'agent.configure'],
    ['pages/workroom-catalog.tsx', 'agent.configure'],
  ]) {
    const source = sourceText(join(SOURCE_ROOT, path))
    assert.ok(source.includes(`const readOnly = !hasConsolePermission('${permission}')`), `${path} must gate writes on ${permission}`)
  }
})

test('demo mode is removed: no build flag, bootstrap, onboarding or demo-only branches remain', () => {
  const clientFiles = ['main.tsx', 'console-app/ConsoleView.tsx', 'host/ConsoleWebHost.tsx'].map(file => join(ROOT, 'client', file))
  for (const path of [...sourceFiles(), ...clientFiles, join(ROOT, 'farm.config.ts')]) {
    const source = sourceText(path)
    assert.doesNotMatch(source, /isDemoMode|VITE_DEMO_MODE|demo-mode|DemoOnboarding|runDemoBootstrap|__ZHIN_DEMO_MODE__/, relative(ROOT, path))
  }
  const config = sourceText(join(SOURCE_ROOT, 'pages', 'config.tsx'))
  assert.match(config.slice(config.indexOf('export default function ConfigPage()')), /return <EditableConfigPage \/>/)
  const pkg = JSON.parse(sourceText(join(ROOT, 'package.json')))
  assert.equal(pkg.scripts['dev:demo'], undefined)
  // The hosted demo deployment still runs build:demo; it must be the plain build, never a demo mode.
  assert.equal(pkg.scripts['build:demo'], 'farm build')
})

test('full config editor uses revision-checked source RPCs', () => {
  const source = sourceText(join(SOURCE_ROOT, 'hooks', 'useConfigSource.ts'))
  assert.match(source, /type: 'config:get-source'/)
  assert.match(source, /type: 'config:replace-source'/)
  assert.match(source, /expectedRevision: config\.revision/)
  assert.doesNotMatch(source, /config:(?:get|save)-yaml/)
})

test('released Zhin rich-message renderer is the single Markdown implementation', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'endpoint-detail', 'MessageBody.tsx'))
  assert.match(source, /import \{ MarkdownContent, cn, pickMediaRawUrl, resolveMediaSrc \} from '@zhin\.js\/client'/)
  assert.doesNotMatch(source, /function MarkdownContent\(/)
})

test('package manifest targets the released Zhin contract generation', () => {
  const manifest = JSON.parse(sourceText(join(ROOT, 'package.json')))
  // One SDK generation: the tilde ranges keep npm from resolving the unrelated 1.5.x / 2.x lines.
  assert.equal(manifest.dependencies['@zhin.js/client'], '~1.1.31')
  assert.equal(manifest.dependencies['@zhin.js/contract'], '~1.1.22')
  assert.equal(manifest.dependencies['@zhin.js/ai'], '~1.1.54')
  assert.equal(Object.keys(manifest.dependencies).some(name => name.startsWith('@zhin.js/client-')), false)
  const lock = sourceText(join(ROOT, 'pnpm-lock.yaml'))
  for (const name of ['client', 'contract', 'console-protocol', 'ai']) {
    const versions = new Set([...lock.matchAll(new RegExp(`^  '@zhin\\.js/${name}@([^'(]+)`, 'gm'))].map(match => match[1]))
    assert.equal(versions.size, 1, `@zhin.js/${name} resolves to ${[...versions].join(', ')}`)
  }
  assert.equal(sourceFiles().some(path => /@zhin\.js\/client-sdk|getWebSocketManager|useWebSocket\b/.test(sourceText(path))), false)
  assert.match(manifest.dependencies.zod, /^\^4\./)
})
