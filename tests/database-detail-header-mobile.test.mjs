import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../console-ui/src/pages/database/database-page.tsx', import.meta.url), 'utf8')
// The open-table header: from the selectedTable branch up to the detail body.
const start = page.indexOf(') : selectedTable ? (')
const header = page.slice(start, page.indexOf('<div className="flex-1 min-h-0 min-w-0 p-3', start))

test('on phones the table name keeps its own row instead of shrinking to ~70px', () => {
  assert.match(header, /<div className="flex flex-wrap items-center gap-2 [^"]*">/, 'the header row may wrap')
  assert.match(header, /<h2 className="[^"]*truncate min-w-0 max-sm:flex-1[^"]*"/, 'the name fills the first row below 640px')
  const name = header.indexOf('<h2 '), breakRow = header.indexOf('<div className="basis-full h-0 sm:hidden" aria-hidden="true" />')
  const tabs = header.indexOf('<Tabs '), drop = header.indexOf('data-action="drop-table"')
  assert.ok(name >= 0 && breakRow > name && tabs > breakRow && drop > breakRow, 'tabs and delete move to a second row on phones')
})

test('a truncated table name can still be read in full', () => {
  assert.match(header, /<h2 [^>]*title=\{selectedTable\}>\{selectedTable\}<\/h2>/)
})
