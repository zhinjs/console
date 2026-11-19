import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { chatModelBadge } from '../console-ui/src/pages/inference/model.mjs'

// #64 `current-chat-badge-default-only`: the default chat model was badged 「当前聊天模型」 even though
// sandbox, qq and github chat through another model; only icqq used it.
const purposes = {
  defaults: { chat: 'deepseek' },
  adapters: {
    sandbox: { chat: 'codex' },
    qq: { chat: 'codex', chatFallbacks: ['deepseek'] },
    github: { chat: 'codex' },
    icqq: { chat: 'deepseek' },
    discord: { perception: { profile: 'gemini' } },
  },
}

test('the default chat model with overrides elsewhere is labelled as the default, with the overrides counted', () => {
  const badge = chatModelBadge(purposes, 'deepseek')
  assert.equal(badge.label, '默认聊天模型 · 3 处改用其他模型')
  assert.deepEqual(badge.overrides, ['适配器 sandbox', '适配器 qq', '适配器 github'])
  assert.match(badge.title, /适配器 sandbox、适配器 qq、适配器 github/)
  const english = chatModelBadge(purposes, 'deepseek', 'en')
  assert.doesNotMatch(`${english.label} ${english.title}`, /[一-鿿]/u)
})

test('with no override it stays 「当前聊天模型」', () => {
  const badge = chatModelBadge({ defaults: { chat: 'deepseek' }, adapters: { icqq: { chat: 'deepseek' }, discord: { perception: { profile: 'g' } } } }, 'deepseek')
  assert.deepEqual(badge, { label: '当前聊天模型', title: null, overrides: [] })
})

test('account and conversation overrides count too; models that are not the default chat get no badge', () => {
  const badge = chatModelBadge({ defaults: { chat: 'a' }, endpoints: { 'qq/1': { chat: 'b' } }, scenes: { 'qq:group:9': { chat: 'b' }, 'qq:group:10': { chat: 'a' } } }, 'a')
  assert.deepEqual(badge.overrides, ['账号 qq/1', '会话 qq:group:9'])
  assert.equal(chatModelBadge(purposes, 'codex'), null)
  assert.equal(chatModelBadge(null, 'deepseek'), null)
  assert.equal(chatModelBadge({ defaults: {} }, 'deepseek'), null)
})

test('the model card shows that badge instead of the default-only check', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/inference/Profiles.tsx', import.meta.url), 'utf8')
  assert.match(source, /chatModelBadge\(view\.purposes, profile\.id, i18n\.locale\)/)
  assert.doesNotMatch(source, />\{i18n\.t\("当前聊天模型"\)\}</)
})
