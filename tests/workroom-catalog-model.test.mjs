import assert from 'node:assert/strict'
import test from 'node:test'
import {
  catalogAvailability,
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
    message: '已启用的项目至少需要一位负责人',
  }])
})

test('unloaded and failed catalogs cannot be edited or published and never claim synchronization', () => {
  for (const state of [
    { hasCatalog: false, loading: true },
    { hasCatalog: false, loading: false, error: 'Runtime unavailable', dirty: true },
    { hasCatalog: true, loading: false, error: 'refresh failed', dirty: true },
    { hasCatalog: true, loading: true, dirty: true },
  ]) {
    const availability = catalogAvailability(state)
    assert.equal(availability.canEdit, false)
    assert.equal(availability.canPublish, false)
    assert.notEqual(availability.revisionDetail, '已与持久目录同步')
  }
  assert.equal(catalogAvailability({ hasCatalog: true, loading: false, error: 'offline', dirty: true }).revisionDetail, '刷新失败；保留未发布修改')
})

test('only a loaded current writable catalog enables edits and dirty publication', () => {
  assert.deepEqual(catalogAvailability({ hasCatalog: true, loading: false, dirty: true }), {
    canEdit: true, canPublish: true, revisionDetail: '存在未发布修改',
  })
  assert.equal(catalogAvailability({ hasCatalog: true, loading: false, dirty: true, readOnly: true }).canPublish, false)
  assert.equal(catalogAvailability({ hasCatalog: true, loading: false, saving: true }).canEdit, false)
  assert.equal(catalogAvailability({ hasCatalog: true, loading: false }).canPublish, false)
})

test('project identifiers match Host format and detect both duplicate rows', async () => {
  const { validateWorkroomProjectIds } = await import('../console-ui/src/pages/workroom-catalog-model.mjs')
  assert.deepEqual(validateWorkroomProjectIds([
    { projectId: '' }, { projectId: '  ' },
    { projectId: 'alpha' }, { projectId: ' alpha ' },
    { projectId: 'team:中文%2F' },
  ]), ['Project ID 不能为空', 'Project ID 不能为空', 'Project ID 不能重复', 'Project ID 不能重复', '使用 1–64 位小写字母、数字、下划线或连字符，首位为字母或数字'])
  assert.deepEqual(validateWorkroomProjectIds([{ projectId: 'alpha' }, { projectId: 'beta' }]), [null, null])
})

test('required binding fields respect disabled rooms, repository format and inventory uncertainty', async () => {
  const { validateWorkroomBasics, validateWorkroomProjectIds } = await import('../console-ui/src/pages/workroom-catalog-model.mjs')
  const endpoints = [{ adapter: 'sandbox', name: 'test' }]
  const draft = { name: 'project', enabled: true, members: [{ agent: 'a', role: 'orchestrator' }], conversation: { adapter: 'sandbox', endpoint: 'test', kind: 'repository', id: 'owner/repo', agent: 'a' } }
  assert.deepEqual(validateWorkroomBasics(draft, endpoints), { name: null, conversation: {}, sponsorConversation: {} })
  assert.ok(validateWorkroomBasics({ ...draft, name: ' ' }, endpoints).name)
  assert.ok(validateWorkroomBasics({ ...draft, conversation: undefined }, endpoints).conversation.id)
  assert.deepEqual(validateWorkroomBasics({ ...draft, enabled: false, conversation: undefined }, endpoints).conversation, {})
  assert.ok(validateWorkroomBasics({ ...draft, conversation: { ...draft.conversation, id: 'invalid' } }, endpoints).conversation.id)
  assert.ok(validateWorkroomBasics({ ...draft, members: [{ agent: 'a', role: 'reviewer' }] }, endpoints).conversation.agent)
  assert.ok(validateWorkroomBasics(draft, []).conversation.endpoint)
  assert.deepEqual(validateWorkroomBasics(draft, [], false).conversation, {})
  assert.deepEqual(validateWorkroomProjectIds([{ projectId: 'a'.repeat(64) }, { projectId: 'b'.repeat(65) }, { projectId: '-bad' }, { projectId: 'UPPER' }]).map(Boolean), [false, true, true, true])
})

test('member validation preserves legitimate multiple roles but rejects duplicates and noncanonical remote IDs', async () => {
  const { validateWorkroomMembers } = await import('../console-ui/src/pages/workroom-catalog-model.mjs')
  const members = [{ agent: 'a', role: 'orchestrator' }, { agent: 'a', role: 'reviewer' }]
  assert.deepEqual(validateWorkroomMembers({ members }, ['a']), { orchestrator: null, members: [{}, {}] })
  const duplicate = validateWorkroomMembers({ members: [members[0], members[0]] }, ['a'])
  assert.ok(duplicate.members.every(row => row.role))
  const invalid = validateWorkroomMembers({ members: [{ agent: '', role: 'executor', assignmentRoute: { kind: 'remote', endpointId: ' worker ' } }] }, ['a'])
  assert.ok(invalid.orchestrator && invalid.members[0].agent && invalid.members[0].endpointId)
  assert.equal(validateWorkroomMembers({ enabled: false, members: [] }, []).orchestrator, null)
  assert.ok(validateWorkroomMembers({ members: [{ agent: 'missing', role: 'orchestrator' }] }, ['a']).members[0].agent)
  assert.deepEqual(validateWorkroomMembers({ members: [{ agent: 'a', role: 'orchestrator', assignmentRoute: { kind: 'remote', endpointId: 'worker' } }] }, ['a']).members, [{}])
})

test('Sponsor principals reject duplicates even on disabled projects and preserve distinct canonical identities', () => {
  const issues = validateWorkroomSponsors([
    { projectId: 'dup', enabled: false, sponsors: ['sponsor-a', 'sponsor-a'] },
    { projectId: 'invalid', sponsors: [' sponsor-a'] },
    { projectId: 'valid', sponsors: ['sponsor-a', 'sponsor-b'] },
  ])
  assert.deepEqual(issues.map(issue => issue.projectId), ['dup', 'invalid'])
})

test('publication reconciliation compares all definitions without depending on key ordering', async () => {
  const { workroomDefinitionsMatch } = await import('../console-ui/src/pages/workroom-catalog-model.mjs')
  const desired = { alpha: { name: 'saved', enabled: false, members: [{ agent: 'a', role: 'reviewer' }] } }
  assert.equal(workroomDefinitionsMatch({ alpha: { members: [{ role: 'reviewer', agent: 'a' }], enabled: false, name: 'saved' } }, desired), true)
  assert.equal(workroomDefinitionsMatch({ ...desired, extra: {} }, desired), false)
  assert.equal(workroomDefinitionsMatch({ alpha: { ...desired.alpha, name: 'external' } }, desired), false)
  assert.equal(workroomDefinitionsMatch({ alpha: { ...desired.alpha, members: [] } }, desired), false)
})
