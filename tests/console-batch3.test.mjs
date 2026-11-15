// Console batch 3: fallback models for every language purpose (zhinjs/console#64, Host #1250), the
// C4 review leftovers (D15.1 / D15.4 / D18.2, a fixed clock, adapter-scoped chat members) and the
// `/features/ai?account=` / `?tab=purposes` deep links. Every block also checks an older Host.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as jsxRuntime from 'react/jsx-runtime'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'
import * as model from '../console-ui/src/pages/inference/model.mjs'
import * as entry from '../console-ui/src/pages/inference/models-entry.mjs'
import { mergePrincipalPayloads, principalsListPlan, readPrincipals, settlePrincipalLists } from '../console-ui/src/scope/chat-identity-model.mjs'
import { createConsoleAccess, scopedAdapters } from '../console-ui/src/utils/console-access.mjs'
import { canSeeRoute } from '../console-ui/src/navigation-sections.mjs'

const source = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const NOW = Date.UTC(2026, 10, 15, 8, 0, 0)

function view({ fallbacks = true, purposes } = {}) {
  const profile = (id, model) => ({ id, accountId: 'acc', model, label: id.toUpperCase() })
  return {
    rootId: '/host', ownerId: 'host', revision: 1, hostAdministrator: true, deployment: [], drivers: [], statuses: {},
    services: { svc: { id: 'svc', label: 'Service', driver: { id: 'd' }, models: { a: { kinds: ['language'] }, b: { kinds: ['language'] }, c: { kinds: ['language'] }, img: { kinds: ['image'] } } } },
    accounts: { acc: { id: 'acc', serviceId: 'svc', label: 'Main' } },
    profiles: { pa: profile('pa', 'a'), pb: profile('pb', 'b'), pc: profile('pc', 'c'), pi: profile('pi', 'img') },
    purposes: purposes ?? { defaults: {}, decisions: {} },
    ...(fallbacks ? { modelAvailability: {
      notice: '本轮由备用模型回答',
      unavailable: [{ accountId: 'acc', model: 'a', reason: 'quota_exhausted', since: NOW - 60_000, until: NOW + 3_600_000 }],
      recentFallbacks: [{ purpose: 'chat', from: { profileId: 'pa', accountId: 'acc', model: 'a' }, to: { profileId: 'pb', accountId: 'acc', model: 'b' },
        reason: 'quota_exhausted', phase: 'request', at: NOW - 30_000, notice: '本轮由备用模型回答' }],
    } } : {}),
  }
}

test('purposePlan writes every language purpose as { profile, fallbacks } in the Host plan shape', () => {
  const draft = {
    defaults: { chat: 'pa', chatFallbacks: ['pb', 'pc'], summary: 'pb', summaryFallbacks: ['pa'], ambient: 'pc', ambientFallbacks: [], image: 'pi', perception: { profile: 'pa', fallbacks: ['pb'] } },
    decisions: {}, agents: { researcher: 'pa', writer: 'pb' }, agentFallbacks: { researcher: ['pc'] },
    adapters: { qq: { chat: 'pb', chatFallbacks: ['pb', 'pa', 'pa', ''] } }, endpoints: { 'qq/bot': { chat: 'pc' } }, scenes: { s1: { chat: 'pa', chatFallbacks: ['pc'] } },
  }
  const plan = model.purposePlan(draft, { defaults: {}, adapters: { old: {} } })
  assert.deepEqual(plan.chat, { profile: 'pa', fallbacks: ['pb', 'pc'] })
  assert.deepEqual(plan.summary, { profile: 'pb', fallbacks: ['pa'] })
  assert.deepEqual(plan.ambient, { profile: 'pc' }, 'an empty chain is left out (the Host refuses fallbacks: [])')
  assert.deepEqual(plan.image, { profile: 'pi' }, 'image generation has no chain')
  assert.deepEqual(plan.perception, { profile: 'pa', fallbacks: ['pb'] })
  assert.deepEqual(plan.agents, { researcher: { profile: 'pa', fallbacks: ['pc'] }, writer: { profile: 'pb' } })
  assert.deepEqual(plan.adapters, { old: null, qq: { chat: { profile: 'pb', fallbacks: ['pa'] }, perception: null } }, 'blanks, repeats and the primary are dropped')
  assert.deepEqual(plan.endpoints['qq/bot'].chat, { profile: 'pc' })
  assert.deepEqual(plan.scenes, { s1: { chat: { profile: 'pa', fallbacks: ['pc'] } } })
  // An older Host never sees `fallbacks` outside vision, even if a draft carried a chain.
  const legacy = model.purposePlan(draft, draft, { fallbacks: false })
  assert.deepEqual(legacy.chat, { profile: 'pa' })
  assert.deepEqual(legacy.agents.researcher, { profile: 'pa' })
  assert.deepEqual(legacy.scenes.s1.chat, { profile: 'pa' })
  assert.deepEqual(legacy.perception, { profile: 'pa', fallbacks: ['pb'] }, 'the vision chain predates #1250')
})

