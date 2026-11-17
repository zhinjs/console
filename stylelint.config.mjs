/**
 * Style rules of the component library (ADR 0063 D20, `@zhin.js/console-ui/stylelint`).
 *
 * `console/motion-tokens` is an error: every transition and animation reads the motion tokens
 * (--console-motion-fast / -base / -slow, --console-ease-out; zhinjs/console#125). The other rules
 * are warnings while the Console's stylesheets move onto the library's scale and token names
 * (`pnpm lint:css:all` lists them); CI runs `pnpm lint:css`, which fails on errors only.
 */
import { createConsoleStylelintConfig } from '@zhin.js/console-ui/stylelint'

const config = createConsoleStylelintConfig({
  // The global shell may use @media; pages and components use container queries.
  shellFiles: ['console-ui/src/shell\\.css$', 'console-ui/src/layouts/'],
  deprecatedTokens: 'warning',
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
    'console/no-unknown-tokens': warn('console/no-unknown-tokens'),
    'console/media-queries': warn('console/media-queries'),
  },
}
