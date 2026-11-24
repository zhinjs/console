import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// #64 `plugin-detail-updates-refetch`: the plugin page read 「可更新」 (`/api/marketplace/updates`,
// which on a real Host queries the npm registry) once with the route name, then again once the
// instance was read and `packageName` became `plugin.packageName`, because the read depended on it.
const source = readFileSync(new URL('../console-ui/src/pages/plugin-detail.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('plugin-detail.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

/** The useOptionalRead(...) call whose loader requests `/api/marketplace/updates`. */
function updatesRead() {
  let found = null
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText() === 'useOptionalRead' && node.arguments[1]?.getText().includes('/api/marketplace/updates')) found = node
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

test('the updates list is read once: the read depends on neither the package name nor the instance', () => {
  const call = updatesRead()
  assert.ok(call, 'the plugin page still reads /api/marketplace/updates')
  const [enabled, loader, deps] = call.arguments
  assert.ok(ts.isArrayLiteralExpression(deps))
  const names = deps.elements.map(element => element.getText())
  assert.ok(!names.some(name => /packageName|plugin/.test(name)), `deps: ${names.join(', ')}`)
  assert.doesNotMatch(enabled.getText(), /packageName|plugin\b/, 'enabled does not flip when the instance arrives')
  assert.doesNotMatch(loader.getText(), /packageName/, 'the loader keeps the whole list; the package is picked when rendering')
})

test('the package\'s own update is picked from the list when rendering', () => {
  assert.match(source, /updates\.value\.find\(item => item\.name === packageName\)/)
})
