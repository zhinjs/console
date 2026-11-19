import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  GATEWAY_RPC, GATEWAY_VERSION_CHECK_RPC, GatewayRequestError, VERSION_MIGRATE_COMMAND, migrateDocsHref, readGatewayReply, readVersionReport,
  reportedVersion, versionCheckUnsupported, versionNotice, versionPackageLabel, versionRows, versionStateLabel, versionStateTone,
} from '../console-ui/src/pages/ops/gateway-model.mjs'
import { INSTANCE_SECTION_IDS, instanceSectionHref } from '../console-ui/src/pages/ops/instance-sections.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

const zh = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

const row = (name, fields = {}) => ({
  name, range: '^1.0.0', installed: '1.0.0', latest: '1.0.0', wanted: '1.0.0', latestInRange: true, updateAvailable: false, needsMigrate: false, ...fields,
})

const REPORT = {
  gateway: '1.6.1',
  checkedAt: 1_700_000_000_000,
  registryReachable: true,
  packages: [
    row('@zhin.js/adapter-sandbox', { latest: '1.0.3', wanted: '1.0.3', updateAvailable: true }),
    row('zhin.js', { range: '^1.6.0', installed: '1.6.0', latest: '2.0.0', wanted: '1.7.2', latestInRange: false, updateAvailable: true, needsMigrate: true }),
    row('@zhin.js/console-ui', { range: '^1.2.0', installed: '1.2.0', latest: '1.2.0', wanted: '1.2.0' }),
    row('@zhin.js/gateway', { range: null, installed: '1.6.1', latest: '1.7.0', wanted: null, latestInRange: false, needsMigrate: true }),
  ],
}

test('the version check is its own RPC, outside the published protocol map', () => {
  assert.equal(GATEWAY_VERSION_CHECK_RPC, 'gateway.version.check')
  assert.ok(!Object.values(GATEWAY_RPC).includes(GATEWAY_VERSION_CHECK_RPC))
  assert.equal(VERSION_MIGRATE_COMMAND, 'npx zhin migrate --dry-run')
  assert.equal(migrateDocsHref('en'), 'https://zhin.js.org/en/cli/#migrate')
  assert.equal(migrateDocsHref('zh-CN'), 'https://zhin.js.org/cli/#migrate')
  assert.equal(INSTANCE_SECTION_IDS.versions, 'instance-versions')
  assert.equal(instanceSectionHref('versions'), '/ops/instance#instance-versions')
})

test('readVersionReport is defensive', () => {
  assert.equal(readVersionReport(null), null)
  assert.equal(readVersionReport({ packages: 'x' }), null)
  const report = readVersionReport({
    gateway: 'not a version', checkedAt: 'soon',
    packages: [{ name: 'zhin.js', range: '^1', installed: '1.0.0', latest: '<script>', updateAvailable: 'yes', needsMigrate: true }, { range: '^1' }, null],
  })
  assert.deepEqual(report, {
    gateway: null, checkedAt: 0, registryReachable: true,
    packages: [{ name: 'zhin.js', range: '^1', installed: '1.0.0', latest: null, wanted: null, latestInRange: false, updateAvailable: false, needsMigrate: true }],
  })
  assert.equal(readVersionReport({ packages: [], registryReachable: false }).registryReachable, false)
})

test('rows: Zhin, gateway, Console, then plugins; migrate wins over update', () => {
  const rows = versionRows(readVersionReport(REPORT), zh)
  assert.deepEqual(rows.map(item => [item.label, item.state]), [
    ['Zhin', 'migrate'], ['网关', 'migrate'], ['Console ui', 'current'], ['adapter-sandbox', 'update'],
  ])
  const zhin = rows[0]
  assert.equal(zhin.update, true, 'an in-range update still applies next to the migrate hint')
  assert.equal(zhin.wanted, '1.7.2')
  const gateway = rows[1]
  assert.equal(gateway.update, false, 'the gateway is not a direct dependency: no dependency 更新')
  assert.equal(gateway.dependency, false)
  assert.equal(rows[2].wanted, null)
  assert.equal(versionPackageLabel('@zhin.js/gateway', en), 'Gateway')
  assert.deepEqual(versionRows(null, zh), [])
})

test('an unreachable registry reads as unknown, never as newer', () => {
  const offline = readVersionReport({
    ...REPORT, registryReachable: false,
    packages: REPORT.packages.map(item => ({ ...item, latest: null, wanted: null, updateAvailable: false, needsMigrate: false, latestInRange: false })),
  })
  assert.ok(versionRows(offline, zh).every(item => item.state === 'unknown'))
  assert.deepEqual(versionNotice(offline), { kind: 'none', count: 0 })
  assert.equal(versionStateLabel('unknown', zh), '无法检查')
  assert.equal(versionStateLabel('unknown', en), 'Cannot check')
})

test('notice counts packages with a newer release', () => {
  assert.deepEqual(versionNotice(readVersionReport(REPORT)), { kind: 'migrate', count: 3 })
  const inRange = readVersionReport({ ...REPORT, packages: [REPORT.packages[0], REPORT.packages[2]] })
  assert.deepEqual(versionNotice(inRange), { kind: 'update', count: 1 })
  assert.deepEqual(versionNotice(null), { kind: 'none', count: 0 })
  assert.equal(reportedVersion(readVersionReport(REPORT), 'zhin.js'), '1.6.0')
  assert.equal(reportedVersion(readVersionReport({ gateway: '1.6.1', packages: [] }), '@zhin.js/gateway'), '1.6.1')
  assert.equal(versionStateTone('migrate'), 'warning')
  assert.equal(versionStateTone('current'), 'outline')
})

test('a Host without the check is not an error', () => {
  for (const body of [
    { success: false, error: 'Unknown RPC type: gateway.version.check' },
    { ok: false, error: { code: 'unmapped', message: 'RPC "gateway.version.check" 未登记权限', status: 403 } },
    { ok: false, error: { code: 'unknown_rpc', message: 'RPC "gateway.version.check" 不存在', status: 404 } },
  ]) {
    assert.throws(() => readGatewayReply(400, body, zh), error => versionCheckUnsupported(error))
  }
  assert.equal(versionCheckUnsupported(new GatewayRequestError('x', { status: 500, code: 'internal' })), false)
  assert.equal(versionCheckUnsupported(new Error('x')), false)
  assert.equal(versionCheckUnsupported(null), false)
})

test('the Console never upgrades the framework: only the command, no migrate RPC', () => {
  const panel = read('pages/ops/version-panel.tsx')
  assert.match(panel, /VERSION_MIGRATE_COMMAND/u)
  assert.doesNotMatch(panel, /gatewayRequest\(|PACKAGES_UPDATE|PACKAGES_INSTALL/u)
  assert.match(read('pages/ops/instance.tsx'), /<VersionSection /u)
  assert.match(read('pages/dashboard.tsx'), /<VersionHintRow /u)
})

test('version strings have English', () => {
  for (const message of [
    '需要迁移', '可更新', '已是最新', '无法检查', '范围内可更新到 {0}', '检查于 {0}', '前往项目依赖', 'Zhin 版本', '{0} 个包有新版本',
    '无法检查新版本：网关连不上 npm registry（离线或超时）。下面只显示当前版本。', '有新的大版本或需要调整版本范围', 'zhin migrate 文档',
  ]) {
    assert.doesNotMatch(en(message, ['1']), /[㐀-鿿]/u, message)
  }
})
