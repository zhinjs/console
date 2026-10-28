import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeRecentByGroup, ambientGroupLabel } from '../console-ui/src/pages/ambient-engagement-model.mjs'

test('recent decisions fold into one newest-first row per group', () => {
  const recent = [
    { at: 10, group: 'icqq:1', outcome: 'stayed_quiet', text: '决定不接话' },
    { at: 30, group: 'icqq:2', outcome: 'spoke', text: '接了话' },
    { at: 20, group: 'icqq:1', outcome: 'stayed_quiet', text: '决定不接话' },
    { at: 25, group: 'icqq:1', outcome: 'skipped', text: '这次没有判断：刚插过话，先歇一会儿' },
  ]
  const rows = summarizeRecentByGroup(recent)
  assert.deepEqual(rows.map(row => [row.group, row.count, row.lastAt]), [['icqq:2', 1, 30], ['icqq:1', 3, 25]])
  assert.equal(rows[1].lastText, '这次没有判断：刚插过话，先歇一会儿')
  assert.deepEqual(rows[1].outcomes.map(item => [item.label, item.count]), [['不接话', 2], ['未判断', 1]])
  assert.deepEqual(summarizeRecentByGroup([]), [])
})

test('group labels prefer known names and keep the id visible', () => {
  const names = new Map([['icqq:1', '开发群']])
  assert.deepEqual(ambientGroupLabel('icqq:1', names), { name: '开发群', id: 'icqq:1' })
  assert.deepEqual(ambientGroupLabel('icqq:9', names), { name: 'icqq:9', id: null })
  assert.deepEqual(ambientGroupLabel('icqq:9', null), { name: 'icqq:9', id: null })
})
