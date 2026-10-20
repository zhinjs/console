import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readTaskProviders, readTaskSnapshot, readTaskMutation, readTaskUseCases, taskMutationBody, taskParameterFields, validateTaskParameters,
  availableTaskActions, taskTimeLabel, taskActionDescription, taskDateTimeLabel, reconcileTaskMutation, readPendingTask } from '../console-ui/src/pages/task-center-model.mjs'
import { buildPreviewTarget } from '../console-ui/src/pages/introspection/target-preview.mjs'

const requestId = 'af4c784d-448b-4eb6-939e-fdc269eb2421'
const target = { endpoint: { id: 'root/bot-a\0zhin.adapter\0account', adapter: 'root/bot-a' }, kind: 'channel', id: 'shared', parent: { kind: 'channel', id: 'workspace' }, threadId: 'topic' }
const schema = { type: 'object', additionalProperties: false, required: ['text', 'at'], properties: {
  text: { type: 'string', minLength: 1, title: '提醒内容' }, at: { type: 'string', format: 'date-time', title: '首次执行时间' },
  intervalSeconds: { type: 'integer', minimum: 60, title: '周期秒数' },
} }
const task = { id: 'task-id-not-request-id', ownership: 'administrator', title: '周报', target, state: 'scheduled', createdAt: 100,
  nextRunAt: 200, timezone: 'UTC', parameters: { text: '周报', at: '2027-01-01T09:00:00+08:00' }, actions: ['pause', 'cancel'] }
const provider = { owner: 'root/reminder', packageName: '@example/reminder', title: '提醒', description: '说明', effects: ['未来投递'], schema, revision: 'revision-1', tasks: [task], receipts: [] }
const catalog = { generation: 2, providers: [provider] }
const pending = { owner: provider.owner, requestId, generation: 2, operation: 'create', host: 'https://host.example', scope: 'scope-a' }

test('real Host HTTP fixtures from SQLite-backed ReminderService and AdapterIndex satisfy the Console wire contract', async () => {
  const get = JSON.parse(await readFile(new URL('./fixtures/task-providers.json', import.meta.url), 'utf8'))
  const post = JSON.parse(await readFile(new URL('./fixtures/task-create.json', import.meta.url), 'utf8'))
  const listed = readTaskProviders(get), created = readTaskMutation(post)
  assert.deepEqual(listed, get.data)
  assert.deepEqual(created, post.data)
  assert.equal(created.provider.packageName, '@zhin.js/plugin-reminder')
  assert.equal(created.provider.tasks[0].ownership, 'administrator')
  assert.equal(created.provider.tasks[0].parameters.text.length, 300)
  assert.deepEqual(validateTaskParameters(created.provider.schema, created.provider.tasks[0].parameters), [])
  const receipt = created.provider.receipts[0]
  assert.equal(reconcileTaskMutation(listed, { owner: created.provider.owner, requestId: receipt.requestId, operation: receipt.operation }).receipt.taskId, receipt.taskId)
})

test('provider and mutation wire keep administrator ownership, exact owner and generation', () => {
  assert.deepEqual(readTaskProviders({ success: true, data: catalog }), catalog)
  assert.deepEqual(readTaskMutation({ success: true, data: { generation: 2, provider } }), { generation: 2, provider })
  assert.throws(() => readTaskProviders({ success: true, data: { ...catalog, generation: -1 } }))
  assert.throws(() => readTaskSnapshot({ ...provider, tasks: [{ ...task, ownership: 'chat-user' }] }))
  assert.throws(() => readTaskSnapshot({ ...provider, receipts: undefined }))
  assert.throws(() => readTaskProviders({ success: true, data: { generation: 2, providers: [provider, provider] } }))
})

test('target selection preserves Endpoint, parent and thread; display names cannot replace canonical identity', () => {
  const resolved = buildPreviewTarget(target.endpoint, { kind: target.kind, id: target.id, parentKind: target.parent.kind, parentId: target.parent.id, threadId: target.threadId })
  assert.deepEqual(resolved, target)
  assert.throws(() => buildPreviewTarget({ name: 'account' }, { kind: 'group', id: 'shared' }), /Endpoint/)
  assert.throws(() => buildPreviewTarget(target.endpoint, { kind: 'channel', id: 'shared', parentKind: 'channel' }), /同时/)
  const body = taskMutationBody({ generation: 2, provider, requestId, target: resolved, parameters: task.parameters })
  resolved.threadId = 'changed-after-review'
  assert.equal(body.target.threadId, 'topic')
  assert.equal(body.expectedRevision, 'revision-1')
  assert.equal(body.requestId, requestId)
})

