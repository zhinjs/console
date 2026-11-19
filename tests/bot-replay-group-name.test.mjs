import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import * as jsxRuntime from 'react/jsx-runtime'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as model from '../console-ui/src/pages/bot-replay-model.mjs'
import * as pickerModel from '../console-ui/src/pages/ambient-group-picker-model.mjs'
import * as scopeModel from '../console-ui/src/pages/insights/scope-filter.mjs'
import * as featureModel from '../console-ui/src/pages/features/feature-model.mjs'

// #64 `bot-replay-merge-turn`: the replay list showed `icqq · group:860669870` and never the group's name.
const row = (id, extra = {}) => ({
  id, ts: 1_794_000_000_000, turn_id: id, instance_id: 'bot', platform: 'icqq', scene_id: 'group:860669870', user_id: null,
  kind: 'ambient_decision', outcome: 'skip', reason_code: 'ambient_not_engaged', reason_detail: null, payload: {}, actor: 'policy', actor_id: null, ...extra,
})

test('a group row reads its name from the group lists, keeping the raw id', () => {
  assert.equal(model.replayGroupKey(row('a')), 'icqq:860669870')
  assert.equal(model.replayGroupKey(row('a', { scene_id: 'private:10001' })), null)
  assert.equal(model.replayGroupKey(row('a', { scene_id: 'group:' })), null)
  const names = new Map([['icqq:860669870', '摸鱼群']])
  assert.deepEqual(
    (({ where, whereCode }) => ({ where, whereCode }))(model.describeReplayRow(row('a'), 'zh-CN', names)),
    { where: 'icqq · 摸鱼群', whereCode: 'icqq · group:860669870' })
  // Unknown group, another adapter's group with the same id, private chats and no names: the raw id as before.
  assert.equal(model.describeReplayRow(row('a', { scene_id: 'group:1' }), 'zh-CN', names).where, 'icqq · group:1')
  assert.equal(model.describeReplayRow(row('a', { platform: 'qq' }), 'zh-CN', names).where, 'qq · group:860669870')
  assert.equal(model.describeReplayRow(row('a', { scene_id: 'private:860669870' }), 'zh-CN', names).where, 'icqq · private:860669870')
  assert.equal(model.describeReplayRow(row('a')).where, 'icqq · group:860669870')
  assert.equal(model.describeReplayRow(row('a'), 'zh-CN', new Map([['icqq:860669870', '  ']])).where, 'icqq · group:860669870')
})

/** useMemo / useCallback on top of the runtime's keyed refs, so effects that depend on them settle. */
function memo(runtime, make, deps) {
  const ref = runtime.api.useRef(null)
  if (!ref.current || deps.some((item, i) => !Object.is(item, ref.current.deps[i]))) ref.current = { value: make(), deps }
  return ref.current.value
}

