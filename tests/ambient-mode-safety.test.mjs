// Review of console#152 (ADR 0066): 「只观察」 must never read as saved while the bot keeps chiming in.
// H1 — a failed read is not an older instance; M1 — every failure re-reads and says what is in effect;
// M2 / M5 — permissions on the purposes page; M3 — MCP card icon follows its state.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as jsxRuntime from 'react/jsx-runtime'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import { hslTokens } from './helpers/token-cascade.mjs'
import { THEME_PALETTES } from '../console-ui/src/theme/index.ts'
import * as ambientModel from '../console-ui/src/pages/ambient-engagement-model.mjs'
import * as liveStatus from '../console-ui/src/components/PluginConfigForm/config-live-status.mjs'
import * as readError from '../console-ui/src/utils/read-error.mjs'
import * as inferenceModel from '../console-ui/src/pages/inference/model.mjs'
import * as judgeModel from '../console-ui/src/pages/inference/ambient-judge-model.mjs'
import { mcpRowState } from '../console-ui/src/pages/introspection/mcp-status-model.mjs'

const require = createRequire(import.meta.url)
const read = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''

const configYaml = (conversations, mode) => `ai:\n  trigger:\n    ambient:\n      mode: ${mode}\n      conversations: ${JSON.stringify(conversations)}\n      maxPerHour: 4\n`
const status = extra => ({ enabled: true, mode: 'active', groups: 1, last24h: { spoke: 0, watched: 0, stayed_quiet: 0, skipped: 0 }, recent: [], updatedAt: null, ...extra })
const chain = [{ profile: 'ts', label: 'svc/ts', kind: 'decision', role: 'primary' }]
const policy = { profile: 'ts', minConfidence: 0.7, mode: 'active' }
const view = { rootId: '/host', revision: 3, ownerId: 'host', services: {}, accounts: {}, profiles: { ts: { id: 'ts' } } }

/**
 * The 群聊插话 page against a scripted Host. `judge` answers `/ambient-judge` (a policy, an Error or a
 * function of the read count), `ambient` the status RPC, `apply` the `/apply` status.
 */
