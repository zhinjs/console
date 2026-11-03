import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as live from '../console-ui/src/components/PluginConfigForm/config-live-status.mjs'
import { configurationSaveSummary } from '../console-ui/src/components/PluginConfigForm/config-evidence-model.mjs'
import { describeSaveResult as ambientSaved } from '../console-ui/src/pages/ambient-engagement-model.mjs'
import { describeSaveResult as skillsSaved } from '../console-ui/src/pages/skills-assistant-model.mjs'

const require = createRequire(import.meta.url)
const application = (statuses = ['applied']) => ({ operationId: 'config:1', sourceRevision: 'file-r2', saved: true,
  generation: 3, applicationRevision: 2, groups: statuses.map((status, index) => ({ id: `group-${index}`,
    paths: [[index ? 'http' : 'ai', 'model']], effect: index ? 'restart-process' : 'in-place', status, dependsOn: [] })) })
const result = statuses => ({ success: true, revision: 'file-r2', application: application(statuses) })

test('purpose-page receipts yield only to a successful read started after receipt arrival', () => {
  const receipt = { value: result(['applied']), observedReadEpoch: 3 }
  assert.strictEqual(live.configurationReceiptForRead({ readEpoch: 1 }, receipt), receipt.value, 'a failed refresh keeps previous read and save evidence')
  assert.strictEqual(live.configurationReceiptForRead({ readEpoch: 3 }, receipt), receipt.value, 'a read already in flight at receipt arrival is not newer proof')
  assert.equal(live.configurationReceiptForRead({ readEpoch: 4 }, receipt), null, 'later read replaces receipt even with the same file revision')
  assert.equal(live.configurationReceiptForRead({ readEpoch: 4 }, null), null)
})

test('only exact current application evidence confirms saved changes, including mixed outcomes', () => {
  for (const [statuses, kind] of [[['applied'], 'applied'], [['applied', 'restart-pending'], 'partial'],
    [['restart-pending'], 'pending'], [['blocked'], 'pending'], [['applied', 'failed'], 'failed'],
    [['applied', 'unknown'], 'unknown'], [['applied', 'superseded'], 'stale']]) {
    assert.equal(live.configurationRuntimeStatus(result(statuses), 'file-r2').kind, kind)
  }
  assert.equal(live.configurationRuntimeStatus(result(), 'newer-file').kind, 'stale')
  assert.equal(live.configurationRuntimeStatus({ ...result(), applicationError: 'unconfirmed' }, 'file-r2').kind, 'unknown')
  assert.equal(live.configurationRuntimeStatus({ ...result(), applicationError: 'superseded' }, 'file-r2').kind, 'stale')
  assert.equal(live.configurationRuntimeStatus({ ...result(), applicationError: 'invalid' }, 'file-r2').kind, 'failed')
  assert.equal(live.configurationRuntimeStatus({}, 'file-r2').kind, 'unsupported')
  assert.equal(live.configurationRuntimeStatus(result([]), 'file-r2').kind, 'applied')
  assert.equal(live.configurationRuntimeStatus({ application: { ...application([]), saved: false } }, 'file-r2').kind, 'unknown')
  assert.equal(live.configurationRuntimeStatus({ application: { ...application([]), generation: 0 } }, 'file-r2').kind, 'unknown')
})

test('malformed application metadata is unconfirmed and does not become a save failure or an active badge', () => {
  const malformed = [null, {}, { ...application(), generation: -1 }, { ...application(), groups: [{}] },
    { ...application(), groups: [{ ...application().groups[0], status: 'success' }] },
    { ...application(), groups: [application().groups[0], application().groups[0]] }]
  for (const value of malformed) {
    const receipt = { success: true, revision: 'file-r2', application: value }
    assert.equal(live.configurationRuntimeStatus(receipt, 'file-r2').kind, 'unknown')
    assert.match(configurationSaveSummary(receipt), /配置已保存/)
    assert.doesNotMatch(configurationSaveSummary(receipt), /配置变更已生效/)
  }
  assert.match(configurationSaveSummary({ success: true, revision: 'r1', restartRequired: false }), /另行核对/)
})

