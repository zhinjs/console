import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as mirror from '../console-ui/src/contracts/console-protocol-mirror.mjs'
import { CONSOLE_AUTH_ROUTES, ONBOARDING_RPC } from '../console-ui/src/utils/console-auth-model.mjs'
import { CONSOLE_PERMISSION_LIST, IAM_RPC, SCOPED_PERMISSIONS, BUILTIN_ROLE_NAMES } from '../console-ui/src/pages/access/access-model.mjs'
import { GATEWAY_PACKAGES_PROGRESS, GATEWAY_RPC } from '../console-ui/src/pages/ops/gateway-model.mjs'
import { CHAT_ROLES, CHAT_ROLES_PERMISSION, CHAT_ROLES_RPC } from '../console-ui/src/scope/chat-roles-model.mjs'
import { sourceFilesUnder } from './cjk-fixture.mjs'
import { compareMirror, defaultProtocolSources, loadProtocolSource } from '../scripts/check-protocol-mirror.mjs'

const MIRROR_FILE = 'contracts/console-protocol-mirror.mjs'

test('models re-export the protocol mirror instead of keeping their own copies', () => {
  assert.equal(CONSOLE_AUTH_ROUTES, mirror.CONSOLE_AUTH_ROUTES)
  assert.equal(ONBOARDING_RPC, mirror.ONBOARDING_RPC)
  assert.equal(IAM_RPC, mirror.IAM_RPC)
  assert.equal(SCOPED_PERMISSIONS, mirror.CONSOLE_SCOPED_PERMISSIONS)
  assert.equal(BUILTIN_ROLE_NAMES, mirror.CONSOLE_BUILTIN_ROLE_NAMES)
  assert.deepEqual([...CONSOLE_PERMISSION_LIST].sort(), [...mirror.CONSOLE_PERMISSION_LIST].sort(), 'the checklist areas cover the catalog exactly')
  assert.deepEqual(Object.values(GATEWAY_RPC).sort(), Object.values(mirror.GATEWAY_RPC).sort())
  assert.equal(GATEWAY_PACKAGES_PROGRESS, mirror.GATEWAY_PACKAGES_PROGRESS)
  assert.equal(CHAT_ROLES_RPC, mirror.CHAT_ROLES_RPC)
  assert.equal(CHAT_ROLES, mirror.CONSOLE_CHAT_ROLES)
  assert.equal(CHAT_ROLES_PERMISSION, 'iam.manage')
  const contracts = ['contracts/gateway.ts', 'contracts/zhin-console.ts', 'utils/console-auth-model.mjs']
  for (const file of contracts) {
    assert.match(readFileSync(new URL(`../console-ui/src/${file}`, import.meta.url), 'utf8'), /console-protocol-mirror\.mjs/u, file)
  }
  assert.doesNotMatch(readFileSync(new URL('../console-ui/src/contracts/gateway.ts', import.meta.url), 'utf8'), /TODO\(gateway-protocol\)/u)
})

/**
 * Files that still spell a mirrored RPC name inline. Each entry needs a reason; move the file to the
 * mirror import when it is next edited.
 */
const INLINE_ALLOWED = new Map([
  // Request builders (`type: 'feature.set-override'`) owned by the features pages; values are
  // still checked against the mirror below.
  ['pages/features/feature-model.mjs', 'feature.* request builders'],
])

test('no other source file spells a mirrored RPC name or auth route', () => {
  const names = new Set([
    ...Object.values(mirror.IAM_RPC), ...Object.values(mirror.GATEWAY_RPC), ...Object.values(mirror.FEATURE_RPC),
    ...Object.values(mirror.CHAT_ROLES_RPC), ...Object.values(mirror.ONBOARDING_RPC), ...Object.values(mirror.CONSOLE_AUTH_ROUTES),
  ])
  const root = fileURLToPath(new URL('../console-ui/src/', import.meta.url))
  const offenders = []
  for (const file of sourceFilesUnder(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/')
    if (relative === MIRROR_FILE || relative.endsWith('.d.mts')) continue
    const text = readFileSync(file, 'utf8')
    for (const name of names) {
      if (!text.includes(`'${name}'`) && !text.includes(`"${name}"`)) continue
      if (INLINE_ALLOWED.has(relative)) {
        assert.ok(Object.values(mirror.FEATURE_RPC).includes(name), `${relative} may only inline feature.* names (${name})`)
        continue
      }
      offenders.push(`${relative}: ${name}`)
    }
  }
  assert.deepEqual(offenders, [], 'import these from contracts/console-protocol-mirror.mjs')
})

test('the comparison reports mismatches, missing names and pending names', () => {
  const upstream = {}
  for (const name of Object.keys(mirror.MIRROR_COMPARISON)) {
    const rule = mirror.MIRROR_COMPARISON[name]
    upstream[typeof rule === 'string' ? name : rule.upstream] = mirror[name]
  }
  upstream.CONSOLE_RPC_PERMISSIONS = { ...mirror.CONSOLE_GATEWAY_OWNED_RPC_PERMISSIONS, 'ping': 'status.view' }
  upstream.CONSOLE_SCOPED_PERMISSIONS = new Set([...mirror.CONSOLE_SCOPED_PERMISSIONS].reverse())
  assert.ok(compareMirror(upstream).every(result => result.status === 'ok'))
  const drifted = { ...upstream, IAM_RPC: { ...mirror.IAM_RPC, USERS_UPDATE: 'iam.users.patch' } }
  delete drifted.GATEWAY_HEALTH_PATH
  delete drifted.FEATURE_RPC
  const results = new Map(compareMirror(drifted).map(result => [result.name, result.status]))
  assert.equal(results.get('IAM_RPC'), 'mismatch')
  assert.equal(results.get('GATEWAY_HEALTH_PATH'), 'pending')
  assert.equal(results.get('FEATURE_RPC'), 'missing')
})

const sources = defaultProtocolSources()

test('the mirror matches the @zhin.js/console-protocol source', { skip: sources.length ? false : 'no zhinjs/zhin checkout next to this repository (set ZHIN_PROTOCOL_SRC)' }, async () => {
  for (const dir of sources) {
    const results = compareMirror(await loadProtocolSource(dir))
    const failed = results.filter(result => result.status !== 'ok' && result.status !== 'pending')
    assert.deepEqual(failed, [], dir)
  }
})
