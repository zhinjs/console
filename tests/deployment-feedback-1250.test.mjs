// Deployment feedback round zhinjs/zhin#1250: content width, instance log colours, self-check on
// loopback, purpose pickers, task classification, usage labels and Agent bindings.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { hasLeadingTime, parseAnsi, stripAnsi } from '../console-ui/src/utils/ansi-log.mjs'
import { groupSelectOptions, navigableValues, optionMatches } from '@zhin.js/console-ui'
import { profileChoiceGroup, purposeProfileChoices } from '../console-ui/src/pages/inference/model.mjs'
import { isPluginInternalSchedule, memoryScheduleLastRun, memoryScheduleTitle } from '../console-ui/src/pages/schedule-memory-model.mjs'
import { splitInternalTasks, taskOverviewRows } from '../console-ui/src/pages/task-overview-model.mjs'
import { mergeUsageModels, modelKey, usageModelLabel, usageSessionLabel } from '../console-ui/src/pages/token-usage-model.mjs'
import { bindingModel, recentAgentSessions } from '../console-ui/src/pages/agent-workbench-model.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'
import { SCOPE_TAB_LABELS } from '../console-ui/src/scope/scope-tree.mjs'

const src = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('content width: one column token; only split-pane workspaces opt out, never with their own caps', () => {
  assert.match(src('design-system.css'), /--console-content-max: 90rem;/)
  assert.match(src('design-system.css'), /\.console-content-frame \{\s*max-width: var\(--console-content-max\);/)
  const shell = src('registerBuiltinShell.tsx')
  const wide = shell.split('app.addRoute(').filter(block => /fullWidth: true/.test(block)).map(block => /path: P\.(\w+)/.exec(block)[1]).sort()
  assert.deepEqual(wide, ['aiWorkroomCatalog', 'aiWorkrooms', 'logs', 'opsDatabase', 'opsTerminal', 'scenarioLab', 'scopeConversation', 'scopeEndpoint'].sort())
  for (const tableLike of ['features', 'introspection', 'accessAudit']) {
    assert.doesNotMatch(shell, new RegExp(`path: P\\.${tableLike},[^\\n]*fullWidth`), `${tableLike} uses the content column`)
  }
  // A page-level max-w-[…px] / max-w-6xl would make a second, left-aligned width.
  const pages = []
  const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (path.endsWith('.tsx')) pages.push(path) } }
  walk(new URL('../console-ui/src/pages', import.meta.url).pathname)
  for (const path of pages) assert.doesNotMatch(readFileSync(path, 'utf8'), /<PageShell[^>]*max-w-(?:\[\d+px\]|[4-7]xl)/, path)
  assert.doesNotMatch(src('design-system.css'), /\.console-dashboard \{[^}]*max-width: 92rem/)
})

