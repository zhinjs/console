import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { databaseDescription } from '../console-ui/src/pages/database/database-console-model.mjs'

test('the database header names the engine, not the storage model', () => {
  assert.equal(databaseDescription({ dialectLabel: 'SQLite' }), '浏览和管理 SQLite 数据库中的数据；左栏选择对象，右侧查看与编辑。')
  assert.equal(databaseDescription({ dialectLabel: 'PostgreSQL', readOnly: true }), '浏览 PostgreSQL 数据库中的数据（只读）。')
  assert.equal(databaseDescription({ dialectLabel: 'SQLite' }, 'en'), 'Browse and manage data in the SQLite database. Select an object on the left to view and edit it.')
  assert.equal(databaseDescription({ dialectLabel: 'MongoDB', readOnly: true }, 'en'), 'Browse data in the MongoDB database (read-only).')
  // Before the Host answers there is no engine to name.
  assert.equal(databaseDescription({ dialectLabel: '' }), '浏览和管理项目数据库中的数据；数据库由 Zhin 实例提供。')
  assert.equal(databaseDescription(), '浏览和管理项目数据库中的数据；数据库由 Zhin 实例提供。')
  for (const text of [databaseDescription({ dialectLabel: 'SQLite' }), databaseDescription({ dialectLabel: 'Redis', readOnly: true })]) {
    assert.doesNotMatch(text, /关系型|文档型|键值型/u)
  }
})

test('the page passes the engine label to the header line', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/database/database-page.tsx', import.meta.url), 'utf8')
  assert.match(page, /description=\{databaseDescription\(\{ dialectLabel: info \? DIALECT_LABELS\[info\.dialect\] \|\| info\.dialect : '', readOnly \}, i18n\.locale\)\}/)
  assert.doesNotMatch(page, /浏览和管理 \{0\} 中的数据/u)
})
