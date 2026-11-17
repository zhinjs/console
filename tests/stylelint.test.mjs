// The component library's style rules (@zhin.js/console-ui/stylelint, ADR 0063 D20) on the Console.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import stylelint from 'stylelint'
import config from '../stylelint.config.mjs'

const root = new URL('../', import.meta.url)

test('every library rule is an error on the Console stylesheets', async () => {
  const { results: [result] } = await stylelint.lint({
    code: '.a { transition: color 150ms ease; padding: 1rem; } .b { animation: spin var(--console-motion-loop) var(--console-ease-out) infinite; } .c { color: var(--zc-own-token); border-radius: var(--console-radius-md); margin: var(--console-space-3); } @media (max-width: 767px) { .d { display: none; } } @container (width < 48rem) { .e { display: none; } }',
    codeFilename: 'console-ui/src/pages/sample.css', config,
  })
  const by = rule => result.warnings.filter(warning => warning.rule === rule).map(warning => warning.severity)
  assert.deepEqual(new Set(by('console/motion-tokens')), new Set(['error']))
  assert.ok(by('console/motion-tokens').length >= 1)
  // The base scale is allowed (semanticOnly: false); literals are not.
  assert.deepEqual(by('console/scale-values'), ['error'])
  // `--console-*` is the library's namespace; the Console's own tokens are `--zc-*`.
  assert.deepEqual(by('console/no-unknown-tokens'), ['error'])
  assert.deepEqual(by('console/no-deprecated-tokens'), ['error'])
  // Pages use container queries with the Console breakpoints; @media is for the shell files.
  assert.deepEqual(by('console/media-queries'), ['error'])
})

test('the shell files may use @media, but only with the Console breakpoints', async () => {
  const lint = async code => (await stylelint.lint({ code, codeFilename: 'console-ui/src/shell.css', config })).results[0].warnings.map(warning => `${warning.rule} ${warning.severity}`)
  assert.deepEqual(await lint('@media (width < 48rem) { .a { display: none; } } @media (prefers-reduced-motion: reduce) { .b { animation: none; } }'), [])
  assert.deepEqual(await lint('@media (max-width: 767px) { .a { display: none; } }'), ['console/media-queries error'])
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
