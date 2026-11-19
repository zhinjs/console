import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isHeartbeatSchedule, scheduleAgentEditBlock, scheduleAgentErrorMessage, scheduleAgentNames, scheduleAgentOptions,
  scheduleAgentMissing, scheduleAgentNotFound, scheduleAgentParam, scheduleAgentValue, scheduleAgentView, scheduleResumeErrorMessage, scheduleRpcErrorCode,
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
  assert.equal(scheduleAgentErrorMessage(new Error('Agent 不存在：w。可用的 Agent：zhin、a'), 'en'), 'Agent “w” does not exist. Available Agents: zhin, a. Choose one of them instead.')
  assert.equal(scheduleAgentErrorMessage(refused('schedule_agent_not_found', '?')), '所选 Agent 不存在。请刷新后重新选择。')
  assert.equal(scheduleAgentErrorMessage(new Error('其它')), null)
})

// #1250 b61: the b55 refusal shapes (`data.agent` / `data.available`, `schedule_target_forbidden` on resume).
test('schedule_agent_not_found reads data.agent / data.available, else the Host message', () => {
  const notFound = (agent, available, message = '?') => Object.assign(new Error(message), { details: { dataCode: 'schedule_agent_not_found', dataAgent: agent, dataAvailable: available } })
  assert.deepEqual(scheduleAgentNotFound(notFound('w', ['zhin', 'a', 'a'])), { agent: 'w', available: ['zhin', 'a'] })
  assert.deepEqual(scheduleAgentNotFound(new Error('Agent 不存在：w。可用的 Agent：zhin、a')), { agent: 'w', available: ['zhin', 'a'] })
  assert.deepEqual(scheduleAgentNotFound(Object.assign(new Error('?'), { details: { dataCode: 'schedule_agent_not_found' } })), { agent: null, available: null })
  assert.equal(scheduleAgentNotFound(new Error('其它')), null)
  assert.equal(scheduleAgentErrorMessage(notFound('w', ['zhin', 'a'])), 'Agent「w」不存在。可用的 Agent：zhin、a，请从中改选。')
  assert.equal(scheduleAgentErrorMessage(notFound('w', []), 'en'), 'Agent “w” does not exist, and no Agents are configured. Add an Agent to the configuration first, then come back and choose it.')
  assert.equal(scheduleAgentErrorMessage(Object.assign(new Error('?'), { details: { dataCode: 'schedule_agent_not_found', dataAgent: 'w' } }), 'en'), 'Agent “w” does not exist. Refresh and choose again.')
})

test('a dropdown value is missing only when the Host runs Agents and does not run that one', () => {
  assert.equal(scheduleAgentMissing(['zhin', 'a'], 'b'), true)
  assert.equal(scheduleAgentMissing(['zhin', 'a'], 'a'), false)
  assert.equal(scheduleAgentMissing(['a'], ''), false, 'the default always exists')
  assert.equal(scheduleAgentMissing(['a'], 'zhin'), false)
  assert.equal(scheduleAgentMissing(null, 'b'), false, 'an older engine reports none')
  assert.deepEqual(scheduleAgentOptions(['zhin'], 'zh-CN', ['gone', 'gone', 'b', undefined]).map(option => option.value), ['', 'gone', 'b'])
})

test('a refused resume says the caller may not send to the delivery target, in both languages', () => {
  const refused = (details, message) => Object.assign(new Error(message), { details })
  const forbidden = '没有向该账号投递的权限：需要 qq / bot 上的 endpoint.operate'
  assert.equal(scheduleResumeErrorMessage(refused({ dataCode: 'schedule_target_forbidden' }, forbidden)),
    '你没有权限向这个任务的投递目标（qq / bot）发消息，无法恢复。请让管理员授予你该账号的 endpoint.operate 权限。')
  assert.equal(scheduleResumeErrorMessage(refused({ serverCode: 'schedule_target_forbidden' }, forbidden), 'en'),
    'You cannot resume this task: you do not have permission to send messages to its delivery target (qq / bot). Ask an administrator to grant you endpoint.operate on that account.')
  assert.equal(scheduleResumeErrorMessage(refused({ dataCode: 'schedule_target_forbidden' }, '投递目标需要指明账号'), 'en'),
    'You cannot resume this task: you do not have permission to send messages to its delivery target. Ask an administrator to grant you endpoint.operate on the delivery account.')
  assert.match(scheduleResumeErrorMessage(new Error(forbidden)), /无法恢复/, 'an uncaptured reply is matched by its message')
  assert.equal(scheduleResumeErrorMessage(new Error('任务不存在: x')), null)
})
