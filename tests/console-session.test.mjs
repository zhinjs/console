import test from 'node:test'
import assert from 'node:assert/strict'
import {
  currentOnboarding, getConsoleSession, resetConsoleSession, setConsoleMe, setHostOnboarding, setLegacySession, setLocalOnboarding,
  subscribeConsoleSession,
} from '../console-ui/src/utils/console-session.mjs'
import { getConsoleAccess, hasConsolePermission } from '../console-ui/src/utils/console-access.mjs'
import { buildNavigation } from '../console-ui/src/navigation-sections.mjs'

const routes = [
  { path: '/dashboard', meta: { group: '概览' } },
  { path: '/ops/config', meta: { group: '运维' } },
  { path: '/plugins', meta: { group: '插件' } },
]
const sections = access => buildNavigation(routes, access).flatMap(tier => tier.sections.map(section => section.id))

test('/auth/me permissions feed navigation; an open Host and an old Host stay unrestricted', () => {
  let changes = 0
  const off = subscribeConsoleSession(() => { changes++ })
  try {
    setConsoleMe({ kind: 'user', user: { id: 'u', username: 'v', displayName: 'V' }, permissions: ['status.view'], bindings: [], setupRequired: false })
    assert.equal(getConsoleAccess().unrestricted, false)
    assert.equal(hasConsolePermission('ops.config.read'), false)
    assert.deepEqual(sections(getConsoleAccess()), ['overview'], 'a viewer without ops/plugin permissions sees only 概览')

    setConsoleMe({ kind: 'bootstrap', open: true, permissions: [], bindings: [], setupRequired: true })
    assert.equal(getConsoleAccess().unrestricted, true)

    setLegacySession()
    assert.equal(getConsoleSession().legacy, true)
    assert.equal(getConsoleAccess().unrestricted, true)
    assert.ok(changes >= 3)
  } finally { off(); resetConsoleSession() }
  assert.equal(getConsoleSession().me, null)
  assert.equal(getConsoleAccess().unrestricted, true)
})

test('the Host onboarding state wins over the browser copy and survives a later /auth/me without it', () => {
  try {
    setLocalOnboarding({ version: 1, steps: { ai: 'pending', adapters: 'pending' } })
    assert.deepEqual(currentOnboarding().steps, { ai: 'pending', adapters: 'pending' })
    setHostOnboarding({ version: 1, steps: { ai: 'done' }, completedAt: 5 })
    assert.equal(currentOnboarding().completedAt, 5)
    setConsoleMe({ kind: 'user', permissions: [], bindings: [], setupRequired: false })
    assert.equal(currentOnboarding().completedAt, 5)
  } finally { resetConsoleSession() }
  assert.equal(currentOnboarding(), null)
})

test('adapter / account-scoped bindings count at the objects they cover, never globally', async () => {
  const { createConsoleAccess, ANY_TARGET, scopePermissionTarget } = await import('../console-ui/src/utils/console-access.mjs')
  const { scopeTabAllowed } = await import('../console-ui/src/scope/scope-tree.mjs')
  // `/auth/me` of an operator bound to adapter qq and to the account icqq/bot: `permissions` is global only.
  const access = createConsoleAccess({
    permissions: ['status.view'],
    bindings: [
      { role: 'qq-admin', scope: { kind: 'adapter', key: 'qq' }, permissions: ['iam.manage', 'feature.toggle', 'endpoint.view', 'ops.restart'] },
      { role: 'bot-op', scope: { kind: 'endpoint', key: 'icqq/bot' }, permissions: ['endpoint.operate'] },
      { role: 'viewer', scope: { kind: 'global' }, permissions: ['status.view'] },
    ],
  })
  const qq = scopePermissionTarget({ level: 'adapter', adapter: 'qq' })
  const qqAccount = scopePermissionTarget({ level: 'endpoint', adapter: 'qq', endpoint: '1' })
  const bot = scopePermissionTarget({ level: 'conversation', adapter: 'icqq', endpoint: 'bot', kind: 'group', id: '9' })
  assert.deepEqual(bot, { kind: 'endpoint', adapter: 'icqq', endpoint: 'bot' }, 'a conversation counts as its account')
  assert.equal(hasConsolePermission('iam.manage', access, qq), true)
  assert.equal(hasConsolePermission('feature.toggle', access, qqAccount), true, 'an adapter binding covers its accounts')
  assert.equal(hasConsolePermission('iam.manage', access), false, 'not at the global level')
  assert.equal(hasConsolePermission('iam.manage', access, scopePermissionTarget({ level: 'adapter', adapter: 'icqq' })), false, 'not at another adapter')
  assert.equal(hasConsolePermission('endpoint.operate', access, bot), true)
  assert.equal(hasConsolePermission('endpoint.operate', access, scopePermissionTarget({ level: 'adapter', adapter: 'icqq' })), false, 'an account binding does not cover its adapter')
  assert.equal(hasConsolePermission('ops.restart', access, qq), false, 'permissions a binding cannot narrow never count scoped')
  assert.equal(hasConsolePermission('endpoint.view', access, ANY_TARGET), true, 'list reads answer at any scope')
  // Object page tabs: 角色 at adapter qq opens, at the global page it stays locked.
  assert.equal(scopeTabAllowed('roles', { level: 'adapter', adapter: 'qq' }, access), true)
  assert.equal(scopeTabAllowed('roles', { level: 'global' }, access), false)
  assert.equal(scopeTabAllowed('chat', { level: 'endpoint', adapter: 'icqq', endpoint: 'bot' }, access), true)
  assert.equal(scopeTabAllowed('overview', { level: 'global' }, access), true, '概览 lists what endpoint.list answers')
  assert.equal(scopeTabAllowed('features', { level: 'adapter', adapter: 'qq' }, access), false, 'feature.view is never scoped')
  // The session store passes the bindings of /auth/me through.
  setConsoleMe({ kind: 'user', user: { id: 'u', username: 'u', displayName: 'u' }, permissions: [], bindings: [{ role: 'r', scope: { kind: 'adapter', key: 'qq' }, permissions: ['iam.manage'] }], setupRequired: false })
  assert.equal(hasConsolePermission('iam.manage', getConsoleAccess(), qq), true)
  resetConsoleSession()
})
