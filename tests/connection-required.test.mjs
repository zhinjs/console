import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport, translate } from './locale-fixture.mjs'

const require = createRequire(import.meta.url)
const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
// Anything a page entry only references (session components, models, icons) becomes an inert stub.
const stub = new Proxy(function stub() {}, { get: (_, key) => key === '__esModule' ? false : stub, apply: () => stub })
function compile(file, mocks) {
  const module = { exports: {} }
  const code = ts.transpileModule(file.source, { compilerOptions: options }).outputText
  const resolve = name => {
    if (isLocaleImport(name)) return localeModule
    if (Object.hasOwn(mocks, name)) return mocks[name]
    if (name === 'react/jsx-runtime' || name === 'react') return require(name)
    return stub
  }
  new Function('require', 'exports', 'module', code)(resolve, module.exports, module)
  return module.exports
}
const elements = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(elements)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const source = async path => ({ source: await readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8') })

test('the shared disconnected state explains the problem and its button triggers the existing re-login flow', async () => {
  const notified = []
  const { ConnectionRequiredState } = compile(await source('components/connection-required.tsx'), {
    '../utils/auth': { notifyAuthRequired: () => notified.push('auth-required') },
    './ui/button': { Button: 'button' }, './ui/card': { Card: 'card', CardContent: 'card-content' },
    './empty-state': { EmptyState: 'empty-state' }, './PageHeader': { PageHeader: 'page-header' }, './PageShell': { PageShell: 'page-shell' },
  })
  const tree = ConnectionRequiredState({ title: '项目文件' })
  assert.equal(elements(tree).find(node => node.type === 'page-header').props.title, '项目文件')
  const empty = elements(tree).find(node => node.type === 'empty-state')
  assert.equal(empty.props.title, '未连接到 Host')
  assert.match(empty.props.description, /重新登录/)
  const button = elements(tree).find(node => node.type === 'button')
  assert.equal(text(button), '重新登录')
  assert.deepEqual(notified, [])
  button.props.onClick()
  assert.deepEqual(notified, ['auth-required'])
  assert.equal(elements(ConnectionRequiredState({})).find(node => node.type === 'page-header'), undefined)
  assert.equal(translate('en', '重新登录'), 'Sign in again')
})

for (const [path, title, session] of [
  ['pages/files/files-page.tsx', '项目文件', 'FileManageSession'],
  ['pages/ambient-engagement.tsx', '群聊插话', 'AmbientEngagementSession'],
  ['pages/skills-assistant.tsx', '技能助手', 'SkillsAssistantSession'],
]) {
  test(`${path} shows the disconnected state instead of a blank page when the connection scope is gone`, async () => {
    let scope, active = false
    const relative = path.startsWith('pages/files/') ? '../../' : '../'
    const page = compile(await source(path), {
      [`${relative}utils/useInboxCacheScope`]: { useInboxCacheScope: () => scope },
      [`${relative}utils/inbox-cache`]: { isInboxCacheScopeActive: expected => active && expected === scope },
      [`${relative}components/connection-required`]: { ConnectionRequiredState: 'connection-required' },
    })
    for (const value of [undefined, 'stale-scope']) {
      scope = value
      const tree = page.default()
      assert.notEqual(tree, null, `${path} must not render nothing while disconnected`)
      assert.equal(tree.type, 'connection-required')
      assert.equal(tree.props.title, title)
    }
    scope = 'scope-a'; active = true
    const tree = page.default()
    assert.equal(tree.type.name, session)
    assert.equal(tree.key, 'scope-a')
  })
}