test('ambient and skills save summaries use the same runtime evidence without claiming business verification', () => {
  for (const describe of [ambientSaved, skillsSaved]) {
    const mixed = describe({ status: 'saved', ...result(['applied', 'restart-pending']), restartRequired: true })
    assert.equal(mixed.kind, 'saved'); assert.equal(mixed.applicationKind, 'partial'); assert.match(mixed.text, /部分配置已生效/)
    const unknown = describe({ status: 'saved', ...result(), applicationError: 'unconfirmed' })
    assert.equal(unknown.kind, 'saved'); assert.equal(unknown.applicationKind, 'unknown'); assert.match(unknown.text, /未确认/)
    const invalid = describe({ status: 'saved', ...result(), applicationError: 'invalid' })
    assert.equal(invalid.kind, 'saved'); assert.equal(invalid.applicationKind, 'failed'); assert.match(invalid.text, /校验失败/)
    assert.doesNotMatch(invalid.text, /保存失败/)
  }
})

const source = await readFile(new URL('../console-ui/src/components/PluginConfigForm/ConfigurationLiveStatus.tsx', import.meta.url), 'utf8')
function component(locale = 'zh-CN') {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const mocks = { '../../i18n': { useI18n: () => ({ locale, t: (key, values) => translate(locale, key, values) }) },
    '../ui/badge': { Badge: 'span' }, '../ui/button': { Button: 'button' }, './config-live-status.mjs': live }
  new Function('require', 'exports', 'module', code)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
  return module.exports.ConfigurationLiveStatus
}

test('the actual status component displays mixed group paths/effects and neutralizes old-version success', () => {
  const Component = component()
  const markup = renderToStaticMarkup(React.createElement(Component, { result: result(['applied', 'restart-pending']), revision: 'file-r2' }))
  assert.match(markup, /运行生效状态/); assert.match(markup, /部分配置已生效/); assert.match(markup, /待重启/)
  assert.match(markup, /\/ai\/model/); assert.match(markup, /\/http\/model/); assert.match(markup, /原地更新/); assert.match(markup, /进程重启/)
  const stale = renderToStaticMarkup(React.createElement(Component, { result: result(), revision: 'other-file' }))
  assert.match(stale, /其他文件版本/); assert.doesNotMatch(stale, /variant="success"/)
  assert.match(renderToStaticMarkup(React.createElement(Component, { result: {}, revision: 'old-host' })), /Host 未提供/)
})

test('the actual component localizes metadata and only refreshes on explicit user action', () => {
  let reads = 0
  const Component = component('en')
  const element = Component({ result: result(['applied', 'unknown']), revision: 'file-r2', onRefresh: () => reads++ })
  assert.equal(reads, 0)
  const walk = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : []
  walk(element).find(node => node.type === 'button').props.onClick()
  assert.equal(reads, 1)
  const markup = renderToStaticMarkup(element)
  assert.match(markup, /Runtime application status/); assert.match(markup, /unconfirmed/)
  assert.doesNotMatch(markup, /运行生效|原地更新|结果未确认/)
})

for (const page of ['ambient-engagement', 'skills-assistant']) test(`${page} rejects old-connection saves and ignores late receipts after a Host switch`, async () => {
  const text = await readFile(new URL(`../console-ui/src/pages/${page}.tsx`, import.meta.url), 'utf8')
  const body = /const save = async \(\) => \{([\s\S]*?)\n  \}/.exec(text)?.[1]
  assert.ok(body)
  let active = false, resolve, requests = 0, receipts = 0, feedback = 0, reloads = 0
  const context = { scope: 'connection-a', isInboxCacheScopeActive: () => active,
    requestConsole: () => { requests++; return new Promise(done => { resolve = done }) },
    setSaving() {}, setFeedback() { feedback++ }, setReceipt() { receipts++ }, setServerProblems() {},
    initial: { revision: 'r1', settings: {} }, draft: {}, modes: {},
    buildAmbientPatches: () => [], buildSkillsPatches: () => [],
    describeSaveResult: page === 'ambient-engagement' ? ambientSaved : skillsSaved,
    onReload: async () => { reloads++; return null }, i18n: { locale: 'zh-CN', t: value => value } }
  const executable = ts.transpileModule(`function build(context){const {${Object.keys(context).join(',')}}=context; return async()=>{${body}}}`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const save = new Function(`${executable}; return build`)()(context)
  await save(); assert.equal(requests, 0)
  active = true
  const pending = save(); assert.equal(requests, 1)
  const before = feedback
  active = false; resolve({ status: 'saved', ...result() }); await pending
  assert.equal(receipts, 0); assert.equal(feedback, before); assert.equal(reloads, 0)
})