test('chain helpers: clean, move, Host support, usage and newly bound profiles', () => {
  assert.deepEqual(model.cleanFallbacks('pa', ['pa', 'pb', '', 'pb', 'pc', 1]), ['pb', 'pc'])
  assert.deepEqual(model.languageReference('pa', []), { profile: 'pa' })
  assert.deepEqual(model.moveFallback(['x', 'y', 'z'], 2, -1), ['x', 'z', 'y'])
  assert.deepEqual(model.moveFallback(['x', 'y'], 0, -1), ['x', 'y'], 'out of range is a no-op')
  assert.equal(model.supportsPurposeFallbacks(view()), true)
  assert.equal(model.supportsPurposeFallbacks(view({ fallbacks: false })), false)
  assert.equal(model.supportsPurposeFallbacks(undefined), false)
  const purposes = { defaults: { chat: 'pa', chatFallbacks: ['pb'] }, agents: { r: 'pa' }, agentFallbacks: { r: ['pc'] }, adapters: { qq: { chat: 'pa', chatFallbacks: ['pc'] } } }
  assert.deepEqual(model.profileUsages(purposes, 'pb').map(row => row.label), ['默认聊天（备选）'])
  assert.equal(model.profileUsages(purposes, 'pc', 'en')[0].label, 'Agent r (fallback)')
  assert.equal(model.profileUsages(purposes, 'pc').length, 2, 'an agent chain and an adapter chain')
  assert.deepEqual(model.newlyBoundLanguageProfiles(purposes, { defaults: { chat: 'pa' } }).sort(), ['pb', 'pc'], 'a newly added fallback is probed before saving too')
})

test('modelAvailability: skipped models and recent switches, with a fixed clock', () => {
  const v = view()
  const skip = model.profileAvailability(v, 'pa', NOW)
  assert.equal(skip.reason, 'quota_exhausted')
  assert.equal(model.profileAvailability(v, 'pb', NOW), undefined)
  assert.equal(model.profileAvailability(v, 'pa', NOW + 3_600_000), undefined, 'expired skips are not shown')
  assert.match(model.describeUnavailability(skip), /^暂时跳过：额度用完，.+ 恢复$/u)
  assert.match(model.describeUnavailability(skip, 'en'), /^Skipped for now: Quota exhausted; back at /u)
  const [row] = model.recentFallbackRows(v)
  assert.deepEqual({ purpose: row.purpose, from: row.from, to: row.to, reason: row.reason }, { purpose: '聊天', from: 'PA', to: 'PB', reason: '额度用完' })
  assert.deepEqual(model.recentFallbackRows(view({ fallbacks: false })), [])
  assert.equal(model.recentFallbackRows({ ...v, modelAvailability: { recentFallbacks: [{ purpose: 'agent:planner', from: { profileId: 'gone', model: 'm' }, to: { profileId: 'pb' }, reason: 'odd' }] } }, 'en')[0].purpose, 'Agent planner')
})

