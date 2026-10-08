import test from 'node:test'
import assert from 'node:assert/strict'
import { databaseSaveError } from '../console-ui/src/pages/database/save-error.mjs'

test('database save feedback separates actionable duplicate errors from diagnostic details', () => {
 for(const message of ['UNIQUE constraint failed: SystemLog.id','duplicate key value','Duplicate entry 1']) {
  const result=databaseSaveError(new Error(message))
  assert.equal(result.text,'主键或唯一字段已存在，请修改后重试。')
  assert.equal(result.details,message)
 }
 const result=databaseSaveError(new Error('SQLITE_BUSY'))
 assert.ok(result.text.includes('当前输入已保留'))
 assert.equal(result.details,'SQLITE_BUSY')
})
