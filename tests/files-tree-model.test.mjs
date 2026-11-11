import assert from 'node:assert/strict'
import test from 'node:test'
import { locateTreePath, normalizeTreePath, searchTreeFiles } from '../console-ui/src/pages/files/file-tree-model.mjs'

const tree = [
  { type: 'directory', name: 'src', path: 'src', children: [
    { type: 'directory', name: 'a', path: 'src/a', children: [
      { type: 'file', name: 'Target.ts', path: 'src/a/Target.ts' },
      { type: 'directory', name: 'limit', path: 'src/a/limit', children: [] },
    ] },
    { type: 'file', name: 'target.md', path: 'src/target.md' },
  ] },
  { type: 'file', name: 'package.json', path: 'package.json' },
]

test('locating a linked file returns the ancestors to expand', () => {
  assert.deepEqual(locateTreePath(tree, 'src/a/Target.ts'), { status: 'found', ancestors: ['src', 'src/a'] })
  assert.deepEqual(locateTreePath(tree, './src/a/Target.ts'), { status: 'found', ancestors: ['src', 'src/a'] })
  assert.deepEqual(locateTreePath(tree, 'package.json'), { status: 'found', ancestors: [] })
  assert.equal(normalizeTreePath('/src\\a//b.ts'), 'src/a/b.ts')
})

test('locating distinguishes missing paths, directories and paths past the Host depth limit', () => {
  assert.deepEqual(locateTreePath(tree, 'src/a/gone.ts'), { status: 'missing', ancestors: ['src', 'src/a'] })
  assert.deepEqual(locateTreePath(tree, 'nope/x.ts'), { status: 'missing', ancestors: [] })
  assert.deepEqual(locateTreePath(tree, 'package.json/x'), { status: 'missing', ancestors: [] })
  assert.deepEqual(locateTreePath(tree, 'src/a'), { status: 'directory', ancestors: ['src', 'src/a'] })
  assert.deepEqual(locateTreePath(tree, 'src/a/limit/deeper/x.ts'), { status: 'beyond-tree', ancestors: ['src', 'src/a', 'src/a/limit'] })
  assert.deepEqual(locateTreePath([], 'src/a.ts'), { status: 'missing', ancestors: [] })
})

test('file-name search is case-insensitive, file-only, ordered and bounded without inventing results', () => {
  assert.deepEqual(searchTreeFiles(tree, ' TARGET ').matches.map(node => node.path), ['src/a/Target.ts', 'src/target.md'])
  assert.deepEqual(searchTreeFiles(tree, 'limit'), { matches: [], total: 0 })
  assert.deepEqual(searchTreeFiles(tree, '   '), { matches: [], total: 0 })
  const limited = searchTreeFiles(tree, 't', 1)
  assert.equal(limited.matches.length, 1)
  assert.equal(limited.total, 2)
})
