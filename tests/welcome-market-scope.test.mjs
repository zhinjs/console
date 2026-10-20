import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { mutationRequest } from '../console-ui/src/pages/plugin-management-model.mjs'
import { reconcileInstall, canResumeInstall, planInstallRecovery } from '../console-ui/src/pages/marketplace-install-model.mjs'

const source = await readFile(new URL('../console-ui/src/pages/marketplace.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('marketplace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MarketplaceSession')
const last = component.body.statements.at(-1); assert.ok(ts.isReturnStatement(last))
// Execute the production component's actual handlers; replace only its final JSX return with a test access port.
const body = source.slice(component.getStart(ast), last.getStart(ast))
  + 'return {setInstallPlan,setUncertainPackage,pendingInstalls,commitInstall,resumeInstall,installedState}; }'
const compiled = ts.transpileModule(body + '\nexports.Session=MarketplaceSession;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const fixture = JSON.parse(await readFile(new URL('./fixtures/welcome-flow-provider.json', import.meta.url), 'utf8'))
function setup() {
  const slots = [], calls = []; let cursor = 0, active = 'scope-a', controls
  const bindings = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useCallback: fn => fn, useMemo: fn => fn(), useEffect() {},
    useToast: () => ({ error() {} }), useSearchParams: () => [new URLSearchParams()], isDemoMode: () => false,
    isInboxCacheScopeActive: scope => scope === active,
    requestConsole: input => new Promise((resolve, reject) => calls.push({ input, scope: active, resolve, reject })),
    mutationRequest, reconcileInstall, canResumeInstall, planInstallRecovery, PAGE_SIZE: 20,
    apiFetch: async () => ({ ok: true, json: async () => ({ success: true, data: [] }) }),
  }
  const module = { exports: {} }
  new Function(...Object.keys(bindings), 'exports', compiled)(...Object.values(bindings), module.exports)
  const render = () => { cursor = 0; controls = module.exports.Session({ scope: 'scope-a' }); return controls }
  render()
  return { calls, render, get controls() { return controls }, changeCredential() { active = 'scope-b' } }
}
const plan = { packageName: fixture.applied.packageName, instanceKey: fixture.applied.instanceKey, projectRevision: fixture.initialState.projectRevision,
  configurationRevision: fixture.initialSource.revision, requestedSpec: `${fixture.applied.packageName}@${fixture.applied.version}`, targetVersion: fixture.applied.version }
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

test('real install handler does not inspect the new connection after an old submitted install settles', async () => {
  const f = setup(); f.controls.setInstallPlan(plan); f.render()
  const pending = f.controls.commitInstall(); assert.equal(f.calls[0].input.type, 'plugin:install')
  f.changeCredential(); f.calls[0].resolve({}); await pending
  assert.deepEqual(f.calls.map(call => call.input.type), ['plugin:install'])
})

test('real recovery handler cannot issue a new plan on another credential after its inspection returns', async () => {
  const f = setup(); f.controls.pendingInstalls.current.set(plan.packageName, { instanceKey: plan.instanceKey, version: plan.targetVersion })
  f.controls.setUncertainPackage(plan.packageName); f.render()
  const pending = f.controls.resumeInstall(); assert.equal(f.calls[0].input.type, 'plugin:inspect')
  f.changeCredential(); f.calls[0].resolve({ ...fixture.initialState, declared: false, published: false, status: 'installed' })
  await pending; assert.deepEqual(f.calls.map(call => call.input.type), ['plugin:inspect'])
})

test('a captured install action refuses an expired connection before creating any request', async () => {
  const f = setup(); f.controls.setInstallPlan(plan); f.render(); f.changeCredential()
  await f.controls.commitInstall(); assert.deepEqual(f.calls, [])
})

test('the same production handler still completes the original install and exact-alias readback in its own scope', async () => {
  const f = setup(); f.controls.setInstallPlan(plan); f.render()
  const pending = f.controls.commitInstall(); f.calls[0].resolve({}); await settle()
  assert.equal(f.calls[1].input.type, 'plugin:inspect'); assert.equal(f.calls[1].input.instanceKey, plan.instanceKey)
  f.calls[1].resolve(fixture.initialState); await pending
  assert.equal(f.render().installedState.instanceKey, plan.instanceKey)
})
