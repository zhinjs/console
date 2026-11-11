import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import * as usageModel from '../console-ui/src/pages/token-usage-model.mjs'

const require = createRequire(import.meta.url)

test('cards, task rows, modals and sheets use layered optical elevation instead of flat none shadows', async () => {
  const design = await readFile(new URL('../console-ui/src/design-system.css', import.meta.url), 'utf8')
  const resources = await readFile(new URL('../console-ui/src/pages/resource-pages.css', import.meta.url), 'utf8')
  assert.match(design, /--console-shadow-xl:/)
  assert.match(design, /\.console-card\s*\{[\s\S]*?box-shadow:\s*var\(--console-shadow-sm\)/)
  assert.match(design, /\.console-sheet-content\[data-side="right"\]/)
  assert.match(design, /\.console-dialog-overlay[\s\S]*?backdrop-filter:\s*blur\(6px\)/)
  assert.match(resources, /\.console-task-row\s*\{[\s\S]*?box-shadow:\s*var\(--console-shadow-xs\)/)
})

test('Sheet primitive and DialogContent drawer variant expose accessible slide-over structure', async () => {
  const dialogSource = await readFile(new URL('../console-ui/src/components/ui/dialog.tsx', import.meta.url), 'utf8')
  const sheetSource = await readFile(new URL('../console-ui/src/components/ui/sheet.tsx', import.meta.url), 'utf8')
  assert.match(dialogSource, /variant\?:\s*"modal"\s*\|\s*"drawer"/)
  assert.match(dialogSource, /console-sheet-content/)
  assert.match(dialogSource, /console-dialog-close/)
  assert.match(sheetSource, /export\s*\{[\s\S]*Sheet,[\s\S]*SheetContent,[\s\S]*SheetHeader,[\s\S]*SheetBody,[\s\S]*SheetFooter/)
})

test('upgraded Token Usage charts render rounded top stacks, area gradient fills, model cards and interactive donut readouts', async () => {
  const source = await readFile(new URL('../console-ui/src/pages/token-usage-charts.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} }
  const mocks = {
    '@zhin.js/client': { cn: (...values) => values.filter(Boolean).join(' ') },
    './token-usage-model.mjs': usageModel,
  }
  new Function('require', 'module', 'exports', compiled)(
    (name) => (isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name)),
    mod,
    mod.exports,
  )

  const colors = usageModel.buildColorMap(['openai/gpt-4o', 'anthropic/claude-sonnet-4'])
  const series = [
    { bucketStart: 0, calls: 3, inputTokens: 1200, outputTokens: 300, cacheReadTokens: 600, byModel: { 'openai/gpt-4o': 800, 'anthropic/claude-sonnet-4': 400 } },
    { bucketStart: 3600_000, calls: 2, inputTokens: 800, outputTokens: 200, cacheReadTokens: 600, byModel: { 'openai/gpt-4o': 800 } },
  ]

  const barHtml = renderToStaticMarkup(
    React.createElement(mod.exports.StackedBarChart, { series, keys: ['openai/gpt-4o', 'anthropic/claude-sonnet-4'], colors, bucket: 'hour' }),
  )
  assert.match(barHtml, /console-chart-readout/)
  assert.match(barHtml, /<path[^>]*d="M/)

  const lineHtml = renderToStaticMarkup(
    React.createElement(mod.exports.CacheLineChart, { series, bucket: 'hour', quantiles: { p50: 0.5, p90: 0.85 } }),
  )
  assert.match(lineHtml, /<linearGradient/)
  assert.match(lineHtml, /P50/)
  assert.match(lineHtml, /P90/)

  const modelHtml = renderToStaticMarkup(
    React.createElement(mod.exports.ModelBars, {
      rows: [{ provider: 'openai', model: 'gpt-4o', calls: 5, inputTokens: 2000, outputTokens: 400, cacheReadTokens: 1200 }],
      colors,
      showWrite: false,
    }),
  )
  assert.match(modelHtml, /console-model-bar-card/)

  const donutHtml = renderToStaticMarkup(
    React.createElement(mod.exports.SegmentDonut, { segments: { history: 600, fixed: 300, user: 100 } }),
  )
  assert.match(donutHtml, /console-donut-legend-card/)
  assert.match(donutHtml, /总输入/)
})
