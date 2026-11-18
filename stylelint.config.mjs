/**
 * Style rules of the component library (ADR 0063 D20, `@zhin.js/console-ui/stylelint`).
 *
 * `console/motion-tokens` is an error: every transition and animation reads the motion tokens
 * (--console-motion-fast / -base / -slow, --console-ease-out; zhinjs/console#125).
 * `console/no-unknown-tokens` is an error: `--console-*` names belong to @zhin.js/console-ui; the
 * Console's own tokens use the `--zc-` prefix. `console/no-deprecated-tokens` is an error: the
 * Console reads the successors of the P1b aliases. `console/scale-values` is an error: font sizes,
 * weights, spacing, radii, border widths and shadows read the scale (a value the scale cannot
 * express carries a `stylelint-disable-next-line` comment with its reason). `console/media-queries`
 * is an error: @media only in the shell files below and only with the Console breakpoints
 * (40 / 48 / 64 / 90rem, written as ranges: `@media (width < 48rem)`); @container only with the
 * breakpoints. CI runs `pnpm lint:css`; `pnpm lint:css:all` also lists warnings.
 *
 * `semanticOnly: false`: the Console's own stylesheets may read the base scale (--console-space-3,
 * --console-radius-2, --console-border-hairline, --console-elevation-2, …) as well as the semantic
 * tokens. The successors of the old aliases are base-scale tokens (`--console-radius-md` →
 * `--console-radius-2`), and the move off literal sizes maps each value to the nearest step of the
 * scale; choosing a semantic token per declaration is a design change per component, not part of
 * the lint cleanup.
 */
import { createConsoleStylelintConfig } from '@zhin.js/console-ui/stylelint'

/**
 * Stylesheets that still follow the viewport (@media) instead of their container. ADR 0063 D18 wants
 * pages and components on container queries (`@container console (…)`, the `.console-cq` that
 * PageShell sets); moving a viewport query onto a container changes where the layout switches
 * (the container is narrower than the viewport, and shell chrome, overlays and the login page sit in
 * no container), so it is done file by file, with screenshots, and the file leaves this list. Their
 * @media already use only the Console breakpoints. Do not add files: new styles use @container.
 */
const viewportFiles = [
  // Global stylesheets: the :root page tokens by viewport, print and reduced-motion resets.
  'client/style\\.css$',
  'console-ui/src/design-system\\.css$',
  // Shell chrome outside any container: top bar pill, toasts, banners, log panel, appearance menu.
  'console-ui/src/components/(connection-indicator|toast|status-surfaces|save-button)\\.css$',
  'console-ui/src/components/log-panel/log-panel\\.css$',
  'console-ui/src/theme/appearance\\.css$',
  'console-ui/src/pages/onboarding/onboarding\\.css$',
  // The login page has no shell and no container.
  'console-ui/src/pages/login\\.css$',
  // Pages and shared page styles not yet on container queries.
  'console-ui/src/(agent-playground|im-workspace|markdown-content|settings)\\.css$',
  'console-ui/src/scope/(chat-roles|object-page)\\.css$',
  'console-ui/src/pages/(admin-pages|dashboard|plugins|schedule-executions)\\.css$',
  'console-ui/src/pages/attention/attention\\.css$',
  'console-ui/src/pages/features/feature-level-panel\\.css$',
  'console-ui/src/pages/files/file-tree\\.css$',
  'console-ui/src/pages/insights/insights\\.css$',
  'console-ui/src/pages/introspection/component-gallery\\.css$',
  'console-ui/src/pages/logs/disclosure\\.css$',
  'console-ui/src/pages/ops/self-check\\.css$',
  'console-ui/src/pages/scope/(chat-panels|login-flow|records-panel|scope-pages)\\.css$',
]

const config = createConsoleStylelintConfig({
  // The global shell may use @media; pages and components use container queries.
  shellFiles: ['console-ui/src/shell\\.css$', 'console-ui/src/layouts/', ...viewportFiles],
  semanticOnly: false,
  // Verbatim copy of highlight.js's GitHub Dark theme (tests/files-code-highlight.test.mjs checks it
  // declaration by declaration), so it keeps the upstream values.
  ignoreFiles: ['console-ui/src/pages/files/github-dark-scoped.css'],
  deprecatedTokens: 'error',
  motionTokens: 'error',
})

export default config
