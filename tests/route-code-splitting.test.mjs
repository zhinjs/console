import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// #64 `route-code-splitting`: every page was statically imported by registerBuiltinShell.tsx, so the sign-in
// page downloaded all of them — including xterm, used only by 运维 → 终端.
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const shell = read('registerBuiltinShell.tsx')

const LAZY = {
  OpsTerminalPage: './pages/ops/terminal',
  FileManagePage: './pages/files',
  DatabasePage: './pages/database/database-page',
  IntrospectionPage: './pages/introspection',
  PersonalModelsPage: './pages/personal-models',
}

test('the heavy, deep pages load on first visit; their routes stay as they were', () => {
  for (const [name, path] of Object.entries(LAZY)) {
    assert.ok(shell.includes(`const ${name} = lazyPage(() => import('${path}'))`), `${name} is loaded on demand`)
    assert.doesNotMatch(shell, new RegExp(`^import ${name} from`, 'mu'), `${name} is not imported statically`)
    assert.match(shell, new RegExp(`element: <${name} />`), `${name} keeps its route element`)
  }
})

test('首页 stays in the first screen', () => {
  assert.match(shell, /^import HomePage from '\.\/pages\/dashboard'$/mu)
})

test('a lazy page shows the shared loading state while its code downloads', () => {
  const helper = read('lazy-page.tsx')
  assert.match(helper, /const Page = lazy\(load\)/)
  assert.match(helper, /<Suspense fallback=\{<StatusState kind="loading" \/>\}><Page \/><\/Suspense>/)
})
