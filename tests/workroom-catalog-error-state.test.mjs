import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { catalogReadFailure } from '../console-ui/src/pages/workroom-catalog-model.mjs'

// #64 `workroom-catalog-error-state`: a failed catalog read showed the raw English message in a red box
// (「Unknown RPC type: workrooms:get」「Forbidden」「TypeError: …」) and, every time, 「请先在 Host 安装并配置
// 可选 Workroom Catalog 服务及 Agent」 — the wrong next step when the identity only lacks `agent.view`.
test('only a Host without the catalog is told to install it', () => {
  assert.deepEqual(catalogReadFailure(new Error('Unknown RPC type: workrooms:get')), { kind: 'unsupported', notReady: true })
  assert.deepEqual(catalogReadFailure(Object.assign(new Error('not installed'), { details: { serverCode: 'not_installed' } })), { kind: 'not-installed', notReady: true })
  assert.deepEqual(catalogReadFailure(Object.assign(new Error('Forbidden'), { details: { httpStatus: 403, serverCode: 'forbidden' } })), { kind: 'forbidden', notReady: false })
  assert.deepEqual(catalogReadFailure(new TypeError("Cannot read properties of undefined (reading 'map')")), { kind: 'error', notReady: false })
  assert.equal(catalogReadFailure(null), null)
})

test('the page shows the classified state instead of the raw message', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/workroom-catalog.tsx', import.meta.url), 'utf8')
  assert.match(source, /<StatusState error=\{catalogFailure\}[^>]*permissions=\{\['agent\.view'\]\}/)
  assert.match(source, /description=\{failure\?\.notReady \? i18n\.t\("尚未取得目录，暂不能新建、编辑或发布。请先在 Host 安装并配置可选 Workroom Catalog 服务及 Agent，再刷新；无需重建本地草稿。"\) : undefined\}/)
  // The raw catalog read error no longer goes to the red ErrorAlert; other errors (publish checks) still do.
  assert.match(source, /\{\(error && !catalogFailure\) \|\| publishUnconfirmed \? <ErrorAlert/)
  assert.doesNotMatch(source, /<EmptyState title=\{i18n\.t\("Workroom 目录未就绪"\)\}/)
})
