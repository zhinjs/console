import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as protocol from '@zhin.js/console-protocol'
import { CONSOLE_AUTH_ROUTES, ONBOARDING_RPC } from '../console-ui/src/utils/console-auth-model.mjs'
import { CONSOLE_PERMISSION_LIST, IAM_RPC, SCOPED_PERMISSIONS, BUILTIN_ROLE_NAMES } from '../console-ui/src/pages/access/access-model.mjs'
import { GATEWAY_PACKAGES_PROGRESS, GATEWAY_RPC } from '../console-ui/src/pages/ops/gateway-model.mjs'
import { CHAT_ROLES, CHAT_ROLES_PERMISSION, CHAT_ROLES_RPC } from '../console-ui/src/scope/chat-roles-model.mjs'
import { GATEWAY_OWNED_RPC_TYPES } from '../console-ui/src/utils/instance-availability.mjs'
import { CHAT_PRINCIPALS_RPC } from '../console-ui/src/scope/chat-identity-model.mjs'
import { ATTENTION_RPC } from '../console-ui/src/pages/attention/attention-model.mjs'
import { LOGIN_FLOW_EVENT, LOGIN_RPC, LOGIN_UNSUPPORTED_CODE } from '../console-ui/src/pages/scope/login-flow-model.mjs'
import { GLOBAL_PLUGIN_SWITCH_PERMISSION, isGlobalFeatureSwitch } from '../console-ui/src/pages/features/plugin-switch-model.mjs'
import { sourceFilesUnder } from './cjk-fixture.mjs'

test('models re-export @zhin.js/console-protocol instead of keeping their own copies', () => {
  assert.equal(CONSOLE_AUTH_ROUTES, protocol.CONSOLE_AUTH_ROUTES)
  assert.equal(ONBOARDING_RPC, protocol.ONBOARDING_RPC)
  assert.equal(IAM_RPC, protocol.IAM_RPC)
  assert.deepEqual([...SCOPED_PERMISSIONS].sort(), [...protocol.CONSOLE_SCOPED_PERMISSIONS].sort())
  assert.equal(BUILTIN_ROLE_NAMES, protocol.CONSOLE_BUILTIN_ROLE_NAMES)
  assert.deepEqual([...CONSOLE_PERMISSION_LIST].sort(), [...protocol.CONSOLE_PERMISSION_LIST].sort(), 'the checklist areas cover the catalog exactly')
  assert.deepEqual(Object.values(GATEWAY_RPC).sort(), Object.values(protocol.GATEWAY_RPC).sort())
  assert.equal(GATEWAY_PACKAGES_PROGRESS, protocol.GATEWAY_PACKAGES_PROGRESS)
  assert.equal(CHAT_ROLES_RPC, protocol.CHAT_ROLES_RPC)
  assert.equal(CHAT_ROLES, protocol.CONSOLE_CHAT_ROLES)
  assert.equal(CHAT_ROLES_PERMISSION, 'iam.manage')
  // zhin 1.4 (console-protocol 1.4): chat members, attention, Login Assist and the global plugin switch.
  assert.equal(CHAT_PRINCIPALS_RPC, protocol.CHAT_PRINCIPALS_RPC)
  assert.equal(ATTENTION_RPC, protocol.ATTENTION_RPC.LIST)
  assert.equal(LOGIN_RPC, protocol.LOGIN_RPC)
  assert.equal(LOGIN_FLOW_EVENT, protocol.SIDE_EVENT_PUSH.LOGIN_FLOW)
  assert.equal(LOGIN_UNSUPPORTED_CODE, protocol.CONSOLE_LOGIN_UNSUPPORTED)
  assert.equal(GLOBAL_PLUGIN_SWITCH_PERMISSION, protocol.FEATURE_GLOBAL_SWITCH_PERMISSION)
  assert.equal(isGlobalFeatureSwitch, protocol.isGlobalFeatureSwitch)
  for (const type of ['terminal.open', 'onboarding.update', ...Object.values(protocol.IAM_RPC)]) {
    assert.ok(GATEWAY_OWNED_RPC_TYPES.includes(type), type)
  }
  const contracts = ['contracts/gateway.ts', 'contracts/zhin-console.ts', 'utils/console-auth-model.mjs']
  for (const file of contracts) {
    assert.match(readFileSync(new URL(`../console-ui/src/${file}`, import.meta.url), 'utf8'), /from '@zhin\.js\/console-protocol'/u, file)
  }
})

/**
 * Files that still spell a protocol RPC name inline. Each entry needs a reason; move the file to the
 * package import when it is next edited.
 */
const INLINE_ALLOWED = new Map([
  // Request builders (`type: 'feature.set-override'`) owned by the features pages; values are
  // still checked against the protocol below.
  ['pages/features/feature-model.mjs', 'feature.* request builders'],
])

test('no other source file spells a protocol RPC name or auth route', () => {
  const names = new Set([
    ...Object.values(protocol.IAM_RPC), ...Object.values(protocol.GATEWAY_RPC), ...Object.values(protocol.FEATURE_RPC),
    ...Object.values(protocol.CHAT_ROLES_RPC), ...Object.values(protocol.ONBOARDING_RPC), ...Object.values(protocol.CONSOLE_AUTH_ROUTES),
    ...Object.values(protocol.CHAT_PRINCIPALS_RPC), ...Object.values(protocol.ATTENTION_RPC), ...Object.values(protocol.LOGIN_RPC),
  ])
  const root = fileURLToPath(new URL('../console-ui/src/', import.meta.url))
  const offenders = []
  for (const file of sourceFilesUnder(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/')
    if (relative.endsWith('.d.mts')) continue
    const text = readFileSync(file, 'utf8')
    for (const name of names) {
      if (!text.includes(`'${name}'`) && !text.includes(`"${name}"`)) continue
      if (INLINE_ALLOWED.has(relative)) {
        assert.ok(Object.values(protocol.FEATURE_RPC).includes(name), `${relative} may only inline feature.* names (${name})`)
        continue
      }
      offenders.push(`${relative}: ${name}`)
    }
  }
  assert.deepEqual(offenders, [], "import these from '@zhin.js/console-protocol'")
})
