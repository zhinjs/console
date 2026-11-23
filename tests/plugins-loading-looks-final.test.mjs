import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { pluginInventory, inventoryCounts, pluginsFirstReadPending } from '../console-ui/src/pages/plugin-list-model.mjs'

// #64 `plugins-loading-looks-final`: when the gateway's package list answered before the instance's
// plugin list, the page drew 「已安装 62 / 运行正常 0 / 需要处理 0」 with every row 「实例未报告」 and no
// loading sign, so for a few seconds it said no plugin was running.
test('the page keeps its loading state until the instance list arrives or fails, whatever the packages do', () => {
  assert.equal(pluginsFirstReadPending({ loaded: false, error: null }), true, 'packages ready, instance still reading')
  assert.equal(pluginsFirstReadPending({ loaded: true, error: null }), false)
  assert.equal(pluginsFirstReadPending({ loaded: false, error: new Error('down') }), false, 'instance down: show the gateway packages')
  assert.equal(pluginsFirstReadPending({ loaded: true, error: new Error('refresh failed') }), false, 'a failed refresh keeps the last list')
})

test('what used to be drawn in that gap: every package unreported and nothing healthy', () => {
  const rows = pluginInventory(null, { packages: [{ name: '@zhin.js/plugin-a', installedVersion: '1.0.0' }, { name: '@zhin.js/plugin-b', installedVersion: '1.0.0' }] })
  assert.deepEqual(rows.map(row => row.health), ['unreported', 'unreported'])
  const counts = inventoryCounts(rows)
  assert.equal(counts.all, 2)
  assert.equal(counts.healthy, 0)
})

test('the plugins page uses it instead of waiting on both reads', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/plugins.tsx', import.meta.url), 'utf8')
  assert.match(source, /const waiting = pluginsFirstReadPending\(\{ loaded, error \}\)/)
  assert.doesNotMatch(source, /\(loading && !loaded\) && packages\.status === 'loading'/)
})
