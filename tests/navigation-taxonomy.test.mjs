import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const root = new URL('../console-ui/src/', import.meta.url)
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = (source, fileName) => ts.transpileModule(source, {
 fileName, compilerOptions: {module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText
const taxonomy = await import(moduleUrl(compile(await readFile(new URL('navigation-taxonomy.ts',root),'utf8'),'navigation-taxonomy.ts')))
const {NAV_GROUPS,PRIMARY_NAV_GROUP_ORDER,FOOTER_NAV_GROUP_ORDER,NAV_GROUP_ORDER,placePluginRoute} = taxonomy

test('work and management navigation have distinct ordered groups without changing legacy plugin values', () => {
 assert.deepEqual(PRIMARY_NAV_GROUP_ORDER,['会话','任务','聊天账号','插件'])
 assert.deepEqual(FOOTER_NAV_GROUP_ORDER,['设置','运行维护'])
 assert.deepEqual(NAV_GROUP_ORDER,[...PRIMARY_NAV_GROUP_ORDER,...FOOTER_NAV_GROUP_ORDER])
 assert.equal(NAV_GROUPS.BOT,'机器人')
 assert.equal(NAV_GROUPS.ADVANCED,'高级')
})

test('Sandbox and ungrouped plugin pages get work placement without mutating provider input', () => {
 const element = {}, sandbox = {path:'/sandbox',name:'会话',element,meta:{fullWidth:true}}
 const placed = placePluginRoute(sandbox)
 assert.equal(placed.meta.group,NAV_GROUPS.WORK)
 assert.equal(placed.meta.order,0)
 assert.equal(placed.element,element)
 assert.equal(placed.meta.fullWidth,true)
 assert.deepEqual(sandbox.meta,{fullWidth:true})
 const calendar = {path:'/calendar',name:'日历',meta:{order:23,titleI18n:{en:'Calendar'}}}
 const plugin = placePluginRoute(calendar)
 assert.equal(plugin.meta.group,NAV_GROUPS.PLUGINS)
 assert.equal(plugin.meta.order,23)
 assert.deepEqual(plugin.meta.titleI18n,{en:'Calendar'})
})

test('explicit third-party navigation groups and pathless registrations stay unchanged', () => {
 for (const group of ['团队应用','机器人','高级']) {
  const route = {path:'/calendar',meta:{group,order:7}}
  assert.equal(placePluginRoute(route),route)
 }
 const route = {name:'Deferred page'}
 assert.equal(placePluginRoute(route),route)
})

// Execute the real registration function with lightweight page identifiers;
// the navigation contract does not require mounting each page's data requests.
async function registeredBuiltinRoutes() {
 const source = ts.createSourceFile('registerBuiltinShell.tsx',await readFile(new URL('registerBuiltinShell.tsx',root),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX)
 const imports = source.statements.filter(ts.isImportDeclaration)
 const defaults = imports.flatMap(statement=>statement.importClause?.name ? [statement.importClause.name.text] : [])
 const declarations = defaults.map(name=>`const ${name}=${JSON.stringify(name)};`).join('\n')
 const body = source.statements.filter(statement=>!ts.isImportDeclaration(statement)).map(statement=>ts.createPrinter().printNode(ts.EmitHint.Unspecified,statement,source)).join('\n')
 let code = compile(`${declarations}\nconst NAV_GROUPS=${JSON.stringify(NAV_GROUPS)};\nconst REPLAY_PERMISSION='replay',AMBIENT_STATUS_PERMISSION='ambient',SKILLS_STATUS_PERMISSION='skills';\nexport const routes=[]; const app={addRoute:route=>routes.push(route)};\n${body}`,'registerBuiltinShell.tsx')
 code = code.replace('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime')))
 const registration = await import(moduleUrl(code))
 registration.registerBuiltinConsolePages()
 return registration.routes
}

test('builtin route regrouping preserves deep links, hidden detail ownership and permission declarations', async () => {
 const routes = await registeredBuiltinRoutes()
 const byPath = new Map(routes.map(route=>[route.path,route]))
 const expected = {
  '/dashboard':'OPERATIONS','/logs':'OPERATIONS','/tasks':'TASKS','/use-cases/group-welcome':'TASKS','/cron':'TASKS',
  '/endpoints':'ACCOUNTS','/agent/workbench':'OPERATIONS','/agent/replay':'OPERATIONS','/agent/ambient':'SETTINGS','/agent/skills':'SETTINGS',
  '/agent/usage':'OPERATIONS','/agent/workrooms':'TASKS','/agent/workrooms/catalog':'TASKS','/scenario-lab':'OPERATIONS','/introspection':'OPERATIONS',
  '/permissions':'OPERATIONS','/agent/sessions':'WORK','/plugins':'PLUGINS','/plugins/:name':'PLUGINS','/marketplace':'PLUGINS',
  '/config':'SETTINGS','/env':'SETTINGS','/files':'OPERATIONS','/database':'OPERATIONS','/endpoints/:adapter/:endpointId':'ACCOUNTS',
 }
 assert.deepEqual([...byPath.keys()].sort(),Object.keys(expected).sort())
 for (const [path,group] of Object.entries(expected)) assert.equal(byPath.get(path).meta.group,NAV_GROUPS[group],path)
 for (const [path,parent] of [['/plugins/:name','/plugins'],['/agent/replay','/agent/workbench'],['/permissions','/introspection'],['/agent/workrooms/catalog','/agent/workrooms'],['/endpoints/:adapter/:endpointId','/endpoints'],['/use-cases/group-welcome','/tasks']]) {
  assert.equal(byPath.get(path).parent,parent)
  assert.equal(byPath.get(path).meta.hideInMenu,true)
 }
 assert.deepEqual(byPath.get('/agent/replay').requiredPermissions,['replay'])
 assert.deepEqual(byPath.get('/agent/ambient').requiredPermissions,['ambient'])
 assert.deepEqual(byPath.get('/agent/skills').requiredPermissions,['skills'])
 assert.deepEqual(byPath.get('/agent/usage').requiredPermissions,['control:read'])
})
