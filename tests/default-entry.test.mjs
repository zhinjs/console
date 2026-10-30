import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConsoleEntry } from '../console-ui/src/bootstrap/default-entry.mjs'
import { createHostRegistration } from '../console-ui/src/bootstrap/host-registration.mjs'

test('hosts without Sandbox keep the management home, including failed or empty entry loads', () => {
  assert.equal(resolveConsoleEntry([]), '/dashboard')
  assert.equal(resolveConsoleEntry([{ path: '/dashboard' }, { path: '/agent/sessions' }]), '/dashboard')
  assert.equal(resolveConsoleEntry([{ path: '/sandbox/settings' }]), '/dashboard')
})

test('a registered Sandbox becomes the entry without replacing explicit management routes', () => {
  const routes = [{ path: '/dashboard' }, { path: '/sandbox', requiredPermissions: ['existing-permission'] }]
  assert.equal(resolveConsoleEntry(routes), '/sandbox')
  assert.deepEqual(routes[1].requiredPermissions, ['existing-permission'])
  assert.equal(routes[0].path, '/dashboard')
})

test('entry follows the active Host registration and ignores pages arriving from an old Host', () => {
  let routes = [{ path: '/dashboard' }]
  const registration = createHostRegistration({
    readRoutes: () => routes,
    addRoute: route => { routes = [...routes.filter(item => item.path !== route.path), route] },
    removeRoute: path => { routes = routes.filter(item => item.path !== path) },
    addTool: () => 'unused',
  })
  const oldHost = registration.capture()
  assert.equal(resolveConsoleEntry(routes), '/dashboard')
  oldHost.addRoute({ path: '/sandbox' })
  assert.equal(resolveConsoleEntry(routes), '/sandbox')

  registration.reset()
  assert.equal(resolveConsoleEntry(routes), '/dashboard')
  oldHost.addRoute({ path: '/sandbox' })
  assert.equal(resolveConsoleEntry(routes), '/dashboard')
  registration.capture().addRoute({ path: '/sandbox' })
  assert.equal(resolveConsoleEntry(routes), '/sandbox')
})
