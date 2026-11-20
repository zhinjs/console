import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { profileUsages, purposeElementId, usagePurposeFocus } from '../console-ui/src/pages/inference/model.mjs'
import { inferenceFocusPurpose, inferencePurposeParams, inferenceTabParams } from '../console-ui/src/pages/inference/models-entry.mjs'

// #64 `profile-usage-not-linked`: 「谁在用：适配器 sandbox 的聊天 ·…（在「用途」页签修改）」 was plain text, so
// changing it meant switching tabs and hunting through two screens of controls for the row.
const read = path => readFileSync(new URL(`../console-ui/src/pages/inference/${path}`, import.meta.url), 'utf8')

test('each usage points at the place on 「用途」 where it is set', () => {
  const purposes = {
    defaults: { chat: 'p', perception: { profile: 'p' } },
    decisions: { skills: { profile: 'p', mode: 'on' } },
    agents: { planner: 'p' },
    adapters: { sandbox: { chat: 'p' }, qq: { perception: { profile: 'p' } } },
    endpoints: { 'icqq:10001': { chat: 'p' } },
    scenes: { 'qq:group:9': { chat: 'p' } },
    ambient: { profile: 'p' },
  }
  const focus = Object.fromEntries(profileUsages(purposes, 'p').map(usage => [usage.key, usagePurposeFocus(usage.key)]))
  assert.deepEqual(focus, {
    'default:chat': 'defaults',
    'default:perception': 'defaults',
    'ambient:0': 'ambient',
    'decision:skills': 'decisions',
    'agent:planner': 'agents',
    'adapter:sandbox:chat': 'adapters:sandbox',
    'adapter:qq:perception': 'adapters:qq',
    'endpoint:icqq:10001:chat': 'endpoints:icqq:10001',
    'scene:qq:group:9': 'scenes:qq:group:9',
  })
  assert.equal(usagePurposeFocus('agent:planner:fallback'), 'agents')
  assert.equal(usagePurposeFocus('default:chat-fallback'), 'defaults')
  assert.equal(usagePurposeFocus('nonsense'), undefined)
})

test('the link is a URL: ?tab=purposes&purpose=…, dropped again when leaving 用途', () => {
  const params = inferencePurposeParams(new URLSearchParams('account=a&x=1'), 'adapters:sandbox')
  assert.equal(params.get('tab'), 'purposes')
  assert.equal(params.get('purpose'), 'adapters:sandbox')
  assert.equal(params.get('account'), null)
  assert.equal(params.get('x'), '1')
  assert.equal(inferenceTabParams(params, 'profiles').get('purpose'), null)
  assert.deepEqual(inferenceFocusPurpose('adapters:sandbox'), { section: 'scopes', level: 'adapters', key: 'sandbox' })
  assert.deepEqual(inferenceFocusPurpose('scenes:qq:group:9'), { section: 'scopes', level: 'scenes', key: 'qq:group:9' })
  assert.deepEqual(inferenceFocusPurpose('decisions'), { section: 'decisions' })
  assert.equal(inferenceFocusPurpose('adapters:'), undefined)
  assert.equal(inferenceFocusPurpose('elsewhere'), undefined)
  assert.equal(inferenceFocusPurpose(null), undefined)
  assert.equal(purposeElementId({ section: 'decisions' }), 'inference-purpose-decisions')
  assert.equal(purposeElementId({ section: 'scopes', level: 'scenes', key: 'qq:group:9' }), 'inference-purpose-scenes-qq%3Agroup%3A9')
})

test('the pages wire it up: usages are buttons, 用途 opens the right level and scrolls to the row', () => {
  const profiles = read('Profiles.tsx')
  assert.match(profiles, /onClick=\{\(\) => onOpen\?\.\(focus\)\}/)
  const workspace = read('Workspace.tsx')
  assert.match(workspace, /inferenceFocusPurpose\(searchParams\.get\('purpose'\)\)/)
  assert.match(workspace, /<Purposes management=\{m\} focus=\{tab === 'purposes' \? focusPurpose : undefined\} \/>/)
  assert.match(workspace, /onOpenPurpose=\{m\.view\.hostAdministrator \? /)
  const purposes = read('Purposes.tsx')
  for (const section of ['defaults', 'ambient', 'decisions', 'agents', 'scopes'])
    assert.match(purposes, new RegExp(`id=\\{purposeElementId\\(\\{ section: '${section}' \\}\\)\\}`), section)
  assert.match(purposes, /id=\{purposeElementId\(\{ section: 'scopes', level, key \}\)\}/)
  assert.match(purposes, /if \(focus\?\.level\) setLevel\(focus\.level\)/)
})
