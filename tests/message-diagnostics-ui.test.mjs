import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let source = ts.transpileModule(await readFile(new URL('../console-ui/src/pages/endpoint-detail/RenderingDiagnostics.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
for (const specifier of ['react/jsx-runtime', './rendering-diagnostics.mjs']) {
  const resolved = specifier.startsWith('.') ? new URL('../console-ui/src/pages/endpoint-detail/rendering-diagnostics.mjs', import.meta.url).href : import.meta.resolve(specifier)
  source = source.replaceAll(`"${specifier}"`, JSON.stringify(resolved)).replaceAll(`'${specifier}'`, JSON.stringify(resolved))
}
const { RenderingDiagnostics } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const rendering = { forms: ['text'], fallbacks: ['renderer_failed'] }

test('diagnostic projection does not present suppressed or failed content conversion as Endpoint delivery proof', () => {
  const html = renderToStaticMarkup(React.createElement(RenderingDiagnostics, { rendering, projection: true }))
  assert.match(html, /出站投影/); assert.match(html, /不能据此证明 Endpoint 已发送或平台已接收/)
  assert.match(html, /截图渲染失败/)
  assert.doesNotMatch(html, /传给 Endpoint|实际发送渲染诊断|最终发送链路记录/)
})

test('existing successful-message diagnostics keep their established labels; missing evidence renders no claim', () => {
  const html = renderToStaticMarkup(React.createElement(RenderingDiagnostics, { rendering }))
  assert.match(html, /传给 Endpoint/); assert.match(html, /最终发送链路记录/)
  assert.equal(renderToStaticMarkup(React.createElement(RenderingDiagnostics, { projection: true })), '')
})