async function ambientPage({ config, judge, ambient, apply = 'committed' }) {
  const runtime = pageRuntime()
  const calls = { patches: [], inference: [], reloads: 0 }
  let judgeReads = 0
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body })
  const apiFetch = async (url, init = {}) => {
    const path = new URL(url, 'https://host').pathname.replace('/api/agent/inference', '') || '/'
    calls.inference.push(path)
    if (path === '/ambient-judge') {
      const answer = typeof judge === 'function' ? judge(judgeReads++) : judge
      if (answer instanceof Error) throw answer
      if (typeof answer === 'number') return json(answer, { success: false, code: 'unavailable' })
      return json(200, { success: true, data: { policy: answer, source: 'stored', chain: [] } })
    }
    if (path === '/owners') return json(200, { success: true, data: [{ id: 'host', kind: 'host' }] })
    if (path === '/') return json(200, { success: true, data: view })
    if (path === '/plan') return json(200, { success: true, data: { prepared: { sealed: true }, baseRevision: 3 } })
    if (path === '/apply') return json(200, { success: true, data: { status: apply } })
    throw new Error(`unexpected ${path} ${init.method ?? ''}`)
  }
  const requestConsole = async request => {
    if (request.type === 'config:get-source') return { source: config, revision: 'r1' }
    if (request.type === 'config:patch') { calls.patches.push(request.patches); return { status: 'saved', revision: 'r2', restartRequired: false } }
    throw new Error(request.type)
  }
  const mocks = {
    react: runtime.api, 'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { Link: 'a' }, 'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '@zhin.js/console-ui': new Proxy({}, { get: (_target, name) => typeof name === 'string' ? name.toLowerCase() : undefined }),
    yaml: require('yaml'),
    '../components/StatusState': { StatusState: 'status-state' },
    './insights/ScopeFilterBar': { ScopeFilterBar: 'scope-filter-bar', useScopeFilter: () => ({ scope: { level: 'global' } }) },
    './insights/scope-filter.mjs': { ambientGroupKey: () => null },
    '../components/ApplyFeedback': { ApplyFeedback: 'apply-feedback' },
    '../components/connection-required': { ConnectionRequiredState: 'connection-required' },
    '../components/PluginConfigForm/ConfigurationLiveStatus': { ConfigurationLiveStatus: 'live-status' },
    '../components/PluginConfigForm/config-live-status.mjs': liveStatus,
    '../contracts/zhin-console': { ENDPOINT_RPC: {} },
    '../utils/console-rpc': { requestConsole },
    '../utils/plugin-rpc': { pluginRpc: async () => { if (ambient instanceof Error) throw ambient; return ambient } },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => 'scope-1' },
    '../utils/inbox-cache': { isInboxCacheScopeActive: () => true },
    '../utils/read-error.mjs': readError,
    '../hooks/use-console-read': { useConsoleRead: () => ({}) },
    './endpoint-detail/conversation-labels': { normalizeGroupRecord: raw => raw },
    './ambient-engagement-model.mjs': ambientModel,
    './AmbientGroupPicker': { AmbientGroupPicker: 'ambient-group-picker' },
    '../utils/auth': { apiFetch },
    '../console-routes.mjs': { CONSOLE_PATHS: { ai: '/features/ai' } },
    './inference/model.mjs': inferenceModel,
    './inference/ambient-judge-model.mjs': judgeModel,
    '../hooks/use-console-access': { useConsoleAccess: () => ({}) },
    '../utils/console-access.mjs': { hasConsolePermission: () => true },
  }
  const source = `${await read('pages/ambient-engagement.tsx')}\nexport { AmbientSettingsForm, readAmbientSettingsFromHost }`
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  const { AmbientSettingsForm, readAmbientSettingsFromHost } = module.exports
  let initial = await readAmbientSettingsFromHost()
  let feedback = null
  const onReload = async () => { calls.reloads++; initial = await readAmbientSettingsFromHost(); return initial }
  runtime.mount(() => ({ type: AmbientSettingsForm, props: { initial, onReload, lastSave: feedback, onSaved: next => { feedback = next } } }))
  await runtime.settle()
  const all = () => nodes(runtime.value)
  const radio = value => all().find(node => node.type === 'radiogroupitem' && node.props.value === value)
  const choose = value => { all().find(node => node.type === 'radiogroup').props.onValueChange(value); runtime.render() }
  const saveButton = () => all().find(node => node.type === 'button' && /保存/u.test(text(node)))
  // The button starts the save without returning it: wait for the scripted Host to answer.
  const flush = async () => { for (let i = 0; i < 10; i++) { await new Promise(resolve => setTimeout(resolve, 5)); await runtime.settle() } runtime.render() }
  const save = async () => { saveButton().props.onClick(); await flush() }
  const scope = value => { all().filter(node => node.type === 'radiogroup').find(node => node.props.name === 'ambient-group-scope').props.onValueChange(value); runtime.render() }
  const setGroups = groups => { all().find(node => node.type === 'ambient-group-picker').props.onChange(groups); runtime.render() }
  const card = value => all().find(node => node.type === 'label' && node.props.className === 'console-choice-card' && nodes(node).some(child => child.type === 'radiogroupitem' && child.props.value === value))
  return { runtime, calls, all, radio, choose, scope, setGroups, card, saveButton, save, initial: () => initial, feedback: () => feedback, text: () => text(runtime.value) }
}

test('H1 situation A: both reads fail but config:get-source works → unknown, mode locked, nothing about it written', async () => {
  const page = await ambientPage({ config: configYaml(['qq:1'], 'active'), judge: new TypeError('fetch failed'), ambient: new Error('RPC timed out') })
  try {
    assert.equal(page.initial().judge.state, 'unknown', 'a failed read is not an older instance')
    assert.match(page.text(), /无法确认实例版本或读取插话判断，暂不能修改只观察/u)
    assert.ok(page.all().some(node => node.type === 'button' && text(node) === '重新读取'), 'a retry is offered')
    assert.equal(page.radio('watch').props.disabled, true, 'switching to 只观察 is locked')
    assert.equal(page.radio('off').props.disabled, false)
    page.choose('watch')
    assert.equal(page.saveButton().props.disabled, true)
    await page.save()
    assert.deepEqual(page.calls.patches, [], 'even a bypassed button saves nothing')
    page.choose('join')
    await page.save()
    assert.equal(page.calls.patches.length, 1, 'unchanged behaviour: the groups can still be saved')
    assert.deepEqual(page.calls.patches[0].map(patch => patch.path.at(-1)), ['conversations', 'maxPerHour'], 'no ai.trigger.ambient.mode')
    assert.ok(!page.calls.inference.includes('/plan'), 'no judge write')
  } finally { page.runtime.unmount() }
})

