import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import * as ambientModel from '../console-ui/src/pages/ambient-engagement-model.mjs'
import * as pickerModel from '../console-ui/src/pages/ambient-group-picker-model.mjs'
import * as liveStatus from '../console-ui/src/components/PluginConfigForm/config-live-status.mjs'
import * as readError from '../console-ui/src/utils/read-error.mjs'

const require = createRequire(import.meta.url)
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
const read = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

function compile(source, mocks) {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
  return module.exports
}

/** Single-render hooks: state starts at its initial value, effects never run. */
function staticHooks() {
  return {
    useState: initial => { const value = typeof initial === 'function' ? initial() : initial; return [value, () => {}] },
    useRef: current => ({ current }),
    useCallback: fn => fn,
    useMemo: fn => fn(),
    useEffect() {},
  }
}

const ui = {
  'lucide-react': new Proxy({}, { get: () => 'icon' }),
  '../components/ui/badge': { Badge: 'badge' },
  '../components/ui/button': { Button: 'button' },
  '../components/ui/checkbox': { Checkbox: 'checkbox' },
  '../components/ui/input': { Input: 'input' },
  '../components/ui/textarea': { Textarea: 'textarea' },
  '../components/ui/card': { Card: 'article', CardContent: 'section', CardDescription: 'p', CardHeader: 'header', CardTitle: 'h2' },
  '../components/ui/table': { Table: 'table', TableBody: 'tbody', TableCell: 'td', TableHead: 'th', TableHeader: 'thead', TableRow: 'tr' },
  '../components/ui/skeleton': { Skeleton: 'skeleton' },
  '../components/ui/radio-group': { RadioGroup: 'radio-group', RadioGroupItem: 'radio' },
  '../components/error-alert': { ErrorAlert: 'error-alert' },
  '../components/ApplyFeedback': { ApplyFeedback: 'apply-feedback' },
  '../components/PageHeader': { PageHeader: 'page-header' },
  '../components/PageShell': { PageShell: 'page-shell' },
  '../components/connection-required': { ConnectionRequiredState: 'connection-required' },
  '../components/PluginConfigForm/ConfigurationLiveStatus': { ConfigurationLiveStatus: 'live-status' },
  '../components/PluginConfigForm/config-live-status.mjs': liveStatus,
  '../contracts/zhin-console': { ENDPOINT_RPC: { LIST: 'endpoint.list', GROUPS: 'endpoint.groups' } },
  '../utils/console-rpc': { requestConsole: async () => { throw new Error('unexpected request') } },
  '../utils/plugin-rpc': { pluginRpc: async () => { throw new Error('unexpected request') } },
  '../utils/useInboxCacheScope': { useInboxCacheScope: () => 'scope-1' },
  '../utils/inbox-cache': { isInboxCacheScopeActive: () => true },
  '../utils/read-error.mjs': readError,
  '../hooks/use-console-read': { useConsoleRead: () => ({}) },
  './endpoint-detail/conversation-labels': { normalizeGroupRecord: raw => ({ group_id: Number(raw.group_id), name: raw.name }) },
  './ambient-engagement-model.mjs': ambientModel,
  './ambient-group-picker-model.mjs': pickerModel,
  './AmbientGroupPicker': { AmbientGroupPicker: 'ambient-group-picker' },
  yaml: { parse: () => ({}) },
}

const elements = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(elements)] : []
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const ofType = (tree, type) => elements(tree).filter(node => node.type === type)

async function pickerView(catalogRead, groups) {
  const module = compile(await read('pages/AmbientGroupPicker.tsx'), { ...ui, react: staticHooks() })
  const changes = []
  const tree = module.AmbientGroupPickerView({ groups, onChange: next => changes.push(next), read: catalogRead })
  return { tree, changes }
}

const catalog = pickerModel.buildGroupCatalog([
  { adapter: 'qq', endpoint: 'main-bot', groups: [{ group_id: 1001, name: '开发群' }, { group_id: 1002, name: '闲聊群' }] },
  { adapter: 'slack', endpoint: 'work', groups: [{ group_id: 'C0123ABC', name: 'general' }] },
])

test('groups are chosen from the account group lists, grouped by account, showing name and id', async () => {
  let retried = 0
  const { tree, changes } = await pickerView({ loading: false, error: null, catalog, retry: () => { retried++ } }, ['qq:1001', 'qq:999'])
  const legends = ofType(tree, 'legend').map(text)
  assert.deepEqual(legends, ['main-bot · qq', 'work · slack'])
  const boxes = ofType(tree, 'checkbox')
  assert.deepEqual(boxes.map(box => box.props.checked), [true, false, false])
  const options = ofType(tree, 'label').map(text)
  assert.ok(options.some(option => option.includes('闲聊群') && option.includes('qq:1002')))
  boxes[1].props.onCheckedChange(true)
  assert.deepEqual(changes.at(-1), ['qq:1001', 'qq:999', 'qq:1002'])
  boxes[0].props.onCheckedChange(false)
  assert.deepEqual(changes.at(-1), ['qq:999'])
  const search = ofType(tree, 'input').find(input => input.props.type === 'search')
  assert.equal(search.props['aria-label'], '搜索群名或群号')
  assert.equal(search.props.disabled, false)
  assert.equal(retried, 0)
})

