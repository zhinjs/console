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