test('instance logs: SGR colours become theme tones, other escapes are dropped, ESC-less remnants are read too', () => {
  const line = '\u001b[90m[13:33:58.147]\u001b[39m \u001b[34m[INFO]\u001b[39m \u001b[1mready\u001b[22m \u001b]0;title\u0007\u001b[2K\u001b[38;5;196mplain\u001b[0m'
  const segments = parseAnsi(line)
  assert.deepEqual(segments.map(({ text, tone, bold }) => [text, tone, bold]), [
    ['[13:33:58.147]', 'muted', false], [' ', null, false], ['[INFO]', 'info', false], [' ', null, false], ['ready', null, true], [' plain', null, false],
  ])
  assert.equal(stripAnsi(line), '[13:33:58.147] [INFO] ready plain')
  const remnant = '[90m[13:33:58.147][39m[34m[INFO][39m [31mfailed[39m'
  assert.equal(stripAnsi(remnant), '[13:33:58.147][INFO] failed')
  assert.equal(parseAnsi(remnant).find(segment => segment.text === 'failed').tone, 'danger')
  assert.equal(stripAnsi('array[1m] stays text'), 'array[1m] stays text', 'a single bracket remnant is not taken for a colour code')
  assert.equal(stripAnsi('a\u0007b\u0000c'), 'abc')
  for (const own of [line, remnant, '2026-11-14 13:33:58 boot', '13:33:58,120 x']) assert.equal(hasLeadingTime(own), true, own)
  for (const plain of ['[preview] 加载插件', 'Error: 13:33 late']) assert.equal(hasLeadingTime(plain), false, plain)
  const page = src('pages/ops/instance.tsx')
  assert.match(page, /<AnsiText text=\{line\.line\} \/>/)
  assert.match(page, /ownTime \|\| !collected \? null/, 'a line with its own time does not repeat the collection time')
  assert.match(page, /title=\{collected \? i18n\.t\("采集于 \{0\}"/, 'the collection time moves to the tooltip')
  assert.match(src('components/ansi-text.css'), /\.console-ansi-muted \{ color: hsl\(var\(--muted-foreground\)\); \}/)
})

test('searchable select: groups keep first-appearance order, the empty choice survives any query', () => {
  const options = [
    { value: '', label: '未设置' },
    { value: 'a', label: 'Gemini Flash', group: 'Night Router', keywords: 'gemini-3.8-flash' },
    { value: 'b', label: 'DeepSeek Flash', group: 'DeepSeek' },
    { value: 'c', label: '子 Agent · planner', group: 'Agent 绑定', disabled: true },
    { value: 'd', label: 'Gemini Pro', group: 'Night Router' },
  ]
  assert.deepEqual(groupSelectOptions(options).map(entry => [entry.group, entry.options.map(option => option.value)]), [
    [null, ['']], ['Night Router', ['a', 'd']], ['DeepSeek', ['b']], ['Agent 绑定', ['c']],
  ])
  assert.deepEqual(groupSelectOptions(options, 'flash').map(entry => [entry.group, entry.options.map(option => option.value)]), [
    [null, ['']], ['Night Router', ['a']], ['DeepSeek', ['b']],
  ])
  assert.equal(optionMatches(options[1], 'router 3.8'), true, 'terms match label, keywords and group together')
  assert.deepEqual(navigableValues(groupSelectOptions(options)), ['', 'a', 'd', 'b'], 'disabled options are skipped')
})

test('purpose pickers: profiles grouped by service, Agent-only profiles in their own group, last', () => {
  const view = {
    services: {
      s1: { id: 's1', label: 'Night Router', driver: { id: 'd', owner: 'o', contractVersion: '1' }, models: { flash: { id: 'flash', kinds: ['language'] }, img: { id: 'img', kinds: ['image'] } } },
      s2: { id: 's2', driver: { id: 'd', owner: 'o', contractVersion: '1' }, models: { ds: { id: 'ds', kinds: ['language', 'decision'] } } },
    },
    accounts: { a1: { id: 'a1', serviceId: 's1', label: 'main' }, a2: { id: 'a2', serviceId: 's2' } },
    profiles: {
      p1: { id: 'p1', accountId: 'a1', model: 'flash', label: 'Gemini Flash' },
      p2: { id: 'p2', accountId: 'a2', model: 'ds', label: '子 Agent · 小编 planner · DeepSeek Flash' },
      p3: { id: 'p3', accountId: 'a2', model: 'ds' },
      p4: { id: 'p4', accountId: 'a1', model: 'img' },
    },
    drivers: [{ id: 'd', owner: 'o', contractVersion: '1', label: 'OpenAI compatible' }],
    purposes: { defaults: { chat: 'p1' }, agents: { helper: 'p3' } },
  }
  const choices = purposeProfileChoices(view, 'language')
  assert.deepEqual(choices.map(choice => [choice.value, choice.group]), [
    ['p1', 'Night Router'], ['p2', 'Agent 绑定'], ['p3', 'Agent 绑定'],
  ].sort((a, b) => (a[1] === 'Agent 绑定') - (b[1] === 'Agent 绑定')))
  assert.equal(choices[0].description, 'flash · main')
  assert.match(choices[0].keywords, /Night Router/)
  assert.deepEqual(purposeProfileChoices(view, 'image').map(choice => choice.value), ['p4'])
  assert.equal(profileChoiceGroup({ ...view, purposes: { defaults: { chat: 'p3' }, agents: { helper: 'p3' } } }, view.profiles.p3, 'en').label, 'OpenAI compatible', 'a profile chat also uses stays under its service')
  assert.equal(profileChoiceGroup(view, view.profiles.p2, 'en').label, 'Agent bindings')
  const purposes = src('pages/inference/Purposes.tsx')
  // ADR 0066 adds the interjection judge's model and compared-model pickers.
  assert.equal((purposes.match(/<SearchableSelectField/g) ?? []).length, 10, 'every model picker is searchable; mode / level selects stay plain')
  const profiles = src('pages/inference/Profiles.tsx')
  assert.match(profiles, /i18n\.t\("正在使用"\)/)
  assert.match(profiles, /未被用途引用的模型（\{0\}）/)
  assert.match(profiles, /当前聊天模型/)
})

test('navigation and role names: 核心 / 插件页面 in the 功能 menu; Console 角色 and 聊天角色 are told apart', () => {
  const layout = src('layouts/dashboard.tsx')
  assert.match(layout, /section\.groups\.map/)
  assert.match(layout, /DropdownMenuLabel className="console-topnav-menu-label"/)
  assert.match(src('bootstrap/loadConsoleEntries.ts'), /route\.element\.type === AdapterConsolePage/)
  assert.match(src('registerBuiltinShell.tsx'), /name: 'Console 角色'/)
  assert.match(src('i18n/navigation.ts'), /"\/access\/roles": "Console 角色"/)
  assert.equal(SCOPE_TAB_LABELS.roles, '聊天角色')
  for (const key of ['核心', '插件页面', 'Console 角色', '聊天角色']) assert.equal(typeof englishMessages[key], 'string', key)
  assert.equal(englishMessages['Console 角色'], 'Console roles')
  assert.equal(englishMessages['聊天角色'], 'Chat roles')
})

test('schedules: plugin housekeeping is its own folded type with a readable title and its last run', () => {
  const rss = { type: 'memory', id: 'rss/poll_feeds', kind: 'plugin-internal', title: '轮询 RSS 订阅', titleI18n: { en: 'Poll RSS feeds' }, description: 'Poll RSS subscriptions',
    expression: '*/20 * * * * *', running: true, plugin: 'root/rss', lastExecutedAt: 1_000, lastStatus: 'succeeded' }
  const broken = { ...rss, id: 'bili/poll', title: 'B 站轮询', titleI18n: undefined, lastStatus: 'failed', lastError: 'timeout' }
  const legacy = { type: 'memory', id: '__zhin_plugin__4_root_6_remind___reminders/scan', description: '', expression: '0 * * * * *', running: true, plugin: 'root/remind' }
  assert.equal(isPluginInternalSchedule(rss), true)
  assert.equal(isPluginInternalSchedule(legacy), false, 'an older Host has no kind: nothing is folded')
  assert.equal(memoryScheduleTitle(rss, 'en'), 'Poll RSS feeds')
  assert.equal(memoryScheduleTitle(rss, 'zh-CN'), '轮询 RSS 订阅')
  assert.equal(memoryScheduleTitle(legacy), 'remind')
  assert.deepEqual(memoryScheduleLastRun(broken), { status: 'failed', at: 1_000, error: 'timeout' })
  assert.equal(memoryScheduleLastRun(legacy), null)
  assert.deepEqual(memoryScheduleLastRun({ lastRun: { startedAt: 5, status: 'succeeded' } }), { status: 'succeeded', at: 5, error: null })
  const { rows } = taskOverviewRows({ admin: { providers: [] }, schedules: { memory: [rss, broken, legacy], persistent: [] }, assistant: { jobs: [] } }, 'zh-CN')
  const byId = Object.fromEntries(rows.map(row => [row.key.split(':')[1], row]))
  assert.equal(byId['rss/poll_feeds'].type, 'internal')
  assert.equal(byId['rss/poll_feeds'].typeLabel, '插件内部任务')
  assert.equal(byId['rss/poll_feeds'].lastResult.label, '成功')
  assert.equal(byId['rss/poll_feeds'].lastResult.at, 1_000)
  assert.equal(byId['bili/poll'].lastResult.tone, 'destructive')
  assert.equal(byId['bili/poll'].lastResult.error, 'timeout')
  assert.equal(byId[legacy.id].typeLabel, '定时提醒')
  const { main, internal } = splitInternalTasks(rows)
  assert.deepEqual(internal.map(row => row.title), ['轮询 RSS 订阅'])
  assert.ok(main.some(row => row.title === 'B 站轮询'), 'a failing internal task stays where problems are read')
  for (const page of ['pages/cron.tsx', 'pages/TaskOverview.tsx', 'pages/task-hub.tsx']) {
    assert.match(src(page), /SCHEDULE_LIST, locale: i18n\.locale/, `${page} asks for localized titles`)
  }
})

test('usage: rows the Host labels merge per 「服务名 · 模型」, series follow; unlabeled Hosts are unchanged', () => {
  const tokens = (calls, inputTokens) => ({ calls, inputTokens, outputTokens: calls, cacheReadTokens: 0 })
  const stats = {
    range: { since: 0, until: 1, bucket: 'day' }, totals: { turns: 1, ...tokens(9, 100), cacheShare: 0 }, segments: { history: 0, fixed: 0, user: 0 }, bySession: [],
    byModel: [
      { provider: 'services:7dfb', model: 'ag/gemini-3.8-flash', label: 'Night Router · gemini-3.8-flash', ...tokens(5, 60), cacheShare: 0.5 },
      { provider: 'accounts:91aa', model: 'ag/gemini-3.8-flash', serviceLabel: 'Night Router', modelLabel: 'gemini-3.8-flash', ...tokens(4, 0) },
      { provider: 'deepseek', model: 'chat', ...tokens(1, 40) },
    ],
    series: [{ bucketStart: 0, ...tokens(9, 100), byModel: { 'services:7dfb/ag/gemini-3.8-flash': 60, 'accounts:91aa/ag/gemini-3.8-flash': 0, 'deepseek/chat': 40 } }],
  }
  assert.equal(usageModelLabel(stats.byModel[1]), 'Night Router · gemini-3.8-flash')
  const merged = mergeUsageModels(stats)
  assert.deepEqual(merged.byModel.map(row => [modelKey(row.provider, row.model), row.calls, row.inputTokens]), [
    ['Night Router · gemini-3.8-flash', 9, 60], ['deepseek/chat', 1, 40],
  ])
  assert.equal(merged.byModel[0].cacheShare, undefined, 'a merged row recomputes its cache share')
  assert.deepEqual(merged.series[0].byModel, { 'Night Router · gemini-3.8-flash': 60, 'deepseek/chat': 40 })
  const plain = { ...stats, byModel: [stats.byModel[2]] }
  assert.equal(mergeUsageModels(plain), plain)
  assert.equal(usageSessionLabel({ sessionKey: 'personal-session:v1:8ceb', label: '小明的私聊' }), '小明的私聊')
  assert.equal(usageSessionLabel({ sessionKey: 'icqq:bot:group:123' }), '123')
  const page = src('pages/token-usage.tsx')
  assert.match(page, /每次模型调用的实际输入之和/)
  assert.match(page, /按每个回合的上下文预算估算/)
  assert.match(page, /按本机时区 \{0\} 显示/)
})

test('Agent workbench: the binding in force wins over the configured one; recent conversations include traces', () => {
  assert.deepEqual(bindingModel({ provider: '', model: '', effective: { serviceLabel: 'Night Router', model: 'gemini-3.8-flash' } }), { provider: 'Night Router', model: 'gemini-3.8-flash', source: 'effective' })
  assert.deepEqual(bindingModel({ provider: 'openai', model: 'gpt' }), { provider: 'openai', model: 'gpt', source: 'configured' })
  assert.deepEqual(bindingModel({ provider: '', model: '', effective: {} }), { provider: '', model: '', source: 'default' })
  const recent = recentAgentSessions(['qq:b:group:1'], [
    { sessionKey: 'qq:b:group:1', turns: 3 },
    { sessionKey: 'qq:b:private:2', turns: 9 },
    { sessionKey: 'qq:b:group:3', turns: 1, lastAt: 50, label: '发布群' },
  ])
  assert.deepEqual(recent.map(row => [row.key, row.source, row.label]), [
    ['qq:b:group:1', 'local', ''], ['qq:b:group:3', 'trace', '发布群'], ['qq:b:private:2', 'trace', ''],
  ])
  assert.equal(recentAgentSessions([], null).length, 0)
  assert.equal(recentAgentSessions([], Array.from({ length: 9 }, (_, i) => ({ sessionKey: `k${i}` }))).length, 6)
  assert.match(src('pages/agent-workbench.tsx'), /\('root', 'usage-stats', \{ since:/)
})