test('unknown task never advertises resume, update or retry; cancellation remains an explicit advertised operation', () => {
  const uncertain = { ...task, state: 'unknown', actions: ['pause', 'resume', 'update', 'cancel'] }
  assert.deepEqual(availableTaskActions(uncertain), ['cancel'])
  for (const action of ['pause', 'resume', 'update']) assert.throws(() => taskMutationBody({ generation: 2, provider: { ...provider, tasks: [uncertain] }, requestId, id: uncertain.id, action }))
  assert.equal(taskMutationBody({ generation: 2, provider: { ...provider, tasks: [uncertain] }, requestId, id: uncertain.id, action: 'cancel' }).action, 'cancel')
})

test('plain JSON Schema fields reuse the generic editor while complex schemas block whole submission', () => {
  const fields = taskParameterFields(schema)
  assert.equal(fields.fields.text.required, true); assert.equal(fields.fields.intervalSeconds.min, 60)
  assert.ok(taskParameterFields({ ...schema, oneOf: [] }).unsupported)
  assert.ok(taskParameterFields({ ...schema, properties: { nested: { type: 'object', properties: {} } } }).unsupported)
  assert.ok(taskParameterFields({ ...schema, additionalProperties: { type: 'string' } }).unsupported)
  assert.deepEqual(validateTaskParameters(schema, task.parameters), [])
  assert.ok(validateTaskParameters(schema, { ...task.parameters, at: '2027-01-01T09:00:00' }).some(issue => /ISO/.test(issue)))
  assert.ok(validateTaskParameters(schema, { ...task.parameters, intervalSeconds: 59 }).length)
  assert.ok(validateTaskParameters(schema, { ...task.parameters, intervalSeconds: 60.5 }).length)
  assert.ok(validateTaskParameters(schema, { ...task.parameters, text: '' }).length)
})

test('durable mutation receipt, not parameters or task ID guessing, resolves a lost create response', () => {
  assert.equal(reconcileTaskMutation(catalog, pending), undefined)
  const receipt = { requestId, taskId: task.id, operation: 'create' }
  const confirmed = reconcileTaskMutation({ ...catalog, providers: [{ ...provider, receipts: [receipt] }] }, pending)
  assert.equal(confirmed.task.id, 'task-id-not-request-id')
  assert.equal(confirmed.receipt.taskId, task.id)
  assert.equal(reconcileTaskMutation({ ...catalog, providers: [{ ...provider, owner: 'root/another', receipts: [receipt] }] }, pending), undefined)
  assert.equal(reconcileTaskMutation({ ...catalog, providers: [{ ...provider, receipts: [{ ...receipt, operation: 'cancel' }] }] }, pending), undefined)
})

test('persisted pending operation strips content, target, parameters, credentials and extra fields', () => {
  const preserved = readPendingTask({ ...pending, token: 'dummy', target, parameters: task.parameters, body: 'private' })
  assert.deepEqual(preserved, pending)
  assert.equal(readPendingTask({ ...pending, scope: undefined }), undefined)
  assert.equal(readPendingTask({ ...pending, host: undefined }), undefined)
})

test('task use cases use Host package provenance and structured guidance without creating tasks', () => {
  const useCase = { id: 'welcome', title: '欢迎', summary: '配置入口', packageName: '@example/group', mode: 'plugin-configuration', steps: ['打开实例配置'], limitations: ['尚无单群范围'] }
  assert.deepEqual(readTaskUseCases({ success: true, data: [useCase] }), [useCase])
  assert.throws(() => readTaskUseCases({ success: true, data: [{ ...useCase, steps: ['ok', {}] }] }))
  assert.match(taskTimeLabel(0, 'Asia/Shanghai'), /Asia\/Shanghai/)
  assert.equal(taskTimeLabel(undefined, 'UTC'), '未安排')
  assert.match(taskTimeLabel(1e100, 'UTC'), /超出可显示范围/)
  assert.match(taskTimeLabel(0, 'Invalid\/Timezone'), /提供方时区无效/)
})

test('confirmation descriptions distinguish creation from state changes and preserve explicit timezones', () => {
  assert.match(taskActionDescription('create'), /保存管理员任务，并按指定时间/)
  assert.match(taskActionDescription('pause'), /暂停后续执行/)
  assert.match(taskActionDescription('cancel'), /无法撤回/)
  assert.match(taskActionDescription('update'), /目标保持不变/)
  assert.doesNotMatch(taskActionDescription('resume'), /按指定时间向所选会话投递/)
  assert.match(taskDateTimeLabel('2027-01-01T09:00:00+08:00', 'UTC'), /UTC/)
  assert.equal(taskDateTimeLabel('2027-01-01T09:00:00+08:00'), '2027年1月1日 09:00（UTC+08:00）')
})
