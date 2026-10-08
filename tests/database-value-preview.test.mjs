import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { valuePreview, fullValueText } from '../console-ui/src/pages/database/record-value-preview.mjs'

const componentFile = new URL('../console-ui/src/pages/database/RecordValueDisclosure.tsx', import.meta.url)
const compiled = ts.transpileModule(await readFile(componentFile, 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/(['"])react\/jsx-runtime\1/g, JSON.stringify(import.meta.resolve('react/jsx-runtime')))
  .replace(/(['"])react\1/g, JSON.stringify(import.meta.resolve('react')))
  .replace(/(['"])\.\/record-value-preview\.mjs\1/g, JSON.stringify(new URL('../console-ui/src/pages/database/record-value-preview.mjs', import.meta.url).href))
const { RecordValueDisclosure } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))

test('document summaries separate identity and bounded fields without expanding nested values', () => {
  const document = { _id: 'doc-1', name: 'Example', nested: { fullBody: 'full-nested-body' }, items: [1, 2], additional: true }
  const summary = valuePreview(document, 140, ['_id'])
  assert.match(summary, /name: Example/)
  assert.match(summary, /对象 · 1 个字段/)
  assert.match(summary, /数组 · 2 项/)
  assert.match(summary, /另 1 个字段/)
  assert.doesNotMatch(summary, /doc-1|full-nested-body/)
  assert.equal(document.nested.fullBody, 'full-nested-body')
})

test('long text preview is bounded while full content and scalar types remain lossless', () => {
  const value = 'first line\n' + 'x'.repeat(250) + '\nlast line'
  assert.ok(valuePreview(value).length <= 140)
  assert.match(valuePreview(value), /…$/)
  assert.equal(fullValueText(value), value)
  assert.equal(valuePreview(null), 'null')
  assert.equal(valuePreview(false), 'false')
  assert.equal(valuePreview(0), '0')
  assert.equal(fullValueText({ enabled: false, count: 0 }), '{\n  "enabled": false,\n  "count": 0\n}')
})

test('initial disclosure renders only a summary and a closed accessible expansion entry', () => {
  const html = renderToStaticMarkup(React.createElement(RecordValueDisclosure, {
    value: { nested: { body: 'complete-value-only-after-expansion' } }, label: '查看完整 JSON',
  }))
  assert.match(html, /<details/)
  assert.match(html, /查看完整 JSON/)
  assert.doesNotMatch(html, /<pre|complete-value-only-after-expansion|open=""/)
})
