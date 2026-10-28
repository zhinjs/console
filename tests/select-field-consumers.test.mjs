import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prepareLocaleModule } from './locale-fixture.mjs'
import { endpointRouteKey } from '../console-ui/src/pages/workroom-catalog-model.mjs'
import { endpointKey } from '../console-ui/src/components/PluginConfigForm/conversation-scope-model.mjs'

const root = new URL('../console-ui/src/', import.meta.url)
async function functions(path, names) {
  const source = await readFile(new URL(path, root), 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return names.map(name => {
    const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(node, `${name} exists in the actual consumer`)
    return node.getText(ast).replace(/^(?:export )?function /, 'export function ')
  }).join('\n')
}
async function load(source) {
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  code = code.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))
  return import(`data:text/javascript;base64,${Buffer.from(prepareLocaleModule(code)).toString('base64')}`)
}
const fixture = await load(`
  import {useId,useRef,useEffect} from ${JSON.stringify(import.meta.resolve('react'))};
  import {endpointRouteKey,parseEndpointRouteKey} from ${JSON.stringify(new URL('pages/workroom-catalog-model.mjs', root).href)};
  import {CONVERSATION_KINDS,CONVERSATION_KIND_LABELS,endpointKey,targetDraft,targetDraftIssue,updateTargetField,updateTargetParent,createScopeReadGate} from ${JSON.stringify(new URL('components/PluginConfigForm/conversation-scope-model.mjs', root).href)};
  export const controls=[];
  export const state={catalog:{rows:[]}};
  const useState=()=>[state.catalog,()=>{}];
  const useInboxCacheScope=()=> 'scope';
  const getInboxCacheScope=()=> 'scope';
  const isInboxCacheScopeActive=()=>true;
  const SPACE_KINDS=['group','channel','repository'];
  const SelectField=(props)=>{controls.push(props);return <button disabled={props.disabled} aria-invalid={props['aria-invalid']} />};
  const Button=({children,...props})=><button {...props}>{children}</button>;
  const Input=()=> <input/>;
  const Badge=({children})=><span>{children}</span>;
  const RadioTower=()=>null;
  const GitFork=()=>null;
  ${await functions('pages/workroom-catalog.tsx', ['Field', 'emptyConversation', 'MessageRouteEditor', 'ConversationEditor'])}
  ${await functions('components/PluginConfigForm/ConversationTargetEditor.tsx', ['ConversationTargetEditor', 'ConversationTargetSummary'])}
  const control='mt-1 w-full min-w-0';
`)
function render(Component, props) {
  fixture.controls.length = 0
  renderToStaticMarkup(React.createElement(Component, props))
  return [...fixture.controls]
}

test('message projection dropdown preserves inheritance, stale routes, occupied disabling and exact route identity', () => {
  const selected = { adapter: 'root/qq', endpoint: 'missing:bot' }
  const changes = []
  const endpoints = [{ adapter: 'root/qq', name: 'used:bot', connected: true }, { adapter: 'root/qq', name: 'available', connected: false }]
  const [control] = render(fixture.MessageRouteEditor, {
    member: {agent: 'worker', messageRoute: selected}, endpoints, routeOwners: new Map([[endpointRouteKey({adapter: 'root/qq', endpoint: 'used:bot'}), 'other']]),
    primaryConversation: {adapter: 'qq', endpoint: 'main'}, issue: {code: 'unknown', message: 'stale'}, readOnly: false,
    onChange: value => changes.push(value),
  })
  assert.equal(control.value, endpointRouteKey(selected))
  assert.equal(control['aria-invalid'], true)
  assert.deepEqual(control.options.map(option => option.value), ['', endpointRouteKey(selected), 'root/qq\0used:bot', 'root/qq\0available'])
  assert.match(control.options[0].label, /继承主空间 Endpoint · qq:main/)
  assert.match(control.options[1].label, /Endpoint 已失效/)
  assert.equal(control.options[2].disabled, true)
  assert.match(control.options[2].label, /已由 other 使用/)
  assert.equal(control.options[3].disabled, false)
  assert.deepEqual(changes, [])
  control.onValueChange('')
  control.onValueChange('root/qq\0available')
  assert.deepEqual(changes, [undefined, {adapter: 'root/qq', endpoint: 'available'}])
})

test('Workroom conversation dropdown preserves NUL reset, unknown values, errors and read-only state', () => {
  const value = {adapter: 'qq', endpoint: 'retired', kind: 'group', id: 'room', agent: 'unknown-agent'}
  const changes = []
  const controls = render(fixture.ConversationEditor, {title: 'Room', required: true, value, endpoints: [], orchestrators: ['main'], issues: {endpoint: 'missing', agent: 'missing'}, readOnly: true, onChange: value => changes.push(value)})
  assert.equal(controls.length, 3)
  assert.ok(controls.every(control => control.disabled))
  assert.equal(controls[0].options[0].value, '\0')
  assert.equal(controls[0].options[1].value, endpointRouteKey(value))
  assert.match(controls[0]['aria-describedby'], /-endpoint$/)
  assert.match(controls[2]['aria-describedby'], /-agent$/)
  assert.equal(controls[2].value, 'unknown-agent')
  assert.deepEqual(changes, [])
  controls[0].onValueChange('\0')
  assert.deepEqual(changes, [{...value, adapter: '', endpoint: ''}])
})

test('conversation target dropdowns retain unverified identities and forward direct values without resetting draft data', () => {
  fixture.state.catalog = {rows: []}
  const value = {endpoint: {adapter: 'qq', id: 'missing', retained: true}, kind: 'repository', id: 'repo', parent: {kind: 'custom', id: 'parent'}, threadId: 'thread'}
  const changes = []
  const controls = render(fixture.ConversationTargetEditor, {value, allowedKinds: ['group'], idPrefix: 'target', onChange: value => changes.push(value)})
  assert.equal(controls[0].id, 'target-endpoint')
  assert.equal(controls[0].value, endpointKey(value.endpoint))
  assert.match(controls[0].options[1].label, /当前列表未核对/)
  assert.deepEqual(controls[1].options.map(option => option.value), ['', 'repository', 'group'])
  assert.equal(controls[2].options[0].value, '')
  assert.equal(controls[2].options[1].value, 'custom')
  assert.deepEqual(changes, [])
  controls[1].onValueChange('group')
  controls[2].onValueChange('')
  assert.deepEqual(changes, [{...value, kind: 'group'}, {...value, parent: {kind: '', id: 'parent'}}])
})
