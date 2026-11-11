import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { parse } from 'yaml'
import { defaultI18n } from './locale-fixture.mjs'
import * as skillsModel from '../console-ui/src/pages/skills-assistant-model.mjs'

const nodes = node => node && typeof node === 'object'
  ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
const inert = new Proxy({}, { get: (_target, name) => String(name) })

/** Execute the production page/functions; only transport and inert child components are substituted. */
async function page(file, exports, dependencies) {
  const source = await readFile(new URL(`../console-ui/src/pages/${file}.tsx`, import.meta.url), 'utf8')
  const code = ts.transpileModule(`${source}\nexport { ${exports.join(', ')} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name in dependencies) return dependencies[name]
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    if (name === 'lucide-react' || name.startsWith('../components/')) return inert
    throw new Error(`Unexpected page dependency ${name}`)
  }, module, module.exports)
  return module.exports
}

test('the actual skills page reads status only and links to the single graph purpose editor', async () => {
  const calls = [], reads = []
  const status = { tasks: [{ task: 'skills', mode: 'active', calls: 1, selected: 1, abstained: 0, shadow: 0,
    failed: 0, averageMs: 100 }], totals: { calls: 1, inputTokens: 0, outputTokens: 0 },
    recent: [{ at: 1, task: 'skills', mode: 'active', outcome: 'selected', durationMs: 100 }], updatedAt: 1 }
  const module = await page('skills-assistant', ['SkillsAssistantSession', 'SkillsStatusSection'], {
    '../i18n': { useI18n: () => defaultI18n },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => 'scope' },
    '../utils/inbox-cache': { isInboxCacheScopeActive: value => value === 'scope' },
    react: { useState: initial => [initial, () => {}], useRef: current => ({ current }), useCallback: fn => fn },
    'react-router-dom': { Link: 'link' },
    yaml: { parse },
    '../utils/console-rpc': { requestConsole: async request => { calls.push(request); return { revision: 'legacy', source: 'plugins: {}' } } },
    '../utils/plugin-rpc': { pluginRpc: async (...args) => { calls.push(args); return status } },
    '../utils/read-error.mjs': { readErrorSummary: String },
    '../hooks/use-console-read': { useConsoleRead: read => {
      reads.push(read)
      return { data: null, loading: false, loaded: true, refresh: read }
    } },
    './skills-assistant-model.mjs': skillsModel,
    '../components/PluginConfigForm/config-live-status.mjs': {},
  })
  const rendered = module.SkillsAssistantSession()
  const [data] = await Promise.all(reads.map(read => read()))
  assert.deepEqual(calls, [['root', 'skills']])
  const statusTree = module.SkillsStatusSection({ read: { data, loaded: true, loading: false }, onRetry() {} })
  assert.match(JSON.stringify(statusTree), /给出了建议/)
  const destination = nodes(rendered).find(node => node.type === 'link' && node.props.to === '/features/ai?tab=purposes')
  assert.ok(destination, 'the supported graph editor must remain reachable')
  const header = nodes(rendered).find(node => node.type === 'PageHeader')
  await header.props.actions.props.onClick()
  assert.deepEqual(calls, [['root', 'skills'], ['root', 'skills']], 'refresh cannot restore file-based decision writes')
})
