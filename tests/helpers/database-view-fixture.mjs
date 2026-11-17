/**
 * Renders the database views (related-table-view.tsx, document-collection-view.tsx) without React: a
 * minimal hooks runtime, the TSX transpiled to CommonJS, and helpers to walk the returned element tree.
 * Shared by tests/database-record-query.test.mjs and tests/database-insert-unknown-outcome.test.mjs.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from '../locale-fixture.mjs'

// Minimal hooks runtime that runs effects when their deps change, so the views load like in React.
export function runtime() {
  const slots = []; let cursor = 0, dirty = false, render, value, pending = []
  const hooks = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], next => { const result = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(result, slots[i])) { slots[i] = result; dirty = true } }]
    },
    useMemo(fn, deps) {
      const i = cursor++, old = slots[i]
      if (old && deps.every((item, k) => Object.is(item, old.deps[k]))) return old.value
      slots[i] = { deps, value: fn() }; return slots[i].value
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i]
      if (old && deps.every((item, k) => Object.is(item, old.deps[k]))) return
      slots[i] = { deps }; pending.push(fn)
    },
  }
  const api = {
    hooks,
    mount(fn) { render = fn; api.render(); return api },
    render() {
      let count = 0
      do {
        assert.ok(++count < 30, 'render must settle')
        do { dirty = false; cursor = 0; value = render() } while (dirty)
        const effects = pending; pending = []
        for (const effect of effects) effect()
      } while (dirty || pending.length)
      return value
    },
    async settle() { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); api.render() } },
    get value() { return value },
  }
  return api
}

export const elements = value => value && typeof value === 'object'
  ? [value, ...[value.props?.children].flat(Infinity).flatMap(elements)]
  : []
export const text = value => value == null || typeof value === 'boolean' ? ''
  : typeof value !== 'object' ? String(value)
  : Array.isArray(value) ? value.map(text).join('')
  : text(value.props?.children)

export function compileView(source, mocks, from) {
  const requireFromPage = createRequire(from)
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : requireFromPage(name), module.exports, module)
  return module.exports
}

const writeCheckUrl = new URL('../../console-ui/src/pages/database/write-check.tsx', import.meta.url)
const writeCheckSource = readFileSync(writeCheckUrl, 'utf8')

/** The real write-check.tsx (useWriteCheck / WriteCheckNotice) on the same hooks runtime `r`. */
export function writeCheckModule(r) {
  return compileView(writeCheckSource, {
    react: { ...r.hooks },
    '@zhin.js/console-ui': { Alert: 'div', AlertDescription: 'div', AlertTitle: 'h3', Button: 'button' },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
  }, writeCheckUrl)
}

/**
 * Renders nested function components of an element tree in place (they must not use React hooks
 * beyond what `r.hooks` provides in call order), so their text and buttons can be found.
 */
export function expand(value) {
  if (Array.isArray(value)) return value.map(expand)
  if (!value || typeof value !== 'object' || !('props' in value)) return value
  if (typeof value.type === 'function') return expand(value.type(value.props))
  const children = value.props?.children
  return children === undefined ? value : { ...value, props: { ...value.props, children: expand(children) } }
}
