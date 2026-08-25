import assert from 'node:assert/strict'
import test from 'node:test'
import {
  endpointRouteKey,
  parseEndpointRouteKey,
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
