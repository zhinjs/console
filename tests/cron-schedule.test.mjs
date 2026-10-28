import test from 'node:test'
import assert from 'node:assert/strict'
import { describeCron, relativeUntil } from '../console-ui/src/pages/cron-schedule.mjs'

test('common six- and five-field cron shapes read as plain schedules', () => {
  assert.equal(describeCron('*/20 * * * * *'), '每 20 秒')
  assert.equal(describeCron('0 */10 * * * *'), '每 10 分钟')
  assert.equal(describeCron('0 * * * * *'), '每分钟')
  assert.equal(describeCron('0 0 9 * * *'), '每天 09:00')
  assert.equal(describeCron('30 8 * * *'), '每天 08:30')
  assert.equal(describeCron('0 0 */2 * * *'), '每 2 小时')
  assert.equal(describeCron('0 30 18 * * 5'), '每周五 18:30')
  assert.equal(describeCron('0 0 9 * * *', 'en'), 'Daily at 09:00')
})

test('unknown shapes stay raw instead of guessing', () => {
  for (const expression of ['0 0 9 1 * *', '0 0 9-17 * * 1-5', 'bad', '', '1 2 3']) assert.equal(describeCron(expression), null)
})

test('relative next run is short and never describes the past', () => {
  const now = 1_000_000
  assert.equal(relativeUntil(now + 30_000, now), '30 秒后')
  assert.equal(relativeUntil(now + 5 * 60_000, now), '5 分钟后')
  assert.equal(relativeUntil(now + 3 * 3_600_000, now), '3 小时后')
  assert.equal(relativeUntil(now - 1000, now), null)
  assert.equal(relativeUntil(null, now), null)
})
