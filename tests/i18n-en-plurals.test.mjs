import assert from 'node:assert/strict'
import test from 'node:test'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const en = (message, ...values) => translate('en', message, values)

test('the counts reported on #64 read in the singular for one and the plural otherwise', () => {
  assert.equal(en('{0} 个聊天账号离线', 1), '1 chat account offline')
  assert.equal(en('{0} 个聊天账号离线', 3), '3 chat accounts offline')
  assert.equal(en('{0} 个 MCP 服务未连接', 1), '1 MCP service disconnected')
  assert.equal(en('{0} 个 MCP 服务未连接', 2), '2 MCP services disconnected')
  assert.equal(en('{0} 个 MCP 服务未连接，检查服务地址与凭据 →', 1), '1 MCP service disconnected — check its address and credentials →')
  assert.equal(en('历史错误 {0} 条', 1), '1 recorded error')
  assert.equal(en('历史错误 {0} 条', 0), '0 recorded errors', 'zero is plural in English')
})

test('a count passed as digits picks the form too; formatted or non-numeric values stay plural', () => {
  assert.equal(en('{0} 项', '1'), '1 item')
  assert.equal(en('{0} 项', '12'), '12 items')
  assert.equal(en('{0} 项', '1,234'), '1,234 items')
  assert.equal(translate('en', '{0} 项'), '{0} items', 'no count: the plural form, placeholder kept')
  assert.equal(translate('zh-CN', '{0} 项', [1]), '1 项', 'Chinese is unchanged')
})

test('every { one, other } entry is a pair of strings that differ', () => {
  const pairs = Object.entries(englishMessages).filter(([, value]) => typeof value !== 'string')
  assert.ok(pairs.length > 60, 'the counted copy across the catalog uses plural forms')
  for (const [key, value] of pairs) {
    assert.deepEqual(Object.keys(value).sort(), ['one', 'other'], key)
    assert.ok(typeof value.one === 'string' && typeof value.other === 'string' && value.one !== value.other, key)
  }
})