async function renderReplay(catalog, { items = [row('a'), row('b', { scene_id: 'group:42' })], consoleRpc = async () => { throw new Error('unexpected console request') } } = {}) {
  const runtime = pageRuntime()
  const code = ts.transpileModule(await readFile(new URL('../console-ui/src/pages/bot-replay.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const i18n = { locale: 'zh-CN', t: (m, values) => translate('zh-CN', m, values) }
  const list = { persistent: true, items, nextBefore: null }
  const deps = {
    react: { ...runtime.api, useMemo: (fn, deps) => memo(runtime, () => fn(), deps), useCallback: (fn, deps) => memo(runtime, () => fn, deps) }, 'react/jsx-runtime': jsxRuntime,
    '../i18n': { useI18n: () => i18n },
    'react-router-dom': { Link: 'a' },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '../utils/plugin-rpc': { pluginRpc: async () => list },
    '../utils/console-rpc': { requestConsole: consoleRpc },
    './features/feature-model.mjs': featureModel,
    '@zhin.js/console-ui': new Proxy({}, { get: (_, name) => String(name) }),
    '../components/StatusState': { StatusState: 'status' },
    './insights/ScopeFilterBar': { ScopeFilterBar: 'scope-bar', useScopeFilter: () => ({ scope: {}, identity: '' }) },
    './insights/scope-filter.mjs': scopeModel,
    './AmbientGroupPicker': { useAmbientGroupCatalog: () => ({ loading: false, error: null, catalog, retry: () => {} }) },
    './ambient-group-picker-model.mjs': pickerModel,
    './bot-replay-model.mjs': model,
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  runtime.mount(() => ({ type: module.exports.default, props: {} }))
  await runtime.settle()
  return nodes(runtime.value).filter(node => node.props?.className === 'break-all text-xs')
}

test('the replay list shows the group name with the id in the tooltip', async () => {
  const catalog = pickerModel.buildGroupCatalog([{ adapter: 'icqq', endpoint: 'bot', groups: [{ group_id: '860669870', group_name: '摸鱼群' }] }])
  assert.equal(pickerModel.groupNamesFromCatalog(catalog).get('icqq:860669870'), '摸鱼群', 'fixture matches the picker catalog')
  const [named, unknown] = await renderReplay(catalog)
  assert.equal(named.props.children, 'icqq · 摸鱼群')
  assert.equal(named.props.title, 'icqq · group:860669870')
  assert.equal(unknown.props.children, 'icqq · group:42')
  assert.equal(unknown.props.title, undefined, 'no tooltip that repeats the text')
})

test('without group lists (no permission, read failed) the raw ids stay', async () => {
  const cells = await renderReplay(null)
  assert.deepEqual(cells.map(cell => cell.props.children), ['icqq · group:860669870', 'icqq · group:42'])
})

// #64 `replay-sandbox-raw-id`: Sandbox rows showed `sandbox · private:private-<UUID>`, not the conversation's name.
// Names come from each platform's `feature.conversations`; no platform is special-cased.
const UUID = '3f2a9c1e-5b7d-4e2f-9a1b-0c8d7e6f5a4b'
const on = (platform, id, scene, extra = {}) => row(id, { platform, scene_id: scene, ...extra })

test('rows the group lists did not name read conversation names per platform, else a short generated id', () => {
  const names = model.conversationNamesByPlatform([
    { adapter: 'sandbox', endpoint: 'default', kind: 'private', id: `private-${UUID}`, name: '调试小号' },
    { adapter: 'sandbox', endpoint: 'default', kind: 'group', id: 'group-1', name: '测试群' },
    { adapter: 'sandbox', endpoint: 'a', kind: 'private', id: 'twice', name: '甲' },
    { adapter: 'sandbox', endpoint: 'b', kind: 'private', id: 'twice', name: '乙' },
    { adapter: 'icqq', endpoint: 'bot', kind: 'private', id: 'twice', name: '演示用户' },
    { adapter: 'sandbox', endpoint: 'default', kind: 'private', id: 'nameless' },
  ])
  assert.deepEqual([...names.keys()].sort(), ['icqq', 'sandbox'])
  assert.deepEqual([...names.get('sandbox')], [[`private:private-${UUID}`, '调试小号'], ['group:group-1', '测试群']], 'nameless and ambiguous entries are left out')
  assert.equal(names.get('icqq').get('private:twice'), '演示用户', 'ambiguity is per platform')
  const where = (r, locale = 'zh-CN', map = names, groups = new Map()) => (({ where, whereCode }) => ({ where, whereCode }))(model.describeReplayRow(r, locale, groups, map))
  assert.deepEqual(where(on('sandbox', 'a', `private:private-${UUID}`)), { where: 'sandbox · 私聊 调试小号', whereCode: `sandbox · private:private-${UUID}` })
  assert.equal(where(on('sandbox', 'a', 'group:group-1')).where, 'sandbox · 群聊 测试群')
  assert.equal(where(on('icqq', 'a', 'private:twice')).where, 'icqq · 私聊 演示用户')
  assert.equal(where(on('sandbox', 'a', `private:private-${UUID}`), 'en').where, 'sandbox · Private chat 调试小号')
  assert.equal(where(on('icqq', 'a', 'group:860669870'), 'zh-CN', names, new Map([['icqq:860669870', '摸鱼群']])).where, 'icqq · 摸鱼群', 'the group list wins')
  // No name: generated ids (any platform) shorten to their first 8 digits; short ids stay raw.
  assert.equal(where(on('sandbox', 'a', `private:private-${UUID}`), 'zh-CN', null).where, 'sandbox · 私聊 #3f2a9c1e')
  assert.equal(where(on('lark', 'a', `group:${UUID}`), 'zh-CN', new Map()).where, 'lark · 群聊 #3f2a9c1e')
  assert.equal(where(on('wecom', 'a', `private:${'ab12cd34'.padEnd(32, 'f')}`), 'zh-CN', new Map()).where, 'wecom · 私聊 #ab12cd34', 'a long hex id')
  assert.equal(where(on('sandbox', 'a', 'private:sandbox-user'), 'zh-CN', new Map()).where, 'sandbox · private:sandbox-user')
  assert.equal(where(on('icqq', 'a', 'private:10001'), 'zh-CN', new Map()).where, 'icqq · private:10001')
  assert.equal(where(on('sandbox', 'a', 'room:1')).where, 'sandbox · room:1', 'an unknown scene stays raw')
  assert.equal(model.shortGeneratedId('1234567890'), null)

  const groups = new Map([['icqq:860669870', '摸鱼群']])
  assert.deepEqual(model.replayUnnamedPlatforms([row('a'), on('sandbox', 'b', 'private:x'), on('lark', 'c', 'group:1'), on('sandbox', 'd', 'group:2')], groups), ['lark', 'sandbox'])
  assert.deepEqual(model.replayUnnamedPlatforms([row('a')], groups), [], 'every row named by the group lists')
  assert.deepEqual(model.replayUnnamedPlatforms(undefined), [])
})

test('the replay list reads names once per unnamed platform; a failed read keeps the ids', async () => {
  const calls = []
  const consoleRpc = async (body) => {
    calls.push(body)
    if (body.adapter === 'lark') throw new Error('forbidden')
    return { conversations: [{ key: `sandbox/default/private:private-${UUID}`, name: '调试小号', hasOverrides: false, overrides: [] }], recentAvailable: true }
  }
  const catalog = pickerModel.buildGroupCatalog([{ adapter: 'icqq', endpoint: 'bot', groups: [{ group_id: '860669870', group_name: '摸鱼群' }] }])
  const cells = await renderReplay(catalog, { consoleRpc, items: [row('a'), on('sandbox', 'b', `private:private-${UUID}`),
    on('sandbox', 'c', 'private:private-00000000-0000-4000-8000-000000000000'), on('lark', 'd', `group:${UUID}`)] })
  assert.deepEqual(calls.map(body => body.adapter).sort(), ['lark', 'sandbox'])
  for (const body of calls) assert.deepEqual(body, { type: 'feature.conversations', adapter: body.adapter, limit: 200 })
  assert.deepEqual(cells.map(cell => cell.props.children), ['icqq · 摸鱼群', 'sandbox · 私聊 调试小号', 'sandbox · 私聊 #00000000', 'lark · 群聊 #3f2a9c1e'])
  assert.equal(cells[1].props.title, `sandbox · private:private-${UUID}`)
  assert.equal(cells[3].props.title, `lark · group:${UUID}`)

  const none = []
  await renderReplay(catalog, { items: [row('a')], consoleRpc: async (body) => { none.push(body); return { conversations: [] } } })
  assert.deepEqual(none, [], 'every row named by the group lists: no read')
})
