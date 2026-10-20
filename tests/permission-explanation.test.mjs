import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readPermissionCatalog, readPermissionExplanation, permissionRequest, permissionOutcomeLabel } from '../console-ui/src/pages/permission-explanation-model.mjs'

const selected = { id: 'root/demo\0zhin.command\0status', owner: 'root/demo', name: 'status', description: '状态', permits: ['group()', 'role(admin)', 'platform(qq,admin)'] }
const target = { endpoint: { adapter: 'qq', id: 'root/qq\0zhin.adapter\0qq~first' }, kind: 'group', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' }
const request = { generation: 3, commandId: selected.id, target, sender: { id: 'alice' } }
const response = () => ({ success: true, data: { generation: 3, simulation: true, command: selected, target, sender: { id: 'alice' },
  permissionHost: 'present', adapter: { outcome: 'not_evaluated', reason: '命令未声明 adapter 约束' },
  rules: [
    { index: 0, rule: 'group()', kind: 'group', values: [''], outcome: 'match', reason: '群聊条件符合' },
    { index: 1, rule: 'role(admin)', kind: 'role', values: ['admin'], outcome: 'unknown', reason: '未提供假设角色' },
    { index: 2, rule: 'platform(qq,admin)', kind: 'platform', outcome: 'not_evaluated', reason: '平台 checker 未执行' },
  ], summary: { outcome: 'unknown', reason: '缺少依据' }, unconstrained: ['未约束具体 Endpoint、parent 或 thread'], assumptions: ['仅是假设，未验证平台身份'] } })

test('reads paginated commands by exact capability identity and keeps unknown roles unknown', () => {
  const catalog = readPermissionCatalog({ success: true, data: { generation: 3, page: 2, pageSize: 50, total: 200, commands: [selected] } })
  assert.equal(catalog.commands[0].id, selected.id)
  assert.equal(catalog.total, 200)
  const explanation = readPermissionExplanation(response(), request)
  assert.equal(explanation.rules[1].outcome, 'unknown')
  assert.equal(explanation.rules[2].outcome, 'not_evaluated')
  assert.equal(explanation.summary.outcome, 'unknown')
  assert.equal(permissionOutcomeLabel('match'), '条件符合')
  assert.equal(Object.hasOwn(explanation, 'allowed'), false)
})

test('binds explanations to exact command, generation, canonical target and assumed sender', () => {
  for (const mutate of [
    value => { value.data.command.id = 'other' },
    value => { value.data.generation = 4 },
    value => { value.data.target.endpoint.id += '-second' },
    value => { value.data.target.endpoint.adapter = 'other' },
    value => { value.data.target.parent.id = 'other' },
    value => { value.data.target.threadId = 'other' },
    value => { delete value.data.target.threadId },
    value => { value.data.sender.id = 'bob' },
    value => { value.data.sender.roles = ['admin'] },
    value => { value.data.rules[0].rule = 'private()' },
    value => { value.data.simulation = false },
    value => { value.data.summary.outcome = 'allowed' },
  ]) {
    const value = structuredClone(response()); mutate(value)
    assert.throws(() => readPermissionExplanation(value, request), /响应无效/)
  }
})

test('builds read-only hypothetical requests without inventing conversation or role identity', () => {
  assert.deepEqual(permissionRequest(3, selected), { generation: 3, commandId: selected.id })
  assert.deepEqual(permissionRequest(3, selected, { senderId: 'alice' }), { generation: 3, commandId: selected.id, sender: { id: 'alice' } })
  const body = permissionRequest(3, selected, { target, senderId: 'alice', roles: ' admin，trusted, admin ' })
  assert.deepEqual(body.sender.roles, ['admin', 'trusted'])
  assert.deepEqual(body.target, target)
  const longEndpoint = { ...target, endpoint: { ...target.endpoint, id: 'e'.repeat(4096) } }
  assert.equal(permissionRequest(3, selected, { target: longEndpoint }).target.endpoint.id.length, 4096)
  assert.equal(permissionRequest(3, selected, { senderId: ' alice ' }).sender.id, ' alice ')
  assert.equal(Object.hasOwn(body, 'permits'), false)
  assert.throws(() => permissionRequest(3, selected, { roles: 'admin' }), /发送者 ID/)
  assert.throws(() => permissionRequest(3, selected, { requireTarget: true }), /完整/)
  assert.throws(() => permissionRequest(3, selected, { target: { ...target, parent: { id: 'guild' } } }), /完整/)
})

test('preserves spaces inside exact role names and separates roles only by commas', () => {
  const body = permissionRequest(3, selected, { senderId: 'alice', roles: ' project admin, on call reviewer，project admin ' })
  assert.deepEqual(body.sender.roles, ['project admin', 'on call reviewer'])
})

test('rejects malformed catalogs and duplicate identities instead of guessing a command', () => {
  for (const data of [
    { generation: 3, page: 0, pageSize: 50, total: 1, commands: [selected] },
    { generation: 3, page: 1, pageSize: 101, total: 1, commands: [selected] },
    { generation: 3, page: 1, pageSize: 50, total: 2, commands: [selected, selected] },
  ]) assert.throws(() => readPermissionCatalog({ success: true, data }), /响应无效/)
})

test('consumes actual authenticated Host DTOs without upgrading unknown or skipped conditions', async () => {
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/permission-http.json', import.meta.url), 'utf8'))
  const catalog = readPermissionCatalog(fixtures.catalog)
  for (const key of ['explanation', 'admin', 'unknownRole', 'platform']) {
    const body = fixtures[key], value = body.data
    assert.ok(catalog.commands.some(item => item.id === value.command.id))
    const actual = readPermissionExplanation(body, { generation: value.generation, commandId: value.command.id,
      ...(value.target === undefined ? {} : { target: value.target }), ...(value.sender === undefined ? {} : { sender: value.sender }) })
    assert.equal(actual.simulation, true)
  }
  assert.equal(fixtures.admin.data.summary.outcome, 'match')
  assert.equal(fixtures.unknownRole.data.rules.find(rule => rule.kind === 'role').outcome, 'unknown')
  assert.equal(fixtures.platform.data.rules[0].outcome, 'not_evaluated')
})
