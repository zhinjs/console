import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isHeartbeatSchedule, scheduleAgentEditBlock, scheduleAgentErrorMessage, scheduleAgentNames, scheduleAgentOptions,
  scheduleAgentParam, scheduleAgentValue, scheduleAgentView, scheduleRpcErrorCode,
} from '../console-ui/src/pages/schedule-agent-model.mjs'

// #1250 b52 `schedule-agent-no-creation-path`.
test('Agent names: null without a Host list, trimmed and deduplicated otherwise', () => {
  assert.equal(scheduleAgentNames(undefined), null)
  assert.equal(scheduleAgentNames('zhin'), null)
  assert.deepEqual(scheduleAgentNames([' zhin ', 'writer', 'writer', '', 3]), ['zhin', 'writer'])
})

test('options start with the default, never repeat zhin, and keep a missing current Agent visible but disabled', () => {
  assert.equal(scheduleAgentOptions(undefined), null)
  assert.deepEqual(scheduleAgentOptions(['zhin', 'writer']), [{ value: '', label: 'zhin（默认）' }, { value: 'writer', label: 'writer' }])
  assert.deepEqual(scheduleAgentOptions(['zhin'], 'en', 'gone'), [{ value: '', label: 'zhin (default)' }, { value: 'gone', label: 'gone (missing)', disabled: true }])
  assert.deepEqual(scheduleAgentOptions([], 'zh-CN', 'zhin'), [{ value: '', label: 'zhin（默认）' }])
})

test('dropdown value and RPC param map the default to empty / null', () => {
  assert.equal(scheduleAgentValue({}), ''); assert.equal(scheduleAgentValue({ agent: 'zhin' }), ''); assert.equal(scheduleAgentValue({ agent: 'writer' }), 'writer')
  assert.equal(scheduleAgentParam(''), null); assert.equal(scheduleAgentParam('zhin'), null); assert.equal(scheduleAgentParam(' writer '), 'writer')
})

test('view labels the default and flags a missing Agent only when one is named', () => {
  assert.deepEqual(scheduleAgentView({}), { name: 'zhin', isDefault: true, missing: false, label: 'zhin（默认）' })
  assert.deepEqual(scheduleAgentView({ agentMissing: true }), { name: 'zhin', isDefault: true, missing: false, label: 'zhin（默认）' })
  assert.deepEqual(scheduleAgentView({ agent: 'zhin' }), { name: 'zhin', isDefault: true, missing: false, label: 'zhin（默认）' })
  assert.deepEqual(scheduleAgentView({ agent: 'gone', agentMissing: true }, 'en'), { name: 'gone', isDefault: false, missing: true, label: 'gone' })
})

test('heartbeat tasks and Profile routines cannot change their Agent here', () => {
  assert.equal(isHeartbeatSchedule({ id: 'assistant-profile-heartbeat' }), true)
  assert.equal(isHeartbeatSchedule({ id: 'x', action: { kind: 'heartbeat' } }), true)
  assert.equal(isHeartbeatSchedule({ id: 'x', kind: 'user-task' }), false)
  assert.equal(scheduleAgentEditBlock({ id: 'assistant-profile-heartbeat', source: 'profile' }).code, 'heartbeat')
  assert.match(scheduleAgentEditBlock({ id: 'r', source: 'profile' }, 'en').reason, /assistant\.profile\.yml/)
  assert.equal(scheduleAgentEditBlock({ id: 'r', source: 'manual' }), null)
})

test('refusals are reworded by data.code, in both languages', () => {
  const refused = (code, message) => Object.assign(new Error(message), { details: { dataCode: code } })
  assert.equal(scheduleRpcErrorCode(refused('schedule_target_forbidden', '')), 'schedule_target_forbidden')
  assert.equal(scheduleRpcErrorCode(new Error('x')), null)
  assert.equal(scheduleAgentErrorMessage(refused('schedule_target_forbidden', '没有向该账号投递的权限：需要 qq / bot 上的 endpoint.operate'), 'en'),
    'You cannot send from the delivery account: this needs endpoint.operate on qq / bot. Ask an administrator to grant it on that account.')
  // No account named: the Host refused for another reason, and its own message is shown as is.
  assert.equal(scheduleAgentErrorMessage(refused('schedule_target_forbidden', '投递目标需要指明账号')), null)
  assert.match(scheduleAgentErrorMessage(refused('schedule_agent_profile', 'x'), 'en'), /Profile routine/)
  assert.match(scheduleAgentErrorMessage(refused('schedule_agent_heartbeat', 'x'), 'en'), /Heartbeat tasks/)
  assert.match(scheduleAgentErrorMessage(refused('unsupported', 'x')), /升级 zhin\.js/)
  assert.equal(scheduleAgentErrorMessage(new Error('Agent 不存在：w。可用的 Agent：zhin、a'), 'en'), 'Agent “w” does not exist. Available Agents: zhin, a. Refresh and choose again.')
  assert.equal(scheduleAgentErrorMessage(refused('schedule_agent_not_found', '?')), '所选 Agent 不存在。请刷新后重新选择。')
  assert.equal(scheduleAgentErrorMessage(new Error('其它')), null)
})
