import test from 'node:test'
import assert from 'node:assert/strict'
import { endpointLifecycleLabel } from '../console-ui/src/pages/endpoint-presentation.mjs'

test('account presentation distinguishes connection loss from an explicit stop', () => {
  assert.equal(endpointLifecycleLabel({ status: 'offline', transportState: 'closed' }), '离线')
  assert.equal(endpointLifecycleLabel({ status: 'offline' }), '离线')
  assert.equal(endpointLifecycleLabel({ status: 'offline', transportState: 'stopped' }), '已停止')
  assert.equal(endpointLifecycleLabel({ status: 'offline', transportState: 'connecting' }), '连接中')
  assert.equal(endpointLifecycleLabel({ status: 'offline', transportState: 'reconnecting' }), '重连中')
  assert.equal(endpointLifecycleLabel({ status: 'online' }), '运行中')
  assert.equal(endpointLifecycleLabel({ status: 'offline', pendingLogin: true }), '等待登录')
})
