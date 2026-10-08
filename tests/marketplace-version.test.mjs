import assert from 'node:assert/strict'
import test from 'node:test'
import { applyRegistryVersion, belongsToZhinScope } from '../console-ui/src/pages/marketplace-version.mjs'

test('registry latest may be numerically lower than stale index and survives index refresh', () => {
  const indexed = { name: '@zhin.js/adapter-telegram', version: '8.0.8', date: '2026-08-27' }
  const detail = { name: indexed.name, version: '1.1.4', lastPublish: '2026-09-23' }
  assert.deepEqual(applyRegistryVersion(indexed, detail), { ...indexed, version: '1.1.4', date: '2026-09-23', versionSource: 'registry' })
  assert.equal(applyRegistryVersion(indexed).versionSource, 'index')
  assert.equal(applyRegistryVersion(indexed, { ...detail, name: 'other' }).version, '8.0.8')
})

test('namespace membership does not accept lookalike or extra-path package names', () => {
  assert.equal(belongsToZhinScope('@zhin.js/adapter-telegram'), true)
  for (const name of ['@zhin.js.evil/plugin', '@other/zhin.js', '@zhin.js/', '@zhin.js/plugin/extra']) assert.equal(belongsToZhinScope(name), false)
})
