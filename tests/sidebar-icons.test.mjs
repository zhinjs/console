import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('every builtin route icon has a sidebar mapping instead of falling back to a blank circle', () => {
  const shell = read('registerBuiltinShell.tsx')
  const icons = read('components/sidebarMenuIcons.ts')
  const table = icons.slice(icons.indexOf('SIDEBAR_LUCIDE_BY_NAME')).match(/\{([\s\S]*?)\}/)[1]
  const mapped = new Set(table.split(',').map(entry => entry.trim()).filter(Boolean))
  const used = [...new Set([...shell.matchAll(/icon: '([A-Za-z0-9]+)'/g)].map(match => match[1]))]
  assert.ok(used.length > 10, 'expected the builtin routes to declare icons')
  assert.deepEqual(used.filter(name => !mapped.has(name)), [])
})
