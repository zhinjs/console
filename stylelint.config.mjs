/**
 * Style rules of the component library (ADR 0063 D20, `@zhin.js/console-ui/stylelint`).
 *
 * `console/motion-tokens` is an error: every transition and animation reads the motion tokens
 * (--console-motion-fast / -base / -slow, --console-ease-out; zhinjs/console#125).
 * `console/no-unknown-tokens` is an error: `--console-*` names belong to @zhin.js/console-ui; the
 * Console's own tokens use the `--zc-` prefix. `console/no-deprecated-tokens` is an error: the
 * Console reads the successors of the P1b aliases. The other rules are warnings while the Console's
 * stylesheets move onto the library's scale (`pnpm lint:css:all` lists them); CI runs
 * `pnpm lint:css`, which fails on errors only.
 *
 * `semanticOnly: false`: the Console's own stylesheets may read the base scale (--console-space-3,
 * --console-radius-2, --console-border-hairline, --console-elevation-2, …) as well as the semantic
 * tokens. The successors of the old aliases are base-scale tokens (`--console-radius-md` →
 * `--console-radius-2`), and the move off literal sizes maps each value to the nearest step of the
 * scale; choosing a semantic token per declaration is a design change per component, not part of
 * the lint cleanup.
 */
import { createConsoleStylelintConfig } from '@zhin.js/console-ui/stylelint'

const config = createConsoleStylelintConfig({
  // The global shell may use @media; pages and components use container queries.
  shellFiles: ['console-ui/src/shell\\.css$', 'console-ui/src/layouts/'],
  semanticOnly: false,
  // Verbatim copy of highlight.js's GitHub Dark theme (tests/files-code-highlight.test.mjs checks it
  // declaration by declaration), so it keeps the upstream values.
  ignoreFiles: ['console-ui/src/pages/files/github-dark-scoped.css'],
  deprecatedTokens: 'error',
  motionTokens: 'error',
})

const warn = rule => {
  const value = config.rules[rule]
  const [enabled, options = {}] = Array.isArray(value) ? value : [value]
  return [enabled, { ...options, severity: 'warning' }]
}

export default {
  ...config,
  rules: {
    ...config.rules,
    'console/scale-values': warn('console/scale-values'),
    'console/media-queries': warn('console/media-queries'),
  },
}
