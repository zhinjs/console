import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const root = new URL('../console-ui/src/', import.meta.url)
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = (source, fileName) => ts.transpileModule(source, {
 fileName, compilerOptions: {module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText
const sectionsUrl = new URL('navigation-sections.mjs',root).href
const routesUrl = new URL('console-routes.mjs',root).href
// The taxonomy imports the sections module relatively; a data: URL needs it absolute.
const taxonomy = await import(moduleUrl(compile(await readFile(new URL('navigation-taxonomy.ts',root),'utf8'),'navigation-taxonomy.ts').replace("'./navigation-sections.mjs'",JSON.stringify(sectionsUrl))))
const {NAV_GROUPS,NAV_GROUP_ORDER,placePluginRoute} = taxonomy
const {CONSOLE_PATHS,LEGACY_ROUTE_REDIRECTS} = await import(routesUrl)
const {routeSectionId} = await import(sectionsUrl)

test('six sections in ADR 0052 order, while legacy plugin group values stay available', () => {
 assert.deepEqual(NAV_GROUP_ORDER,['概览','会话','功能','插件','运维','访问控制'])
 assert.equal(NAV_GROUPS.OVERVIEW,'概览')
 assert.equal(NAV_GROUPS.OPS,'运维')
 assert.equal(NAV_GROUPS.ACCESS,'访问控制')
 assert.equal(NAV_GROUPS.BOT,'机器人')
 assert.equal(NAV_GROUPS.ADVANCED,'高级')
})

test('Sandbox lands in 会话 and ungrouped plugin pages default to 功能 without mutating provider input', () => {
 const element = {}, sandbox = {path:'/sandbox',name:'会话',element,meta:{fullWidth:true}}
 const placed = placePluginRoute(sandbox)
 assert.equal(placed.meta.group,NAV_GROUPS.WORK)
 assert.equal(placed.meta.order,0)
 assert.equal(placed.element,element)
 assert.equal(placed.meta.fullWidth,true)
 assert.deepEqual(sandbox.meta,{fullWidth:true})
 const calendar = {path:'/calendar',name:'日历',meta:{order:23,titleI18n:{en:'Calendar'}}}
 const plugin = placePluginRoute(calendar)
 assert.equal(plugin.meta.group,NAV_GROUPS.FEATURES)
 assert.equal(plugin.meta.order,23)
 assert.deepEqual(plugin.meta.titleI18n,{en:'Calendar'})
})

test('a declared metadata.section (id or label) wins over the group; unknown sections are ignored', () => {
 const route = {path:'/backup',name:'备份',meta:{group:'My tools',order:3}}
 assert.equal(placePluginRoute(route,'ops').meta.group,'运维')
 assert.equal(placePluginRoute(route,'运维').meta.group,'运维')
 assert.equal(placePluginRoute({...route,meta:{...route.meta,section:'overview'}}).meta.group,'概览')
 assert.equal(placePluginRoute(route,'nowhere'),route)
 assert.equal(placePluginRoute(route,'ops').meta.order,3)
 assert.equal(route.meta.group,'My tools')
 // The sidebar reads the same declaration from route metadata.
 assert.equal(routeSectionId({path:'/x',meta:{section:'plugins',group:'运维'}}),'plugins')
})

test('explicit third-party navigation groups and pathless registrations stay unchanged; non-section groups show under 功能', () => {
 for (const group of ['团队应用','机器人','高级']) {
  const route = {path:'/calendar',meta:{group,order:7}}
  assert.equal(placePluginRoute(route),route)
  assert.equal(routeSectionId(route),'features')
 }
 assert.equal(routeSectionId({path:'/p',meta:{group:'插件'}}),'plugins')
 const route = {name:'Deferred page'}
 assert.equal(placePluginRoute(route),route)
 assert.equal(placePluginRoute(route,'ops'),route)
})

// Execute the real registration function with lightweight page identifiers;
// the navigation contract does not require mounting each page's data requests.
async function registeredBuiltinRoutes() {
 const source = ts.createSourceFile('registerBuiltinShell.tsx',await readFile(new URL('registerBuiltinShell.tsx',root),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX)
 const imports = source.statements.filter(ts.isImportDeclaration)
 const defaults = imports.flatMap(statement=>[...(statement.importClause?.name ? [statement.importClause.name.text] : []),...(statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings.elements.map(item=>item.name.text).filter(name=>name==='LegacyRedirect') : [])])
 const declarations = defaults.map(name=>`const ${name}=${JSON.stringify(name)};`).join('\n')
 const body = source.statements.filter(statement=>!ts.isImportDeclaration(statement)).map(statement=>ts.createPrinter().printNode(ts.EmitHint.Unspecified,statement,source)).join('\n')
 let code = compile(`${declarations}\nconst NAV_GROUPS=${JSON.stringify(NAV_GROUPS)};\nconst P=${JSON.stringify(CONSOLE_PATHS)},LEGACY_ROUTE_REDIRECTS=${JSON.stringify(LEGACY_ROUTE_REDIRECTS)};\nconst REPLAY_PERMISSION='replay',AMBIENT_STATUS_PERMISSION='ambient',SKILLS_STATUS_PERMISSION='skills';\nexport const routes=[]; const app={addRoute:route=>routes.push(route)};\n${body}`,'registerBuiltinShell.tsx')
 code = code.replace('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime')))
 const registration = await import(moduleUrl(code))
 registration.registerBuiltinConsolePages()
 return registration.routes
}

test('builtin route regrouping preserves deep links, hidden detail ownership and permission declarations', async () => {
 const routes = await registeredBuiltinRoutes()
 const byPath = new Map(routes.map(route=>[route.path,route]))
 const expected = {
  '/dashboard':'OVERVIEW','/logs':'OVERVIEW','/agent/workbench':'OVERVIEW','/agent/replay':'OVERVIEW','/agent/usage':'OVERVIEW',
  '/scope':'WORK','/scope/:adapter':'WORK','/scope/:adapter/:endpoint':'WORK','/scope/:adapter/:endpoint/:conversation':'WORK','/agent/sessions':'WORK',
  '/features':'FEATURES','/features/global/:plugin':'FEATURES','/features/ai':'FEATURES','/features/ai/skills':'FEATURES','/features/ai/ambient':'FEATURES',
  '/features/ai/workrooms':'FEATURES','/features/ai/workrooms/catalog':'FEATURES','/introspection':'FEATURES','/permissions':'FEATURES',
  '/scenario-lab':'FEATURES','/use-cases/group-welcome':'FEATURES',
  '/plugins':'PLUGINS','/plugins/:name':'PLUGINS','/marketplace':'PLUGINS',
  '/ops/database':'OPS','/ops/config':'OPS','/ops/env':'OPS','/ops/schedules':'OPS','/ops/files':'OPS','/ops/instance':'OPS','/ops/terminal':'OPS',
  '/onboarding':'OVERVIEW','/account':'OVERVIEW',
  '/access/users':'ACCESS','/access/roles':'ACCESS','/access/tokens':'ACCESS','/access/audit':'ACCESS',
 }
 const pages = routes.filter(route=>!Object.hasOwn(LEGACY_ROUTE_REDIRECTS,route.path))
 assert.deepEqual(pages.map(route=>route.path).sort(),Object.keys(expected).sort())
 for (const [path,group] of Object.entries(expected)) assert.equal(byPath.get(path).meta.group,NAV_GROUPS[group],path)
 for (const [path,parent] of [['/plugins/:name','/plugins'],['/agent/replay','/agent/workbench'],['/permissions','/introspection'],['/features/ai/workrooms/catalog','/features/ai/workrooms'],['/scope/:adapter','/scope'],['/use-cases/group-welcome','/features'],['/features/global/:plugin','/features'],['/scope/:adapter/:endpoint','/scope/:adapter'],['/scope/:adapter/:endpoint/:conversation','/scope/:adapter/:endpoint']]) {
  assert.equal(byPath.get(path).parent,parent,path)
  assert.equal(byPath.get(path).meta.hideInMenu,true,path)
 }
 assert.deepEqual(byPath.get('/agent/replay').requiredPermissions,['replay'])
 assert.deepEqual(byPath.get('/features/ai/ambient').requiredPermissions,['ambient'])
 assert.deepEqual(byPath.get('/features/ai/skills').requiredPermissions,['skills'])
 assert.deepEqual(byPath.get('/agent/usage').requiredPermissions,['control:read'])
 // Onboarding and personal settings are reached from the banner and the top bar, not the sidebar.
 for (const path of ['/onboarding','/account']) assert.equal(byPath.get(path).meta.hideInMenu,true,path)
 // 访问控制 holds exactly the four ADR 0049 pages.
 assert.deepEqual(pages.filter(route=>routeSectionId(route)==='access').map(route=>route.path),['/access/users','/access/roles','/access/tokens','/access/audit'])
})

test('every old route is registered as a hidden redirect to its new place', async () => {
 const routes = await registeredBuiltinRoutes()
 for (const [path,rule] of Object.entries(LEGACY_ROUTE_REDIRECTS)) {
  const route = routes.find(item=>item.path===path)
  assert.ok(route,path)
  assert.equal(route.meta.hideInMenu,true,path)
  assert.equal(route.parent,rule.to,path)
  assert.equal(route.element.type,'LegacyRedirect',path)
  assert.ok(routes.some(item=>item.path===rule.to && !Object.hasOwn(LEGACY_ROUTE_REDIRECTS,item.path)),`${path} -> ${rule.to} is a registered page`)
 }
 for (const path of ['/config','/env','/files','/database','/tasks','/cron','/assistant/jobs','/agent/models','/agent/skills','/agent/ambient','/agent/workrooms','/agent/workrooms/catalog','/endpoints','/endpoints/:adapter/:endpointId','/features/adapters','/features/adapters/:adapter','/features/adapters/:adapter/endpoints/:endpoint','/features/adapters/:adapter/endpoints/:endpoint/conversations/:conversation']) assert.ok(Object.hasOwn(LEGACY_ROUTE_REDIRECTS,path),path)
})
