import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readWelcomeUseCase, readWelcomeInstances, readWelcomeEvidence, welcomeApplied, welcomeReady, welcomeEvidenceKey, welcomeTargetKey, welcomeConfigUrl, welcomeDetailUrl, welcomeReturnUrl } from '../console-ui/src/pages/welcome-use-case-model.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixtures/welcome-flow-provider.json', import.meta.url), 'utf8'))
const useCase = readWelcomeUseCase(fixture.useCases), instance = fixture.applied.instanceKey
const plan = state => ({ packageName: state.packageName, instanceKey: state.instanceKey, generation: state.generation, projectRevision: state.projectRevision, checkRevision: 'unit-test-incarnation', checks: [] })
const evidence = (state = fixture.applied, source = fixture.source) => readWelcomeEvidence(state, plan(state), instance, useCase.packageName, source)

test('actual Host catalog and two-alias plugin response retain exact selectable instances', () => {
  const rows = readWelcomeInstances(fixture.plugins, useCase.packageName)
  assert.deepEqual(rows.map(item => item.instanceKey).sort(), ['welcome-alpha', 'welcome-beta'])
  assert.equal(rows.length, 2)
  assert.equal(readWelcomeInstances(fixture.plugins, 'another-package').length, 0)
  assert.throws(() => readWelcomeUseCase({ success: true, data: [] }), /未提供/)
})

test('navigation preserves the exact chosen alias and never assumes an installation alias', () => {
  const alias = 'alias /?&中文'
  for (const url of [welcomeConfigUrl(alias), welcomeDetailUrl(alias), welcomeReturnUrl(alias)]) assert.ok(url.includes(encodeURIComponent(alias)))
  assert.match(welcomeConfigUrl(alias), /useCase=group-welcome/)
})

test('actual applied Host configuration and real notice delivery share the full target', () => {
  const value = readWelcomeEvidence(fixture.applied, fixture.plan, instance, useCase.packageName, fixture.source)
  assert.equal(welcomeApplied(value), true)
  assert.equal(welcomeReady(value, fixture.target), true)
  assert.deepEqual(value.welcome.targets, [fixture.target])
  assert.equal(fixture.deliveries.length, 1)
  for (const changed of [
    { ...fixture.target, endpoint: { ...fixture.target.endpoint, id: 'different-account' } },
    { ...fixture.target, endpoint: { ...fixture.target.endpoint, adapter: 'different-adapter' } },
    { ...fixture.target, parent: { ...fixture.target.parent, id: 'different-parent' } },
    { ...fixture.target, threadId: 'different-thread' },
    { ...fixture.target, parent: undefined }, { ...fixture.target, threadId: undefined },
  ]) assert.equal(welcomeReady(value, changed), false)
})

test('published/enabled with an empty welcome scope is not an enabled welcome', () => {
  const value = evidence(fixture.initialState, fixture.initialSource)
  assert.equal(welcomeApplied(value), true)
  assert.equal(welcomeReady(value, fixture.target), false)
  assert.equal(value.welcome.mode, 'none')
})

test('empty text disables welcome, omission means all, and only public welcome fields are retained', () => {
  const source = structuredClone(fixture.source), document = JSON.parse(source.source)
  document[instance].welcomeMessage = ''; delete document[instance].welcomeConversations
  document.unrelatedSecret = 'MUST-NOT-RETAIN'; source.source = JSON.stringify(document)
  const value = evidence(fixture.applied, source)
  assert.equal(value.welcome.mode, 'all'); assert.equal(welcomeReady(value), false)
  assert.doesNotMatch(JSON.stringify(value), /MUST-NOT-RETAIN|unrelatedSecret|welcomeMessage/)
  document[instance].welcomeMessage = 'nonempty'; source.source = JSON.stringify(document)
  assert.equal(welcomeReady(evidence(fixture.applied, source), fixture.target), true)
})

test('changed file revision, package, alias or unsafe source cannot be treated as current evidence', () => {
  assert.throws(() => evidence(fixture.applied, { ...fixture.source, revision: 'different' }), /版本/)
  assert.throws(() => evidence({ ...fixture.applied, packageName: 'different' }), /证据/)
  assert.throws(() => readWelcomeEvidence(fixture.beta, plan(fixture.beta), instance, useCase.packageName, fixture.source), /实例/)
  assert.throws(() => evidence(fixture.applied, { ...fixture.source, source: '{PRIVATE-SYNTAX-ERROR' }), error => !error.message.includes('PRIVATE-SYNTAX-ERROR'))
})

test('environment-referenced welcome text is unknown, without reading or exposing its expanded value', () => {
  for (const expression of ['${WELCOME_TEXT}', '${WELCOME_TEXT:-}', '${WELCOME_TEXT:=}', '${WELCOME_TEXT:-${NESTED}}', '${not-yet-supported']) {
    const source = structuredClone(fixture.source), document = JSON.parse(source.source)
    document[instance].welcomeMessage = expression; source.source = JSON.stringify(document)
    const value = evidence(fixture.applied, source)
    assert.equal(value.welcome.messagePresent, null); assert.equal(welcomeReady(value, fixture.target), false)
    assert.doesNotMatch(JSON.stringify(value), /WELCOME_TEXT|not-yet-supported/)
  }
})

test('real owner environment capture is published but the actual welcome handler sends nothing for expanded empty text', async () => {
  const actual = JSON.parse(await readFile(new URL('./fixtures/welcome-flow-empty-env.json', import.meta.url), 'utf8'))
  const value = readWelcomeEvidence(actual.applied, actual.plan, actual.applied.instanceKey, actual.applied.packageName, actual.source)
  assert.equal(actual.expandedMessageWasEmpty, true); assert.deepEqual(actual.deliveries, [])
  assert.equal(welcomeApplied(value), true); assert.equal(value.welcome.messagePresent, null)
  assert.equal(welcomeReady(value, actual.target), false)
})

test('environment references anywhere in a raw target are unknown, never treated as resolved platform identity', () => {
  for (const path of [['endpoint', 'adapter'], ['endpoint', 'id'], ['kind'], ['id'], ['parent', 'kind'], ['parent', 'id'], ['threadId']]) {
    const source = structuredClone(fixture.source), document = JSON.parse(source.source)
    const target = document[instance].welcomeConversations[0]
    let parent = target; for (const key of path.slice(0, -1)) parent = parent[key]
    parent[path.at(-1)] = '${RAW_TARGET_REFERENCE:-}'
    source.source = JSON.stringify(document)
    const value = evidence(fixture.applied, source)
    assert.equal(value.welcome.mode, 'unknown'); assert.deepEqual(value.welcome.targets, [])
    assert.equal(welcomeReady(value, target), false); assert.equal(welcomeTargetKey(target), undefined)
    assert.doesNotMatch(JSON.stringify(value), /RAW_TARGET_REFERENCE/)
  }
})

test('incarnation, generation, file and project revisions all participate in evidence binding', () => {
  const value = evidence(), original = welcomeEvidenceKey(value)
  for (const state of [{ ...value.state, generation: value.state.generation + 1 }, { ...value.state, revision: 'new-file' }, { ...value.state, projectRevision: 'new-project' }]) assert.notEqual(welcomeEvidenceKey({ ...value, state }), original)
  assert.notEqual(welcomeEvidenceKey({ ...value, incarnation: 'restarted-same-generation' }), original)
  assert.equal(welcomeTargetKey({ ...fixture.target, kind: 'private' }), undefined)
})
