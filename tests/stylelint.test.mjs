// The component library's style rules (@zhin.js/console-ui/stylelint, ADR 0063 D20) on the Console.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import stylelint from 'stylelint'
import config from '../stylelint.config.mjs'

const root = new URL('../', import.meta.url)

test('motion, unknown and deprecated tokens are errors, the other library rules warn while the Console moves onto the scale', async () => {
  const { results: [result] } = await stylelint.lint({
    code: '.a { transition: color 150ms ease; padding: 1rem; } .b { animation: spin var(--console-motion-loop) var(--console-ease-out) infinite; } .c { color: var(--zc-own-token); border-radius: var(--console-radius-md); margin: var(--console-space-3); }',
    codeFilename: 'console-ui/src/pages/sample.css', config,
  })
  const by = rule => result.warnings.filter(warning => warning.rule === rule).map(warning => warning.severity)
  assert.deepEqual(new Set(by('console/motion-tokens')), new Set(['error']))
  assert.ok(by('console/motion-tokens').length >= 1)
  assert.deepEqual(by('console/scale-values'), ['warning'])
  // `--console-*` is the library's namespace; the Console's own tokens are `--zc-*`.
  assert.deepEqual(by('console/no-unknown-tokens'), ['error'])
  assert.deepEqual(by('console/no-deprecated-tokens'), ['error'])
})

test('the Console stylesheets pass with no errors (pnpm lint:css)', async () => {
  const { results } = await stylelint.lint({ files: ['console-ui/src/**/*.css', 'client/**/*.css'], cwd: new URL('.', root).pathname, config, quiet: true })
  assert.ok(results.length >= 40, `${results.length} stylesheets`)
  const errors = results.flatMap(result => result.warnings.filter(warning => warning.severity === 'error').map(warning => `${result.source}:${warning.line} ${warning.text}`))
  assert.deepEqual(errors, [])
})

test('lint:css runs in CI and in the Pages deployment', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  assert.match(manifest.scripts['lint:css'], /^stylelint .* --quiet$/)
  for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/pages.yml']) {
    assert.match(readFileSync(new URL(workflow, root), 'utf8'), /- run: pnpm lint:css\n/, workflow)
  }
})
