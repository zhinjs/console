import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EMPTY_PROGRESS, GATEWAY_RPC, PACKAGE_PHASES, TRANSACTION_OPERATIONS, declarationConfig, declarationDraft, declareRequestBody, fieldErrorsAt,
  instanceKeyFromPackage, instanceKeyProblem, operationLabel, parseDeclarationJson, phaseLabel, readConfigurationNeeds, readDeclarationErrors,
  readTransactionResult, reducePackageProgress, transactionSummary,
} from '../console-ui/src/pages/ops/gateway-model.mjs'
import { readTerminalTargets, terminalNeedsConfirmation } from '../console-ui/src/pages/ops/terminal-model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

const zh = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const CJK = /[㐀-鿿]/u

test('the mirror carries gateway.plugins.declare, the configure phase and the declare operation', () => {
  assert.equal(GATEWAY_RPC.PLUGINS_DECLARE, 'gateway.plugins.declare')
  const contract = read('contracts/gateway.ts')
  for (const name of ['GATEWAY_PLUGINS_RPC', 'GatewayPluginsDeclareRequest', 'GatewayPluginConfigurationNeed', 'needsConfiguration?', "'configure'", "'declare'", 'insecureHostKey?: true']) {
    assert.ok(contract.includes(name), name)
  }
  assert.ok(PACKAGE_PHASES.indexOf('configure') > PACKAGE_PHASES.indexOf('package-manager'))
  assert.ok(PACKAGE_PHASES.indexOf('configure') < PACKAGE_PHASES.indexOf('start-instance'))
  assert.deepEqual([...TRANSACTION_OPERATIONS], ['install', 'uninstall', 'update', 'declare'])
  for (const operation of TRANSACTION_OPERATIONS) {
    assert.match(operationLabel(operation, zh), CJK, operation)
    assert.doesNotMatch(operationLabel(operation, en), CJK, operation)
  }
  assert.equal(phaseLabel('configure', en), 'Write the plugin declaration and configuration')
  assert.equal(operationLabel('declare', en), 'Declare')
})

test('a declare transaction folds like a package transaction and reports a config-only rollback', () => {
  let state = EMPTY_PROGRESS
  state = reducePackageProgress(state, { type: 'start', id: 'd1', operation: 'declare', packages: [{ name: '@zhin.js/adapter-qq', spec: '@zhin.js/adapter-qq', source: 'adapter' }] })
  for (const phase of ['snapshot', 'stop-instance', 'configure', 'start-instance', 'rollback', 'restore-files', 'restart-instance']) {
    state = reducePackageProgress(state, { type: 'phase', id: 'd1', phase })
  }
  state = reducePackageProgress(state, { type: 'result', id: 'd1', result: {
    id: 'd1', operation: 'declare', packages: [], ok: false, status: 'rolledBack', failedPhase: 'start-instance', error: 'ready timeout',
    instance: { before: 'running', after: 'running' }, startedAt: 1, finishedAt: 2,
  } })
  assert.equal(state.operation, 'declare')
  assert.ok(state.phases.includes('configure'))
  assert.equal(state.result.operation, 'declare')
  assert.equal(transactionSummary(state.result, zh).tone, 'warning')
  assert.equal(transactionSummary(state.result, en).title, 'Declaration failed; the previous configuration was restored and the old instance started')
  const ok = readTransactionResult({ ...state.result, ok: true, status: 'succeeded', failedPhase: undefined })
  assert.equal(transactionSummary(ok, en).title, 'Declare succeeded')
})

