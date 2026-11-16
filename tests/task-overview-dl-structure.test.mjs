import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const file = new URL('../console-ui/src/pages/TaskOverview.tsx', import.meta.url)
const source = readFileSync(file, 'utf8')
const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

/** JSX elements named `tag`, with the tags of their element children (fragments flattened). */
function elements(tag) {
  const found = []
  const name = node => (ts.isJsxElement(node) ? node.openingElement.tagName : ts.isJsxSelfClosingElement(node) ? node.tagName : null)?.getText(ast)
  const children = node => {
    const out = []
    const walk = child => {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) { out.push(name(child)); return }
      if (ts.isJsxFragment(child)) { child.children.forEach(walk); return }
      ts.forEachChild(child, walk)
    }
    if (ts.isJsxElement(node)) node.children.forEach(walk)
    return out
  }
  const visit = node => {
    if (name(node) === tag) found.push({ node, children: children(node), text: node.getText(ast) })
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return found
}

test('every <dl> on the task overview holds only <dt> / <dd> pairs', () => {
  const lists = elements('dl')
  assert.ok(lists.length > 0)
  for (const list of lists) {
    assert.deepEqual([...new Set(list.children)].sort(), ['dd', 'dt'], `a <dl> contains ${list.children.join(', ')}`)
  }
})

test('a phone card is an <article> whose title comes before its definition list', () => {
  const cards = elements('article').filter(card => card.text.includes('console-task-overview-card'))
  assert.equal(cards.length, 1)
  assert.deepEqual(cards[0].children, ['h3', 'dl'])
  // Layout is kept with existing utilities on the list, not new stylesheet rules.
  assert.match(cards[0].text, /<dl className="col-span-full grid grid-cols-subgrid gap-y-1">/)
})
