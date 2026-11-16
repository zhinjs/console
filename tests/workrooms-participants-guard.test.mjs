import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import * as jsxRuntime from 'react/jsx-runtime'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as model from '../console-ui/src/pages/engagements-model.mjs'

// What the Host sent in the 2026-11-15 deployment: no `participants`, and a detail without `board` / `events`.
const SUMMARY = { engagementId: 'e1', status: 'completed', startedAt: 1_794_000_000_000, venue: 'room', hops: 2, turns: 3, tokensUsed: 1840 }

async function renderWorkrooms({ engagements, detail }) {
  const runtime = pageRuntime()
  let calls = 0
  const code = ts.transpileModule(await readFile(new URL('../console-ui/src/pages/workrooms.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const i18n = { locale: 'zh-CN', t: (m, values) => translate('zh-CN', m, values), number: String, date: () => '11/15 08:00' }
  const deps = {
    react: { ...runtime.api, useMemo: fn => fn(), useCallback: fn => fn }, 'react/jsx-runtime': jsxRuntime,
    '../i18n': { useI18n: () => i18n },
    'react-router-dom': { Link: 'a', useSearchParams: () => [new URLSearchParams('engagementId=e1'), () => {}] },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '@zhin.js/client': {
      cn: (...parts) => parts.filter(Boolean).join(' '),
      // First render loading, then loaded: the page shows its skeleton until it has seen a load finish.
      useEngagements: () => ({ engagements: calls++ ? engagements : [], loading: calls === 1, error: null, reload: async () => {} }),
      useEngagementDetail: () => ({ detail, loading: false, error: null, reload: async () => {} }),
      useVenues: () => ({ venues: [] }),
    },
    '../hooks/visible-polling.mjs': { startVisiblePolling: () => () => {} },
    '../components/PageHeader': { PageHeader: 'header' }, '../components/PageShell': { PageShell: 'main' },
    '../components/empty-state': { EmptyState: 'empty' }, '../components/ui/badge': { Badge: 'badge' },
    '../components/ui/button': { Button: 'button' }, '../components/ui/card': { Card: 'card', CardContent: 'card-content' },
    '../components/ui/skeleton': { Skeleton: 'skeleton' }, '../components/ui/list-item-button': { ListItemButton: 'button' },
    '../components/StatusState': { StatusState: 'status' },
    '../components/ui/sheet': { Sheet: 'sheet', SheetContent: 'sheet-content', SheetDescription: 'p', SheetHeader: 'div', SheetTitle: 'h2' },
    '../hooks/useIsMobile': { useIsMobile: () => false },
    './engagements-model.mjs': model,
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  runtime.mount(() => ({ type: module.exports.default, props: {} }))
  await runtime.settle()
  runtime.render() // the load finishes
  await runtime.settle()
  // Every string the tree carries, in children or in props such as `title` and `actions`.
  const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? Object.values(node.props ?? {}).map(text).join(' ') : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
  return { all: nodes(runtime.value), text: text(runtime.value) }
}

test('a Host that leaves out participants, board and events does not take the workrooms page down', async () => {
  const page = await renderWorkrooms({ engagements: [SUMMARY], detail: { summary: SUMMARY } })
  assert.match(page.text, /协作详情/u)
  assert.match(page.text, /参与方：—/u, 'missing participants read as none')
  assert.match(page.text, /共享黑板 · 0/u)
  assert.match(page.text, /原始事件 · 0/u)
})

test('participants that are present are still listed', async () => {
  const withPeople = { ...SUMMARY, participants: ['agent:planner', '', 7, 'agent:reviewer'] }
  const page = await renderWorkrooms({ engagements: [withPeople], detail: { summary: withPeople, board: [], events: [] } })
  assert.match(page.text, /参与方：agent:planner, agent:reviewer/u)
})

test('the model reads omitted list fields and counters as empty', () => {
  assert.deepEqual(model.engagementParticipants({}), [])
  assert.deepEqual(model.engagementParticipants(undefined), [])
  assert.deepEqual(model.engagementParticipants({ participants: 'agent:x' }), [])
  assert.deepEqual(model.listOf(null), [])
  assert.deepEqual(model.engagementTotals([{ status: 'running' }, { status: 'failed', turns: 2, tokensUsed: 10 }]), { running: 1, failed: 1, turns: 2, tokens: 10 })
})