test('N1: while the mode is unknown, adding a group or 所有群 is blocked; removing a group or 关闭 is saved', async () => {
  const config = configYaml(['qq:1', 'qq:2'], 'shadow')
  const unknown = () => ambientPage({ config, judge: new TypeError('fetch failed'), ambient: new Error('RPC timed out') })
  let page = await unknown()
  try {
    assert.equal(page.initial().settings.behavior, 'watch', 'the yml says 只观察; what runs is not known')
    page.setGroups(['qq:1', 'qq:2', 'qq:3'])
    assert.match(page.text(), /读到实际模式之前，不能扩大插话范围/u)
    assert.equal(page.saveButton().props.disabled, true)
    await page.save()
    assert.deepEqual(page.calls.patches, [], 'a new group is not saved')
    page.setGroups(['qq:1', 'qq:2'])
    page.scope('all')
    assert.equal(page.saveButton().props.disabled, true)
    await page.save()
    assert.deepEqual(page.calls.patches, [], '所有群 is not saved')
  } finally { page.runtime.unmount() }
  page = await unknown()
  try {
    page.setGroups(['qq:2'])
    await page.save()
    assert.deepEqual(page.calls.patches.at(-1).find(patch => patch.path.at(-1) === 'conversations').value, ['qq:2'], 'removing a group is saved')
    assert.ok(page.calls.patches.at(-1).every(patch => patch.path.at(-1) !== 'mode'))
  } finally { page.runtime.unmount() }
  page = await unknown()
  try {
    page.choose('off')
    await page.save()
    assert.deepEqual(page.calls.patches.at(-1), [{ op: 'set', path: ['ai', 'trigger', 'ambient', 'conversations'], value: [] }], '关闭 is saved')
  } finally { page.runtime.unmount() }
})

