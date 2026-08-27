import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createNewWorkroomDraft,
  endpointRouteKey,
  parseEndpointRouteKey,
  validateWorkroomSponsors,
  validateWorkroomMessageRoutes,
} from '../console-ui/src/pages/workroom-catalog-model.mjs'

test('message projection route codec preserves a dedicated Endpoint and clears to inheritance', () => {
  const route = { adapter: 'discord', endpoint: 'operations' }
  assert.equal(endpointRouteKey(route), 'discord\0operations')
  assert.deepEqual(parseEndpointRouteKey('discord\0operations'), route)
  assert.equal(parseEndpointRouteKey(''), undefined)
})

test('message projection validation identifies stale and cross-Agent Endpoint bindings', () => {
  const members = [
    { agent: 'planner', messageRoute: { adapter: 'discord', endpoint: 'bot-a' } },
    { agent: 'reviewer', messageRoute: { adapter: 'discord', endpoint: 'bot-a' } },
    { agent: 'operator', messageRoute: { adapter: 'discord', endpoint: 'removed' } },
  ]
  const issues = validateWorkroomMessageRoutes(members, [
    { adapter: 'discord', name: 'bot-a' },
  ])

  assert.deepEqual(issues.map(({ memberIndex, code }) => ({ memberIndex, code })), [
    { memberIndex: 0, code: 'conflict' },
    { memberIndex: 1, code: 'conflict' },
    { memberIndex: 2, code: 'unknown' },
  ])
})

test('same Agent may reuse one projection Endpoint and pending inventory does not invent stale routes', () => {
  const members = [
    { agent: 'planner', messageRoute: { adapter: 'discord', endpoint: 'bot-a' } },
    { agent: 'planner', messageRoute: { adapter: 'discord', endpoint: 'bot-a' } },
  ]
  assert.deepEqual(validateWorkroomMessageRoutes(members, [], { validateKnownEndpoints: false }), [])
})

test('new Workroom explicitly binds the authenticated Console principal as Sponsor', () => {
  assert.deepEqual(createNewWorkroomDraft({
    projectId: 'workroom-1',
    agent: 'orchestrator',
    principalId: 'workroom-admin',
  }), {
    projectId: 'workroom-1',
    name: 'New Workroom',
    enabled: false,
    members: [{ agent: 'orchestrator', role: 'orchestrator' }],
    sponsors: ['workroom-admin'],
  })
})

test('enabled Workroom cannot be published without a Sponsor principal', () => {
  assert.deepEqual(validateWorkroomSponsors([
    { projectId: 'ready', enabled: true, sponsors: ['workroom-admin'] },
    { projectId: 'disabled', enabled: false },
    { projectId: 'missing', enabled: true, sponsors: [] },
  ]), [{
    projectId: 'missing',
    message: '已启用的 Workroom missing 至少需要一个 Sponsor principal。',
  }])
})
