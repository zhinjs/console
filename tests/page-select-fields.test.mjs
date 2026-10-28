import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { defaultI18n } from './locale-fixture.mjs'
import { SCENARIO_PROFILES } from '../console-ui/src/pages/scenario-lab/scenario-model.mjs'
import { EXPORT_WINDOWS, REPLAY_KINDS, REPLAY_OUTCOMES, kindLabel, outcomeLabel } from '../console-ui/src/pages/bot-replay-model.mjs'

const require = createRequire(import.meta.url)
const selectSource = await readFile(new URL('../console-ui/src/components/ui/select.tsx', import.meta.url), 'utf8')
const selectModule = { exports: {} }
const compiledSelect = ts.transpileModule(selectSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
// Only the unrelated CSS class combiner is substituted; the shared dropdown,
// Radix components, encoding and page callbacks all execute production code.
new Function('require', 'exports', 'module', compiledSelect)(name => name === '@zhin.js/client' ? { cn: (...classes) => classes.filter(Boolean).join(' ') } : require(name), selectModule.exports, selectModule)
const { SelectField, Select, SelectItem } = selectModule.exports
const pages = new Map()
async function page(file) {
  if (!pages.has(file)) {
    const source = await readFile(new URL(`../console-ui/src/pages/${file}.tsx`, import.meta.url), 'utf8')
    pages.set(file, ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))
  }
  return pages.get(file)
}
async function field(file, label, bindings) {
  const ast = await page(file)
  let element
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'SelectField'
      && (label === undefined || node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'aria-label' && prop.initializer?.getText(ast).includes(JSON.stringify(label))))) element = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(element, `${file}: ${label}`)
  const js = ts.transpileModule(`const result = ${element.getText(ast)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const original = new Function('require', 'exports', 'SelectField', 'i18n', ...Object.keys(bindings), `${js}; return result;`)(require, {}, SelectField, defaultI18n, ...Object.values(bindings))
  const root = SelectField.render(original.props, null)
  assert.equal(root.type, Select)
  assert.equal(root.props.children[0].props['aria-label'], label)
  return { root, original, choose: value => root.props.onValueChange(JSON.stringify(value)) }
}
function descendants(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(descendants)] : [] }
function optionValues(dropdown) { return descendants(dropdown.root).filter(node => node.type === SelectItem).map(node => JSON.parse(node.props.value)) }

test('task provider and exact Endpoint selections pass real values and reset only the existing target draft', async () => {
  const emptyTarget = { kind: 'private', id: '', parentKind: '', parentId: '', threadId: '' }
  const owner = 'root/提醒', endpoint = { adapter: 'root/icqq', id: 'full:account' }
  let selectedOwner, endpointKey, targetFields
  const provider = await field('task-center', '任务用途', { selectedOwner: '', busy: false, pending: null, catalog: { providers: [{ owner, title: '提醒' }] }, chooseProvider: value => { selectedOwner = value } })
  assert.deepEqual(optionValues(provider), ['', owner]); provider.choose(owner); assert.equal(selectedOwner, owner)
  provider.choose(''); assert.equal(selectedOwner, '')
  const account = await field('task-center', '投递账号', { endpointKey: '', disabled: false, endpoints: [{ endpoint, name: '工作账号', connected: true }], emptyTarget, setEndpointKey: value => { endpointKey = value }, setTargetFields: value => { targetFields = value } })
  const encoded = JSON.stringify(endpoint)
  assert.deepEqual(optionValues(account), ['', encoded]); account.choose(encoded)
  assert.equal(endpointKey, encoded); assert.equal(targetFields, emptyTarget)
  account.choose(''); assert.equal(endpointKey, '')
  const blocked = await field('task-center', '任务用途', { selectedOwner: owner, busy: false, pending: {}, catalog: { providers: [{ owner, title: '提醒' }] }, chooseProvider: () => assert.fail('render must not change selection') })
  assert.equal(blocked.root.props.disabled, true)
})

test('task conversation selectors retain empty parent and existing target fields through the shared callback', async () => {
  let targetFields = { kind: 'private', id: 'room', parentKind: 'group', parentId: 'parent', threadId: 'topic' }
  const setTargetFields = update => { targetFields = update(targetFields) }
  const kind = await field('task-center', '会话类型', { targetFields, disabled: false, setTargetFields })
  kind.choose('channel'); assert.deepEqual(targetFields, { kind: 'channel', id: 'room', parentKind: 'group', parentId: 'parent', threadId: 'topic' })
  const parent = await field('task-center', '父容器类型', { targetFields, disabled: false, setTargetFields })
  assert.equal(optionValues(parent)[0], ''); parent.choose(''); assert.equal(targetFields.parentKind, '')
})

test('scenario dropdowns change only their authored fields and retain explicit empty choices', async () => {
  let target = { kind: 'group', id: 'room' }, parentKind = 'channel', profile = 'text', status = 'executed'
  const kind = await field('scenario-lab', '来源会话类型', { target, setTarget: update => { target = update(target) } })
  kind.choose('private'); assert.deepEqual(target, { kind: 'private', id: 'room' })
  const parent = await field('scenario-lab', '来源父容器类型', { parentKind, setParentKind: value => { parentKind = value } })
  parent.choose(''); assert.equal(parentKind, '')
  const capability = await field('scenario-lab', '测试能力配置', { profile, SCENARIO_PROFILES, setProfile: value => { profile = value } })
  capability.choose('rich'); assert.equal(profile, 'rich')
  const dispatch = await field('scenario-lab', '预期派发状态', { status, setStatus: value => { status = value } })
  dispatch.choose(''); assert.equal(status, '')
})

test('replay filters preserve raw sibling filters, empty all-values and export window strings', async () => {
  let draft = { platform: 'icqq', sceneId: 'group:123', kind: 'old', outcome: 'old' }, windowChoice = 'day'
  const setDraft = value => { draft = value }
  const kind = await field('bot-replay', '类型', { draft, setDraft, REPLAY_KINDS, kindLabel })
  kind.choose(''); assert.deepEqual(draft, { platform: 'icqq', sceneId: 'group:123', kind: '', outcome: 'old' })
  const outcome = await field('bot-replay', '结果', { draft, setDraft, REPLAY_OUTCOMES, outcomeLabel })
  outcome.choose('deny'); assert.equal(draft.outcome, 'deny'); assert.equal(draft.sceneId, 'group:123')
  const range = await field('bot-replay', '导出范围', { windowChoice, EXPORT_WINDOWS, setWindowChoice: value => { windowChoice = value } })
  assert.ok(optionValues(range).every(value => typeof value === 'string'))
  range.choose(String(EXPORT_WINDOWS[0].value)); assert.equal(windowChoice, String(EXPORT_WINDOWS[0].value))
})

test('assistant task filtering and welcome instance changes retain their original callbacks', async () => {
  let status = 'all'
  const filter = await field('assistant-jobs', '助手任务状态', { status, setStatus: value => { status = value } })
  filter.choose('paused'); assert.equal(status, 'paused')
  filter.choose('all'); assert.equal(status, 'all')
  let observed = true, target = { kind: 'group', id: 'old' }, params
  const welcome = await field('welcome-use-case', '群欢迎实例', { selected: true, instanceKey: 'welcome-a', catalog: { instances: [{ instanceKey: 'welcome-a', status: 'active' }, { instanceKey: 'welcome-b', status: 'inactive' }] }, setObserved: value => { observed = value }, setTarget: value => { target = value }, setParams: value => { params = value } })
  welcome.choose('welcome-b'); assert.equal(observed, false); assert.deepEqual(target, { kind: 'group' }); assert.deepEqual(params, { instance: 'welcome-b' })
  welcome.choose(''); assert.deepEqual(params, {})
})

test('marketplace sorting retains every existing sort option and the original controlled state callback', async () => {
  const ast = await page('marketplace')
  let options
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'SORT_OPTIONS') options = node.initializer.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast); assert.ok(options)
  const SORT_OPTIONS = Function(`return (${options})`)()
  let sortKey = 'downloads'
  const sort = await field('marketplace', undefined, { sortKey, SORT_OPTIONS, setSortKey: value => { sortKey = value } })
  assert.deepEqual(optionValues(sort), ['relevance', 'downloads', 'newest', 'name'])
  sort.choose('newest'); assert.equal(sortKey, 'newest')
  sort.choose('relevance'); assert.equal(sortKey, 'relevance')
})
