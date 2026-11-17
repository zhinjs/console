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

async function renderReplay(catalog) {
  const runtime = pageRuntime()
  const code = ts.transpileModule(await readFile(new URL('../console-ui/src/pages/bot-replay.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const i18n = { locale: 'zh-CN', t: (m, values) => translate('zh-CN', m, values) }
  const list = { persistent: true, items: [row('a'), row('b', { scene_id: 'group:42' })], nextBefore: null }
  const deps = {
    react: { ...runtime.api, useMemo: (fn, deps) => memo(runtime, () => fn(), deps), useCallback: (fn, deps) => memo(runtime, () => fn, deps) }, 'react/jsx-runtime': jsxRuntime,
    '../i18n': { useI18n: () => i18n },
    'react-router-dom': { Link: 'a' },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '../utils/plugin-rpc': { pluginRpc: async () => list },
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
