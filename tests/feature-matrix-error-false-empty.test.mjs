import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { featureListView, pluginListReadError } from '../console-ui/src/pages/features/feature-list-view.mjs'
import { statusFromError } from '../console-ui/src/components/status-state-model.mjs'

// #64 `feature-matrix-error-false-empty`: when /api/plugins failed, 功能矩阵 and 功能 → 全局 still said
// 「还没有功能 / 安装插件后…」 under the error, and the matrix error was a bare 「HTTP 500」 in an ErrorAlert.
const t = (text, values = []) => text.replace(/\{(\d+)\}/gu, (_, index) => String(values[Number(index)]))

test('a failed read with nothing listed is a failure, not 「还没有功能」', () => {
  assert.equal(featureListView({ loading: false, error: 'boom', hasRows: false }), 'failed')
  assert.equal(featureListView({ loading: false, error: null, hasRows: false }), 'empty')
  assert.equal(featureListView({ loading: true, error: null, hasRows: false }), 'loading')
  assert.equal(featureListView({ loading: true, error: 'boom', hasRows: false }), 'loading', 'retrying')
  assert.equal(featureListView({ loading: false, error: 'boom', hasRows: true }), 'list', 'rows already read stay listed')
})

test('the plugin-list error carries the HTTP status and the Host code, so StatusState can tell the cause', () => {
  assert.equal(statusFromError(pluginListReadError(403, null, t)).kind, 'forbidden')
  assert.equal(statusFromError(pluginListReadError(401, null, t)).kind, 'forbidden')
  assert.equal(statusFromError(pluginListReadError(503, { code: 'instance_unavailable', error: 'Instance unavailable' }, t)).kind, 'instance-unavailable')
  assert.equal(statusFromError(pluginListReadError(400, { code: 'unsupported' }, t)).kind, 'unsupported')
  const plain = pluginListReadError(500, null, t)
  assert.equal(plain.message, '插件读取失败（HTTP 500）')
  assert.equal(plain.details.httpStatus, 500)
  assert.equal(statusFromError(plain).kind, 'error')
  assert.equal(pluginListReadError(500, { error: 'disk full' }, t).message, 'disk full', 'the Host reason is kept for 技术详情')
  const later = statusFromError(pluginListReadError(503, { code: 'instance_unavailable' }, t, '12'))
  assert.equal(later.retryAfterSeconds, 12, 'the gateway Retry-After header is the suggested delay')
  assert.equal(pluginListReadError(503, null, t, 'soon').details.retryAfter, undefined)
})

test('both pages render the error through StatusState and only show 「还没有功能」 when the read succeeded', () => {
  const read = path => readFileSync(new URL(`../console-ui/src/pages/features/${path}`, import.meta.url), 'utf8')
  const matrix = read('feature-matrix.tsx')
  assert.doesNotMatch(matrix, /<ErrorAlert/u)
  assert.match(matrix, /<StatusState error=\{failure \?\? error\}/u)
  const panel = read('global-features-panel.tsx')
  for (const page of [matrix, panel]) {
    assert.match(page, /const listState = featureListView\(/u)
    assert.match(page, /listState === 'failed' \? \(\s*<StatusState error=/u)
    assert.match(page, /listState === 'empty' \? \(/u)
  }
  assert.match(read('use-feature-data.ts'), /throw pluginListReadError\(response\.status, .*response\.headers\.get\('retry-after'\)\)/u)
  // The matrix lists the project's root row on its own; with rows already read, a failed refresh is a compact note above them.
  assert.match(matrix, /hasRows: rows\.length > 0 \|\| Boolean\(root\)/u)
  for (const page of [matrix, panel]) assert.match(page, /listState === 'list' \? <StatusState compact error=\{[^}]+\} onRetry=\{[^}]+\} description=\{i18n\.t\('刷新失败，下面是上一次读取的内容。'\)\}/u)
})