test('N3: a locked choice is disabled as a whole card (aria-disabled), styled as unavailable', async () => {
  const page = await ambientPage({ config: configYaml(['qq:1'], 'active'), judge: new TypeError('fetch failed'), ambient: new Error('RPC timed out') })
  try {
    assert.equal(page.card('watch').props['aria-disabled'], true)
    assert.equal(page.card('watch').props['data-disabled'], '')
    assert.equal(page.card('join').props['aria-disabled'], undefined, 'the current choice stays available')
    assert.equal(page.card('off').props['aria-disabled'], undefined)
  } finally { page.runtime.unmount() }
  const css = await readFile(new URL('../console-ui/src/shell.css', import.meta.url), 'utf8')
  assert.match(css, /\.console-choice-card\[aria-disabled="true"\] \{\s*cursor: not-allowed;/)
})

test('H1 situation B: /ambient-judge 503 and enabled=false → 关闭 → 只观察 is blocked, not saved as groups only', async () => {
  const page = await ambientPage({ config: configYaml([], 'shadow'), judge: 503, ambient: status({ enabled: false, mode: 'off', groups: 0, judgeChain: chain }) })
  try {
    assert.deepEqual(page.initial().judge, { state: 'merged' })
    assert.equal(page.initial().settings.behavior, 'off')
    assert.equal(page.radio('watch').props.disabled, true)
    page.choose('watch')
    assert.match(page.text(), /暂不能切到「只观察」：只保存群列表的话，机器人会照常插话/u)
    assert.equal(page.saveButton().props.disabled, true)
    await page.save()
    assert.deepEqual(page.calls.patches, [])
  } finally { page.runtime.unmount() }
})

test('an older instance needs a missing route and a status without judgeChain; it keeps writing the yml mode', async () => {
  const page = await ambientPage({ config: configYaml(['qq:1'], 'active'), judge: 404, ambient: status() })
  try {
    assert.equal(page.initial().judge.state, 'legacy')
    page.choose('watch')
    await page.save()
    assert.deepEqual(page.calls.patches[0].map(patch => patch.path.at(-1)), ['conversations', 'mode', 'maxPerHour'])
  } finally { page.runtime.unmount() }
})

test('merged with the policy: 只观察 is written on the latest policy, read back, then the groups', async () => {
  // Read 0: the page; read 1: right before the write (unchanged); read 2: the read-back after it.
  const page = await ambientPage({ config: configYaml(['qq:1'], 'active'), ambient: status({ judgeChain: chain }),
    judge: reads => reads >= 2 ? { ...policy, mode: 'shadow' } : policy })
  const plan = page.calls.inference
  try {
    page.choose('watch')
    await page.save()
    assert.ok(plan.includes('/plan') && plan.includes('/apply'))
    assert.deepEqual(page.calls.patches[0].map(patch => patch.path.at(-1)), ['conversations', 'maxPerHour'])
    assert.match(page.text(), /「只观察」已生效（已读回确认）/u)
  } finally { page.runtime.unmount() }
})

test('M1: commit-unknown re-reads, writes no groups and says the mode is not confirmed', async () => {
  const page = await ambientPage({ config: configYaml(['qq:1'], 'active'), ambient: status({ judgeChain: chain }), judge: policy, apply: 'commit-unknown' })
  try {
    page.choose('watch')
    const before = page.calls.reloads
    await page.save()
    assert.deepEqual(page.calls.patches, [])
    assert.equal(page.calls.reloads, before + 1, 'the page reads the Host again')
    assert.match(page.feedback().text, /尚未确认是否生效/u)
    assert.doesNotMatch(page.feedback().text, /已生效（/u)
  } finally { page.runtime.unmount() }
})

test('M1: a mode read back that differs is an error, not a saved state', async () => {
  const page = await ambientPage({ config: configYaml(['qq:1'], 'active'), ambient: status({ judgeChain: chain }), judge: policy })
  try {
    page.choose('watch')
    await page.save()
    assert.deepEqual(page.calls.patches, [], 'the groups are not saved after a mode that did not stick')
    assert.match(page.feedback().text, /读回的模式是「主动参与」，与要保存的不一致/u)
    assert.ok(page.calls.reloads >= 1)
  } finally { page.runtime.unmount() }
})

test('H3 on the interjection page: a policy changed in another tab is not overwritten', async () => {
  const page = await ambientPage({ config: configYaml(['qq:1'], 'active'), ambient: status({ judgeChain: chain }),
    judge: reads => reads === 0 ? policy : { ...policy, minConfidence: 0.9 } })
  try {
    page.choose('watch')
    await page.save()
    assert.ok(!page.calls.inference.includes('/plan'), 'nothing planned')
    assert.deepEqual(page.calls.patches, [])
    assert.match(page.feedback().text, /插话判断刚在别处被修改过/u)
  } finally { page.runtime.unmount() }
})

// ------------------------------------------------------------- M3: MCP card icon

test('M3: the MCP card icon takes the row state, like its badge; the idle ring keeps 3:1', async () => {
  const source = await read('pages/introspection/CapabilityExplorer.tsx')
  assert.match(source, /<span className=\{cn\('console-runtime-health', state\.dot\)\} data-mcp-status=\{state\.status\}>/)
  assert.deepEqual(['connected', 'idle', 'not_loaded', 'failed'].map(status => mcpRowState({ status }).dot), ['is-online', 'is-idle', 'is-idle', 'is-failed'])
  assert.equal(mcpRowState({ connected: false }).dot, 'is-offline')
  const css = await read('design-system.css')
  assert.match(css, /\.console-runtime-health\.is-offline \{\s*background: hsl\(var\(--warning-fill\) \/ 0\.14\);\s*color: hsl\(var\(--warning\)\);/)
  assert.match(css, /\.console-runtime-health\.is-failed \{\s*background: hsl\(var\(--destructive\) \/ 0\.12\);\s*color: hsl\(var\(--destructive\)\);/)
  const gallery = await read('pages/introspection/component-gallery.css')
  assert.match(gallery, /\.console-runtime-status-dot\.is-idle \{[^}]*outline: var\(--console-border-focus\) solid hsl\(var\(--muted-foreground\)\);/)
  const rgb = ({ h, s, l }) => {
    const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l / 100 - c / 2, k = h / 60
    return (k < 1 ? [c, x, 0] : k < 2 ? [x, c, 0] : k < 3 ? [0, c, x] : k < 4 ? [0, x, c] : k < 5 ? [x, 0, c] : [c, 0, x]).map(v => v + m)
  }
  const lum = v => v.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
  for (const palette of THEME_PALETTES) for (const dark of [false, true]) {
    const tokens = hslTokens(palette.id, dark)
    const [a, b] = [lum(rgb(tokens['muted-foreground'])), lum(rgb(tokens.card))]
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
    assert.ok(ratio >= 3, `${palette.id}/${dark ? 'dark' : 'light'}: idle ring ${ratio.toFixed(2)}`)
  }
})