test('install results expose needsConfiguration; replies of every shape read the same needs', () => {
  const need = { name: '@zhin.js/adapter-qq', instanceKey: 'qq', missing: ['endpoints'], missingEnv: ['QQ_SECRET'] }
  const result = readTransactionResult({
    id: 't', operation: 'install', packages: [], ok: true, status: 'succeeded', instance: { before: 'running', after: 'running' }, startedAt: 1, finishedAt: 2,
    needsConfiguration: [need, { name: 'x' }, { nope: true }, { ...need, missing: [] }],
  })
  assert.deepEqual(result.needsConfiguration, [need, { name: 'x', instanceKey: 'x', missing: [], missingEnv: [] }], 'invalid dropped, duplicates by key dropped')
  assert.equal('needsConfiguration' in readTransactionResult({ ...result, needsConfiguration: [] }), false, 'absent when none')
  // `plugin:install` (workflow) replies carry a single need object.
  assert.deepEqual(readConfigurationNeeds({ restartRequired: false, needsConfiguration: need }), [need])
  assert.deepEqual(readConfigurationNeeds([need]), [need])
  assert.deepEqual(readConfigurationNeeds(need), [need])
  assert.deepEqual(readConfigurationNeeds({ restartRequired: true }), [])
  assert.deepEqual(readConfigurationNeeds(null), [])
  assert.deepEqual(readConfigurationNeeds({ needsConfiguration: { name: '@zhin.js/adapter-sandbox', missing: 'endpoints' } }),
    [{ name: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox', missing: [], missingEnv: [] }])
})

test('declare requests carry package, instance key and the config object only', () => {
  assert.equal(instanceKeyFromPackage('@zhin.js/adapter-sandbox'), 'sandbox')
  assert.equal(instanceKeyFromPackage('zhin-plugin-weather'), 'zhin-plugin-weather')
  assert.equal(instanceKeyFromPackage('plugin-weather'), 'weather')
  const config = { endpoints: [{ id: 'main', token: '${QQ_TOKEN}' }] }
  const body = declareRequestBody({ package: '@zhin.js/adapter-qq', instanceKey: 'qq-main', config })
  assert.deepEqual(body, { package: '@zhin.js/adapter-qq', instanceKey: 'qq-main', config })
  assert.notEqual(body.config, config, 'the draft is copied, not shared')
  assert.deepEqual(declareRequestBody({ package: '@zhin.js/adapter-qq' }), { package: '@zhin.js/adapter-qq', instanceKey: 'qq', config: {} })
  assert.deepEqual(declareRequestBody({ package: 'a', instanceKey: 'a', config: [1], startInstance: true }), { package: 'a', instanceKey: 'a', config: {}, startInstance: true })
  assert.throws(() => declareRequestBody({}), TypeError)
  assert.equal(instanceKeyProblem('qq-main', zh), null)
  assert.match(instanceKeyProblem('', en), /instance name/u)
  assert.match(instanceKeyProblem('QQ main', en), /lowercase/u)
  assert.match(instanceKeyProblem('-x', zh), CJK)
})

test('the form draft is the schema seed with defaults; the JSON fallback must be an object', () => {
  const schema = { type: 'object', object: {
    endpoints: { type: 'list', required: true, inner: { type: 'object', object: { id: { type: 'string', required: true } } } },
    debug: { type: 'boolean', default: false },
    prefix: { type: 'string' },
  } }
  assert.deepEqual(declarationDraft(schema), { endpoints: [], debug: false })
  assert.deepEqual(declarationDraft(null), {})
  assert.deepEqual(declarationDraft({ type: 'string' }), {})
  assert.deepEqual(declarationConfig(undefined, zh), { config: {}, problem: null })
  assert.equal(declarationConfig([1], en).problem, 'The configuration must be an object.')
  assert.deepEqual(parseDeclarationJson('  ', zh), { config: {}, problem: null })
  assert.deepEqual(parseDeclarationJson('{"endpoints":[]}', zh), { config: { endpoints: [] }, problem: null })
  assert.equal(parseDeclarationJson('{', en).problem, 'Not valid JSON.')
  assert.equal(parseDeclarationJson('[]', en).problem, 'The configuration must be an object.')
})

test('a refused declaration (400 invalid_input) maps to inline field errors', () => {
  const message = '配置未通过插件 Schema 校验，未声明：$.endpoints must have required property endpoints；$.endpoints.0.token 类型应为 string；$ must be object；缺少环境变量 QQ_SECRET'
  const errors = readDeclarationErrors(message)
  assert.equal(errors.general, null)
  assert.deepEqual(errors.fields, [
    { path: 'endpoints', message: 'must have required property endpoints' },
    { path: 'endpoints.0.token', message: '类型应为 string' },
    { path: '', message: 'must be object' },
  ])
  assert.deepEqual(errors.missingEnv, ['QQ_SECRET'])
  assert.deepEqual(fieldErrorsAt(errors, 'endpoints').map(error => error.path), ['endpoints', 'endpoints.0.token'])
  assert.deepEqual(fieldErrorsAt(errors, 'end'), [], 'prefixes match whole segments only')
  assert.deepEqual(fieldErrorsAt(errors, '').map(error => error.message), ['must be object'])
  const other = readDeclarationErrors('插件实例 qq 已声明；修改其配置请使用 config:patch-project')
  assert.equal(other.general, '插件实例 qq 已声明；修改其配置请使用 config:patch-project')
  assert.deepEqual(other.fields, [])
  assert.deepEqual(fieldErrorsAt(null, 'x'), [])
})

test('the declaration form posts gateway.plugins.declare, keeps the draft on invalid_input and reuses the schema editor', () => {
  const form = read('pages/ops/plugin-declare.tsx')
  assert.match(form, /GATEWAY_RPC\.PLUGINS_DECLARE/u)
  assert.match(form, /keepInvalidInput: true/u)
  assert.match(form, /readDeclarationErrors\(/u)
  assert.match(form, /SchemaFieldEditor/u)
  assert.match(form, /schema:get/u)
  assert.match(form, /需要配置/u)
  assert.doesNotMatch(form, /config:replace-source/u, 'declarations never go through the config source')
  const instance = read('pages/ops/instance.tsx')
  assert.match(instance, /ConfigurationNeedsPanel/u)
  assert.match(instance, /result\??\.needsConfiguration/u)
  const onboarding = read('pages/onboarding/adapter-install.tsx')
  assert.match(onboarding, /GATEWAY_RPC\.PACKAGES_INSTALL/u)
  assert.match(onboarding, /ConfigurationNeedsPanel/u)
  assert.match(read('pages/onboarding/index.tsx'), /<AdapterInstallSection/u)
  assert.match(read('pages/marketplace.tsx'), /<PackageActionPanel/u)
  assert.match(read('pages/PackageAction.tsx'), /<ConfigurationNeedsPanel/u)
  const runner = read('pages/ops/use-gateway.ts')
  assert.ok(runner.indexOf('subscribePackageProgress(event') < runner.indexOf('await gatewayRequest(type, data'), 'subscribe before sending')
})

test('SSH targets without host key verification are flagged and need a confirmation', () => {
  const targets = readTerminalTargets([
    { id: 'local', kind: 'local', label: '本机 Shell', available: true, insecureHostKey: true },
    { id: 'lab', kind: 'ssh', label: 'lab（不安全：未校验主机密钥）', available: true, insecureHostKey: true },
    { id: 'prod', kind: 'ssh', label: 'prod', available: true, insecureHostKey: 'yes' },
  ])
  assert.equal('insecureHostKey' in targets[0], false, 'local shells have no host key')
  assert.equal(targets[1].insecureHostKey, true)
  assert.equal('insecureHostKey' in targets[2], false, 'only an explicit true counts')
  assert.deepEqual(targets.map(terminalNeedsConfirmation), [false, true, false])
  assert.equal(terminalNeedsConfirmation(null), false)
  const page = read('pages/ops/terminal.tsx')
  const open = page.slice(page.indexOf('const open = () =>'), page.indexOf('const openTab ='))
  assert.match(open, /terminalNeedsConfirmation\(target\)\) \{ setConfirmInsecure\(target\); return \}/u, 'open asks before an insecure target')
  assert.match(page, /<ConfirmDialog open onOpenChange[\s\S]{0,120}variant="destructive"/u)
  assert.match(page, /InsecureHostKeyBadge/u)
  assert.equal(en('未校验主机密钥'), 'Host key not verified')
})
