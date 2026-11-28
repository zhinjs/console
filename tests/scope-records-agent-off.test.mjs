// zhinjs/zhin#1250 disabled-feature-as-read-failure on the scope 记录 tab: its Agent sessions come from
// the trace archive, which answers 503 「未安装 @zhin.js/agent，无法读取 trace」 without an Agent. That is
// 「未启用」 with the way to AI setup; permission, gateway and network failures stay a failed read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as jsxRuntime from 'react/jsx-runtime'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as featureDisabled from '../console-ui/src/utils/feature-disabled.mjs'
import * as consoleRoutes from '../console-ui/src/console-routes.mjs'
import * as recordsModel from '../console-ui/src/pages/scope/records-model.mjs'
import * as scopeTree from '../console-ui/src/scope/scope-tree.mjs'

const source = await readFile(new URL('../console-ui/src/pages/scope/records-panel.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const elements = node => Array.isArray(node) ? node.flatMap(elements) : node && typeof node === 'object' ? [node, ...elements(node.props?.children)] : []
const settle = () => new Promise(resolve => setImmediate(resolve))

function fixture(reply) {
  const slots = []; let cursor = 0, effects = []
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value }] },
    useEffect(fn, deps) { const index = cursor++; if (!slots[index] || slots[index].some((value, i) => !Object.is(value, deps[i]))) { slots[index] = deps; effects.push(fn) } },
  }
  const deps = {
    react, 'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { Link: 'a' },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '../../i18n': { useI18n: () => ({ locale: 'zh-CN', t: (message, values) => translate('zh-CN', message, values) }) },
    '@zhin.js/console-ui': { Badge: 'badge', Button: 'button', Card: 'card', Skeleton: 'skeleton' },
    '../../components/StatusState': { StatusState: 'status-state' },
    '../../utils/auth': { apiFetch: async () => { if (reply instanceof Error) throw reply; return reply } },
    '../../console-routes.mjs': consoleRoutes, '../../utils/feature-disabled.mjs': featureDisabled,
    '../../utils/agent-session': { agentSessionsPath: key => `/agent/sessions?sessionKey=${key}`, parseImSessionKey: () => null, SESSION_SCOPE_LABELS: {} },
    '../personal-session-model.mjs': { isPersonalSessionKey: () => false },
    '../agent-session-recent.mjs': { relativeSince: () => '' },
    '../token-usage-model.mjs': { usageSessionLabel: key => key.sessionKey },
    '../../scope/ObjectPageLayout': { ObjectSection: 'object-section' },
    '../../scope/scope-tree.mjs': scopeTree, './records-model.mjs': recordsModel, './records-panel.css': {},
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  let tree
  const render = () => { cursor = 0; tree = module.exports.ScopeRecordsPanel({ scope: { level: 'global' } }); const run = effects; effects = []; run.forEach(fn => fn()); return tree }
  return { render, get tree() { return tree } }
}
const statusOf = tree => elements(tree).filter(node => node.type === 'status-state')

test('the 记录 tab without an Agent says the session records are not enabled and links to AI setup', async () => {
  for (const error of ['未安装 @zhin.js/agent，无法读取 trace', 'Agent Runtime 尚未就绪']) {
    const f = fixture({ ok: false, status: 503, json: async () => ({ success: false, error }) })
    f.render(); await settle(); await settle(); f.render()
    const [state] = statusOf(f.tree)
    assert.equal(state.props.kind, 'empty', error)
    assert.equal(state.props.error, undefined, 'not a failed read')
    assert.equal(state.props.title, 'Agent 会话记录未启用')
    assert.match(state.props.description, /AI 智能体（@zhin\.js\/agent）/)
    assert.equal(elements(state.props.actions).find(node => node.type === 'a').props.to, '/features/ai')
  }
  assert.notEqual(translate('en', 'Agent 会话记录未启用'), 'Agent 会话记录未启用')
})

test('the 记录 tab keeps the failed-read state for permission, gateway, other errors and network failures', async () => {
  for (const reply of [
    { ok: false, status: 403, json: async () => ({ success: false, error: 'Agent Runtime 尚未就绪' }) },
    { ok: false, status: 503, json: async () => ({ success: false, code: 'instance_unavailable', error: 'The Zhin instance is not running' }) },
    { ok: false, status: 500, json: async () => { throw new SyntaxError('not json') } },
    new TypeError('Failed to fetch'),
  ]) {
    const f = fixture(reply)
    f.render(); await settle(); await settle(); f.render()
    const [state] = statusOf(f.tree)
    assert.notEqual(state.props.kind, 'empty', String(reply.status ?? reply))
    assert.ok(state.props.error, 'the failure is classified by StatusState')
  }
})