async function purposesPage(v) {
  const runtime = pageRuntime(), plans = []
  const management = { view: v, source: { view: v }, busy: false, pending: null, active: () => true, setError: assert.fail,
    request: async path => path === '/probe' ? { status: 'ok', durationMs: 1 } : { adapters: [{ platform: 'qq' }], endpoints: [], scenes: [], agents: [{ name: 'planner' }] },
    savePlan: async plan => { plans.push(plan); return true } }
  const code = ts.transpileModule(await readFile(new URL('../console-ui/src/pages/inference/Purposes.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const deps = {
    react: runtime.api, 'react/jsx-runtime': jsxRuntime, './model.mjs': model,
    '../../i18n': { useI18n: () => ({ locale: 'zh-CN', t: (m, values) => translate('zh-CN', m, values) }) },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/input': { Input: 'input' }, '../../components/ui/select': { SelectField: 'select' },
    '../../components/ui/searchable-select': { SearchableSelectField: 'select' }, '../../components/ui/card': { Card: 'card' },
    '../../components/confirm-dialog': { useConfirm: () => ({ confirm: async () => true, ConfirmDialog: null }) },
    '../../components/ui/dropdown-menu': { DropdownMenu: 'menu', DropdownMenuContent: 'menu-content', DropdownMenuItem: 'menu-item', DropdownMenuTrigger: 'menu-trigger' },
    './SupportInfo': { supportLabel: label => label },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  runtime.mount(() => ({ type: module.exports.Purposes, props: { management } }))
  await runtime.settle()
  const all = () => nodes(runtime.value)
  const select = label => all().find(node => node.type === 'select' && node.props['aria-label'] === label)
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
  return { runtime, plans, all, select, text: () => text(runtime.value), submit: () => runtime.value.props.onSubmit({ preventDefault() {} }) }
}

test('the purposes page edits chat, summary, ambient and Agent fallbacks and writes them back', async () => {
  const page = await purposesPage(view({ purposes: { defaults: { chat: 'pa', chatFallbacks: ['pb'] }, decisions: {}, agents: { planner: 'pb' } } }))
  try {
    assert.match(page.text(), /子 Agent 的绑定高于适配器、账号和会话场景的聊天覆盖，这些覆盖又高于默认聊天模型/u)
    assert.match(page.text(), /暂时跳过：额度用完/u, 'the skipped primary shows its cooldown')
    assert.match(page.text(), /最近的备用模型切换/u)
    assert.equal(page.select('添加摘要备用模型'), undefined, 'no chain editor while summary follows chat')
    assert.deepEqual(page.select('添加聊天备用模型').props.options.map(option => option.value), ['', 'pc'], 'neither the primary nor a chosen fallback is offered again')
    page.select('添加聊天备用模型').props.onValueChange('pc'); page.runtime.render()
    assert.equal(page.select('聊天备用模型 2').props.value, 'pc')
    const up = page.all().filter(node => node.type === 'menu-item')
    // Items: [1: up, down, remove], [2: up, down, remove], …: move the second fallback up.
    up[3].props.onSelect(); page.runtime.render()
    assert.equal(page.select('聊天备用模型 1').props.value, 'pc')
    page.select('摘要').props.onValueChange('pc'); page.runtime.render()
    page.select('添加摘要备用模型').props.onValueChange('pa'); page.runtime.render()
    page.select('添加planner备用模型').props.onValueChange('pc'); page.runtime.render()
    page.select('聊天').props.onValueChange('pc'); page.runtime.render()
    assert.deepEqual(page.all().filter(node => node.type === 'select' && /^聊天备用模型/u.test(node.props['aria-label'])).map(node => node.props.value), ['pb'], 'a new primary leaves its own chain')
    await page.submit()
    const purposes = page.plans[0].purposes
    assert.deepEqual(purposes.chat, { profile: 'pc', fallbacks: ['pb'] })
    assert.deepEqual(purposes.summary, { profile: 'pc', fallbacks: ['pa'] })
    assert.deepEqual(purposes.agents, { planner: { profile: 'pb', fallbacks: ['pc'] } })
  } finally { page.runtime.unmount() }
})

test('adapter and scene overrides carry their own chat chain; removing a fallback drops it', async () => {
  const page = await purposesPage(view({ purposes: { defaults: {}, decisions: {}, adapters: { qq: { chat: 'pa', chatFallbacks: ['pb', 'pc'] } } } }))
  try {
    assert.equal(page.select('聊天备用模型 2').props.value, 'pc')
    page.all().filter(node => node.type === 'menu-item')[2].props.onSelect(); page.runtime.render()
    await page.submit()
    assert.deepEqual(page.plans[0].purposes.adapters.qq.chat, { profile: 'pa', fallbacks: ['pc'] })
  } finally { page.runtime.unmount() }
})

test('an older Host (no modelAvailability) shows no chain editor besides vision and writes no fallbacks', async () => {
  const page = await purposesPage(view({ fallbacks: false, purposes: { defaults: { chat: 'pa', perception: { profile: 'pa' } }, decisions: {} } }))
  try {
    assert.equal(page.select('添加聊天备用模型'), undefined)
    assert.ok(page.select('添加识图备用模型'), 'the vision chain is unchanged')
    assert.doesNotMatch(page.text(), /暂时跳过|最近的备用模型切换|按顺序换用/u)
    await page.submit()
    assert.deepEqual(page.plans[0].purposes.chat, { profile: 'pa' })
  } finally { page.runtime.unmount() }
})

test('batch 3 copy has English for every new string', () => {
  for (const key of ['{0}备用模型 {1}', '添加{0}备用模型', '调整{0}备用模型 {1}', '上移', '下移', '暂时跳过：{0}，{1} 恢复', '最近的备用模型切换',
    '聊天模型的优先级：子 Agent 的绑定高于适配器、账号和会话场景的聊天覆盖，这些覆盖又高于默认聊天模型。',
    '始终启用，在所有适配器上生效，不能在这里关闭。', '链接指向的账号不在这里：它可能已被删除，或属于另一个模型管理身份。']) {
    assert.ok(Object.hasOwn(englishMessages, key), key)
  }
  assert.equal(translate('en', '添加{0}备用模型', [translate('en', '聊天')]), 'Add Chat fallback model')
})

test('D15.4: buttons keep visible text at every width (no screen-reader-only labels on narrow screens)', () => {
  const files = ['pages/scope/configured-account-actions.tsx', 'pages/scope/adapter-accounts.tsx', 'pages/scope/overview-panels.tsx',
    'components/PluginConfigForm/SchemaFieldEditor.tsx', 'pages/ops/instance.tsx', 'pages/account/index.tsx', 'pages/access/tokens.tsx',
    'pages/access/roles.tsx', 'pages/database/database-page.tsx']
  for (const file of files) {
    const text = source(file)
    assert.doesNotMatch(text, /max-(?:sm|md|lg):sr-only|sr-only (?:sm|md|lg):not-sr-only/u, file)
    assert.doesNotMatch(text, /<span className="hidden sm:inline">\{i18n\.t\([^)]*\)\}<\/span>\s*<\/Button>|<Trash2[^>]*\/>\s*<span className="hidden sm:inline">/u, file)
  }
  assert.match(source('pages/scope/configured-account-actions.tsx'), /<FileUp \/>\}\{label\}/u)
})

test('D15.1 / D18.2: the root feature row says 始终启用 once in muted text, and no off-scale spacing', () => {
  const matrix = source('pages/features/feature-matrix.tsx')
  assert.doesNotMatch(matrix, /variant="success"[^>]*>\{i18n\.t\('始终启用'\)\}/u)
  assert.match(matrix, /<TableCell colSpan=\{1 \+ adapters\.length\} className="text-sm text-muted-foreground" data-root-always-on="">/u)
  assert.doesNotMatch(matrix, /\bmt-0\.5\b/u)
})

test('chat members: adapter-scoped iam.manage asks the Host per adapter and merges the replies', () => {
  const global = createConsoleAccess({ permissions: ['iam.manage'] })
  const scoped = createConsoleAccess({ permissions: ['self.chat-identity'], bindings: [
    { scope: { kind: 'adapter', key: 'tg' }, permissions: ['iam.manage'] },
    { scope: { kind: 'adapter', key: 'qq' }, permissions: ['iam.manage', 'endpoint.view'] },
    { scope: { kind: 'endpoint', key: 'qq/bot' }, permissions: ['iam.manage'] },
  ] })
  assert.deepEqual(scopedAdapters('iam.manage', global), [], 'a global grant is not a list of adapters')
  assert.deepEqual(scopedAdapters('iam.manage', scoped), ['qq', 'tg'])
  assert.deepEqual(principalsListPlan([]), { requests: [{ request: { type: 'chat-principals.list' } }], skipped: [] })
  assert.deepEqual(principalsListPlan(['qq', 'tg']).requests, [
    { adapter: 'qq', request: { type: 'chat-principals.list', level: 'adapter', key: 'qq' } },
    { adapter: 'tg', request: { type: 'chat-principals.list', level: 'adapter', key: 'tg' } }])
  // An alias that is no scope key is skipped, never widened to an unscoped (global) request.
  assert.deepEqual(principalsListPlan(['Bad Alias']), { requests: [], skipped: ['Bad Alias'] })
  assert.deepEqual(principalsListPlan(['qq', 'Bad Alias']).requests.map(item => item.request.key), ['qq'])
  // One adapter failing leaves the others listed and names it; every request failing is an error.
  const plan = principalsListPlan(['qq', 'tg', 'Bad Alias'])
  const partial = settlePrincipalLists(plan, [{ status: 'rejected', reason: new Error('boom') }, { status: 'fulfilled', value: { principals: [{ id: 'p2', roles: [], identities: [{ adapter: 'tg', userId: '5' }] }] } }])
  assert.deepEqual(partial.failedAdapters, ['Bad Alias', 'qq'])
  assert.deepEqual(readPrincipals(partial.payload).map(row => row.id), ['p2'])
  const none = settlePrincipalLists(principalsListPlan(['qq']), [{ status: 'rejected', reason: 'denied' }])
  assert.equal(none.error, 'denied')
  assert.deepEqual(settlePrincipalLists(principalsListPlan(['Bad Alias']), []), { payload: { principals: [] }, failedAdapters: ['Bad Alias'] })
  const person = identities => ({ id: 'p1', displayName: 'Ann', roles: [{ level: 'adapter', key: 'qq', role: 'admin' }], identities, hiddenIdentities: 2 })
  const merged = readPrincipals(mergePrincipalPayloads([
    { principals: [person([{ adapter: 'qq', userId: '1' }])] },
    { principals: [person([{ adapter: 'tg', userId: '9' }]), { id: 'p2', roles: [], identities: [{ adapter: 'tg', userId: '5' }] }] },
  ]))
  const ann = merged.find(row => row.id === 'p1')
  assert.deepEqual(ann.identities.map(identity => identity.adapter).sort(), ['qq', 'tg'])
  assert.equal(ann.hiddenIdentities, 1, 'three identities in all, two of them visible')
  assert.equal(merged.length, 2)
  // Navigation: an adapter-scoped iam.manage is enough; an endpoint-scoped one is not (the Host lists per adapter).
  const onlyScoped = createConsoleAccess({ permissions: ['status.view'], bindings: [{ scope: { kind: 'adapter', key: 'qq' }, permissions: ['iam.manage'] }] })
  const endpointOnly = createConsoleAccess({ permissions: ['status.view'], bindings: [{ scope: { kind: 'endpoint', key: 'qq/bot' }, permissions: ['iam.manage'] }] })
  assert.equal(canSeeRoute({ path: '/chat-members' }, onlyScoped), true)
  assert.equal(canSeeRoute({ path: '/chat-members' }, endpointOnly), false)
  assert.equal(canSeeRoute({ path: '/access/users' }, onlyScoped), false, 'only the member list counts scoped grants')
  const page = source('pages/chat-members/index.tsx')
  assert.match(page, /Promise\.allSettled\(plan\.requests\.map/u)
  assert.match(page, /无法读取这些适配器上的成员：\{0\}。其他适配器的成员照常列出。/u)
  assert.match(page, /只在部分适配器上有 iam\.manage 时，只列出这些适配器上的身份/u)
})

test('deep links: ?account= opens 账号 on that account, ?tab=purposes opens 用途', () => {
  assert.equal(entry.resolveInferenceTab(null, true, 'accounts:a'), 'accounts')
  assert.equal(entry.resolveInferenceTab('purposes', true, 'accounts:a'), 'purposes', 'an explicit tab wins')
  assert.equal(entry.resolveInferenceTab('purposes', true), 'purposes')
  assert.equal(entry.resolveInferenceTab(null, false, '  '), 'profiles')
  assert.equal(entry.inferenceFocusAccount(new URLSearchParams('account=accounts%3Aa').get('account')), 'accounts:a')
  assert.equal(entry.inferenceTabParams(new URLSearchParams('account=x'), 'services').toString(), 'tab=services', 'leaving 账号 drops the account')
  assert.equal(entry.inferenceTabParams(new URLSearchParams('account=x'), 'profiles').toString(), '')
  assert.equal(entry.inferenceTabParams(new URLSearchParams('account=x'), 'accounts').toString(), 'account=x&tab=accounts')
  const workspace = source('pages/inference/Workspace.tsx')
  assert.match(workspace, /<Accounts management=\{m\} focusAccount=\{tab === 'accounts' \? focusAccount : undefined\} \/>/u)
})

async function accountsPage(focusAccount) {
  const runtime = pageRuntime()
  const v = { ...view(), accounts: { 'accounts:a': { id: 'accounts:a', serviceId: 'svc', label: 'A', authentication: { method: 'api-key' } }, 'accounts:b': { id: 'accounts:b', serviceId: 'svc', label: 'B', authentication: { method: 'api-key' } } } }
  const management = { view: v, source: { view: v }, busy: false, pending: null, active: () => true, setError: assert.fail, request: async () => ({}) }
  const code = ts.transpileModule(await readFile(new URL('../console-ui/src/pages/inference/Accounts.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const deps = {
    react: runtime.api, 'react/jsx-runtime': jsxRuntime, './model.mjs': model,
    '../../i18n': { useI18n: () => ({ locale: 'zh-CN', t: (m, values) => translate('zh-CN', m, values) }) },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/input': { Input: 'input' }, '../../components/ui/select': { SelectField: 'select' },
    '../../components/ui/dialog': { Dialog: () => null, DialogContent: 'c', DialogHeader: 'h', DialogTitle: 't', DialogDescription: 'd' },
    '../../components/error-alert': { ErrorAlert: 'error' }, '../../components/ui/card': { Card: 'card' },
    '../../components/confirm-dialog': { useConfirm: () => ({ confirm: async () => true, ConfirmDialog: null }) },
    './SupportInfo': { SupportLabel: 'support-label', SupportNotice: 'support-notice', supportLabel: label => label }, './SchemaFields': { SchemaFields: 'schema' },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  runtime.mount(() => ({ type: module.exports.Accounts, props: { management, focusAccount } }))
  await runtime.settle()
  return runtime
}

test('Accounts highlights the linked account, and says so when the link points nowhere', async () => {
  let runtime = await accountsPage('accounts:b')
  const rows = nodes(runtime.value).filter(node => typeof node.props?.id === 'string' && node.props.id.startsWith('inference-account-'))
  assert.deepEqual(rows.map(row => row.props['aria-current']), [undefined, 'true'])
  assert.match(rows[1].props.className, /bg-accent/u)
  runtime.unmount()
  runtime = await accountsPage('accounts:gone')
  const status = nodes(runtime.value).find(node => node.props?.role === 'status')
  assert.match(String(status.props.children), /链接指向的账号不在这里/u)
  assert.equal(nodes(runtime.value).some(node => node.props?.['aria-current']), false)
  runtime.unmount()
})

test('375px: purpose grids use a shrinkable single column and chain rows keep the menu button in view', () => {
  const purposes = source('pages/inference/Purposes.tsx')
  // A grid without explicit columns sizes its implicit column to the widest select (content
  // minimum), which pushed the 「⋯」 buttons past a 375px viewport. `grid-cols-1` is minmax(0,1fr).
  const grids = [...purposes.matchAll(/className="([^"]*\bgrid\b[^"]*)"/gu)].map(match => match[1])
  assert.ok(grids.length >= 4)
  for (const classes of grids) assert.match(classes, /\bgrid-cols-1\b/u, classes)
  assert.match(purposes, /<div className="min-w-0 space-y-2 text-sm" key=\{key\}>/u, 'default-model cells may shrink')
  assert.match(purposes, /<div className="min-w-0 space-y-2" data-fallback-chain=\{label\}>/u)
  assert.match(purposes, /className="min-w-0 flex-1"\s+aria-label=\{i18n\.t\("\{0\}备用模型 \{1\}"/u, 'the chain select truncates instead of growing')
  assert.match(purposes, /size="icon" className="shrink-0" aria-label=\{i18n\.t\("调整\{0\}备用模型 \{1\}"/u)
})

test('saving on a new Host keeps the chains of endpoints, scenes and Agents the page did not touch', async () => {
  const page = await purposesPage(view({ purposes: { defaults: { chat: 'pa' }, decisions: {},
    agents: { planner: 'pa', other: 'pb' }, agentFallbacks: { planner: ['pb', 'pc'], other: ['pc'] },
    endpoints: { 'qq/bot': { chat: 'pb', chatFallbacks: ['pc', 'pa'] } }, scenes: { 's:1': { chat: 'pc', chatFallbacks: ['pa'] } } } }))
  try {
    page.select('聊天').props.onValueChange('pb'); page.runtime.render()
    await page.submit()
    const purposes = page.plans[0].purposes
    assert.deepEqual(purposes.chat, { profile: 'pb' })
    assert.deepEqual(purposes.agents, { planner: { profile: 'pa', fallbacks: ['pb', 'pc'] }, other: { profile: 'pb', fallbacks: ['pc'] } })
    assert.deepEqual(purposes.endpoints, { 'qq/bot': { chat: { profile: 'pb', fallbacks: ['pc', 'pa'] }, perception: null } })
    assert.deepEqual(purposes.scenes, { 's:1': { chat: { profile: 'pc', fallbacks: ['pa'] } } })
  } finally { page.runtime.unmount() }
})