test('whitelisted groups missing from the list are visible, marked and removable', async () => {
  const { tree, changes } = await pickerView({ loading: false, error: null, catalog, retry() {} }, ['qq:1001', 'qq:999'])
  const selected = elements(tree).find(node => node.props?.['aria-label'] === '已选的群')
  const rows = ofType(selected, 'li')
  assert.equal(rows.length, 2)
  assert.ok(text(rows[0]).includes('开发群') && text(rows[0]).includes('qq:1001'))
  assert.ok(text(rows[1]).includes('qq:999') && text(rows[1]).includes('不在群列表中'))
  assert.ok(!text(rows[0]).includes('不在群列表中'))
  ofType(rows[1], 'button').find(button => button.props['aria-label'] === '移除 qq:999').props.onClick()
  assert.deepEqual(changes.at(-1), ['qq:1001'])
})

test('a failed group list read shows the real error with retry, never the empty state, and keeps manual input', async () => {
  let retried = 0
  const { tree } = await pickerView({ loading: false, error: 'REST request failed', catalog: null, retry: () => { retried++ } }, ['qq:5'])
  const [alert] = ofType(tree, 'error-alert')
  assert.equal(alert.props.error, '群列表读取失败：REST request failed')
  alert.props.onRetry(); assert.equal(retried, 1)
  const all = text(tree)
  assert.doesNotMatch(all, /没有在线的账号|没有读到群|权限/)
  assert.ok(all.includes('qq:5'), 'existing whitelist stays visible')
  assert.ok(ofType(tree, 'input').some(input => input.props.id === 'ambient-manual-group'))
  const denied = await pickerView({ loading: false, error: 'Token scope does not allow this route', catalog: null, retry() {} }, [])
  assert.equal(ofType(denied.tree, 'error-alert').length, 0)
  assert.match(text(denied.tree), /没有读取群列表的权限/)
})

test('one account failing is reported next to the groups that did load', async () => {
  const partial = pickerModel.buildGroupCatalog([
    { adapter: 'qq', endpoint: 'main-bot', groups: [{ group_id: 1001, name: '开发群' }] },
    { adapter: 'qq', endpoint: 'backup', error: 'HTTP 500' },
  ])
  let retried = 0
  const { tree } = await pickerView({ loading: false, error: null, catalog: partial, retry: () => { retried++ } }, [])
  assert.equal(ofType(tree, 'checkbox').length, 1)
  assert.match(text(tree), /backup（qq）的群列表没读到：HTTP 500/)
  ofType(tree, 'button').find(button => text(button) === '重新读取群列表').props.onClick()
  assert.equal(retried, 1)
})

async function page() {
  return compile(`${await read('pages/ambient-engagement.tsx')}\nexport { AmbientSettingsSection, AmbientSettingsForm, AmbientStatusSection }`, { ...ui, react: staticHooks() })
}

test('a settings read failure is a permission problem only for 401/403', async () => {
  const module = await page()
  const reloads = []
  const failed = module.AmbientSettingsSection({ read: { loading: false, loaded: false, error: 'connect ECONNREFUSED 127.0.0.1:8086', data: null }, onReload: async () => { reloads.push(1); return null }, currentReadEpoch: () => 0 })
  assert.doesNotMatch(text(failed), /管理员|权限/)
  const [alert] = ofType(failed, 'error-alert')
  assert.ok(alert, 'non-permission failures show an error with retry')
  assert.match(alert.props.error, /ECONNREFUSED/)
  alert.props.onRetry(); assert.equal(reloads.length, 1)
  const denied = module.AmbientSettingsSection({ read: { loading: false, loaded: false, error: 'Token scope does not allow this route', data: null }, onReload: async () => null, currentReadEpoch: () => 0 })
  assert.match(text(denied), /只有管理员账号可以修改/)
  assert.equal(ofType(denied, 'error-alert').length, 0)
})

test('a status read failure shows the real reason and retry', async () => {
  const module = await page()
  let retried = 0
  const tree = module.AmbientStatusSection({ read: { loading: false, loaded: false, error: 'HTTP 500', data: null }, onRetry: () => { retried++ } })
  assert.equal(tree.type, 'error-alert')
  assert.equal(tree.props.error, '群聊插话状态读取失败：HTTP 500')
  tree.props.onRetry(); assert.equal(retried, 1)
})

test('the "only these groups" whitelist uses the group picker instead of a free-text box', async () => {
  const module = await page()
  const initial = { settings: { behavior: 'join', groupScope: 'some', groups: ['qq:1001', 'qq:999'], maxPerHour: 3 }, revision: 'r1' }
  const tree = module.AmbientSettingsForm({ initial, onReload: async () => null })
  assert.equal(ofType(tree, 'textarea').length, 0)
  const [picker] = ofType(tree, 'ambient-group-picker')
  assert.ok(picker, 'group picker is shown')
  assert.deepEqual(picker.props.groups, ['qq:1001', 'qq:999'])
  assert.equal(typeof picker.props.onChange, 'function')
})
