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
const pluginPagesUrl = new URL('plugin-pages.mjs',root).href
// The taxonomy imports the sections module relatively; a data: URL needs it absolute.
const taxonomy = await import(moduleUrl(compile(await readFile(new URL('navigation-taxonomy.ts',root),'utf8'),'navigation-taxonomy.ts').replace("'./navigation-sections.mjs'",JSON.stringify(sectionsUrl)).replace("'./console-routes.mjs'",JSON.stringify(routesUrl)).replace("'./plugin-pages.mjs'",JSON.stringify(pluginPagesUrl))))
const {NAV_GROUPS,NAV_GROUP_ORDER,placePluginRoute,markPluginRoute,planPluginRoute} = taxonomy
const {describePluginPage} = await import(pluginPagesUrl)
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
 // Pages loaded on first visit (`lazyPage`, #64 `route-code-splitting`) keep their name as the identifier too.
 const lazyLoader = `const lazyPage=load=>{const name=String(load).match(/pages\\/([\\w/-]+)/)?.[1];return 'lazy:'+name};`
 const body = source.statements.filter(statement=>!ts.isImportDeclaration(statement)).map(statement=>ts.createPrinter().printNode(ts.EmitHint.Unspecified,statement,source)).join('\n')
 let code = compile(`${declarations}\n${lazyLoader}\nconst NAV_GROUPS=${JSON.stringify(NAV_GROUPS)};\nconst P=${JSON.stringify(CONSOLE_PATHS)},LEGACY_ROUTE_REDIRECTS=${JSON.stringify(LEGACY_ROUTE_REDIRECTS)};\nconst REPLAY_PERMISSION='replay',AMBIENT_STATUS_PERMISSION='ambient',SKILLS_STATUS_PERMISSION='skills';\nexport const routes=[]; const app={addRoute:route=>routes.push(route)};\n${body}`,'registerBuiltinShell.tsx')
 code = code.replace('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime')))
 const registration = await import(moduleUrl(code))
 registration.registerBuiltinConsolePages()
 return registration.routes
}

test('builtin route regrouping preserves deep links, hidden detail ownership and permission declarations', async () => {
 const routes = await registeredBuiltinRoutes()
 const byPath = new Map(routes.map(route=>[route.path,route]))
 const expected = {
  '/dashboard':'OVERVIEW','/attention':'OVERVIEW','/logs':'OVERVIEW','/agent/workbench':'OVERVIEW','/agent/replay':'OVERVIEW','/agent/usage':'OVERVIEW',
  '/scope':'WORK','/scope/:adapter':'WORK','/scope/:adapter/:endpoint':'WORK','/scope/:adapter/:endpoint/:conversation':'WORK','/agent/sessions':'WORK','/chat-members':'WORK',
  '/features':'FEATURES','/features/global/:plugin':'FEATURES','/features/ai':'FEATURES','/features/ai/skills':'FEATURES','/features/ai/ambient':'FEATURES',
  '/features/ai/workrooms':'FEATURES','/features/ai/workrooms/catalog':'FEATURES','/introspection':'FEATURES','/permissions':'FEATURES',
  '/use-cases/group-welcome':'FEATURES',
  '/plugins':'PLUGINS','/plugins/:name':'PLUGINS','/marketplace':'PLUGINS',
  '/ops/database':'OPS','/ops/config':'OPS','/ops/env':'OPS','/ops/schedules':'OPS','/ops/files':'OPS','/ops/instance':'OPS','/ops/terminal':'OPS','/ops/self-check':'OPS','/scenario-lab':'OPS',
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

// ADR 0063 决策 3 revises the 0052 rule: only pages without an owning plugin (the project's own) still
// reach the 功能 menu, under 插件页面; plugin pages and adapter pages are covered below.
test('pages without an owning plugin are marked for the 插件页面 group of 功能', async () => {
 const {buildNavigation} = await import(sectionsUrl)
 const backup = {path:'/p-backup',name:'备份',meta:{group:NAV_GROUPS.FEATURES,order:23}}
 const marked = markPluginRoute(backup)
 assert.equal(marked.meta.pluginPage,true)
 assert.equal(marked.meta.hideInMenu,undefined)
 assert.deepEqual(backup.meta,{group:NAV_GROUPS.FEATURES,order:23},'input is not mutated')
 const core = [
  {path:CONSOLE_PATHS.features,meta:{group:NAV_GROUPS.FEATURES,order:0}},
  {path:CONSOLE_PATHS.ai,meta:{group:NAV_GROUPS.FEATURES,order:2}},
 ]
 const notes = markPluginRoute({path:'/p-notes',meta:{group:NAV_GROUPS.FEATURES,order:1}})
 const features = buildNavigation([...core,notes,marked]).flatMap(tier => tier.sections).find(section => section.id === 'features')
 assert.deepEqual(features.groups.map(group => [group.id,group.label,group.routes.map(route => route.path)]),[
  ['core','核心',[CONSOLE_PATHS.features,CONSOLE_PATHS.ai]],
  ['plugin','插件页面',['/p-notes','/p-backup']],
 ])
 assert.deepEqual(features.routes.map(route => route.path),[CONSOLE_PATHS.features,CONSOLE_PATHS.ai,'/p-notes','/p-backup'],'core pages come first even when a page orders itself earlier')
 const onlyPlugins = buildNavigation([notes]).flatMap(tier => tier.sections)[0]
 assert.deepEqual(onlyPlugins.groups.map(group => group.id),['plugin'])
})

test('a plugin page becomes a concrete /plugins/<plugin>/<page> tab out of the menu; its old path no longer redirects (ADR 0063 P4)', () => {
 const element = {}
 const rss = {path:'/rss',name:'RSS 订阅',element,requiredPermissions:['rss.read'],meta:{group:NAV_GROUPS.FEATURES,order:20,section:'ops',fullWidth:true,titleI18n:{en:'RSS feeds'}}}
 const entry = {id:'index',name:'index',owner:'root/rss',route:'/rss',meta:{section:'ops',description:'订阅列表',keywords:{'zh-CN':['订阅'],en:['feeds']}}}
 const plan = planPluginRoute(rss,describePluginPage(entry))
 assert.equal(plan.page.path,'/plugins/rss/index')
 assert.ok(!/[:*]/.test(plan.page.path),'a concrete path the command palette can open')
 assert.equal(plan.page.element,element,'the page keeps its own element')
 assert.equal(plan.page.parent,CONSOLE_PATHS.plugins)
 assert.equal(plan.page.meta.hideInMenu,true)
 assert.equal(plan.page.meta.group,NAV_GROUPS.PLUGINS)
 assert.equal(routeSectionId(plan.page),'plugins')
 assert.equal(plan.page.meta.section,undefined,'a declared section no longer places the page')
 assert.equal(plan.page.meta.fullWidth,undefined,'the tab sits in the plugin detail column')
 assert.equal(plan.page.meta.order,20)
 assert.deepEqual(plan.page.meta.titleI18n,{en:'RSS feeds'})
 assert.deepEqual(plan.page.requiredPermissions,['rss.read'])
 assert.deepEqual(plan.page.meta.pluginTab,{kind:'tab',plugin:'rss',page:'index',legacyPath:'/rss',href:'/plugins/rss/index',keywords:['订阅','feeds'],description:'订阅列表'})
 assert.equal(plan.sectionIgnored,'ops','the deprecated section is reported for a warning')
 assert.equal(plan.redirect,undefined,'no redirect at the old path')
 assert.equal(plan.redirectTo,undefined)
 assert.deepEqual(rss.meta,{group:NAV_GROUPS.FEATURES,order:20,section:'ops',fullWidth:true,titleI18n:{en:'RSS feeds'}},'input is not mutated')
 // pages/<name> lives at /<plugin>/p-<name> on the Host.
 const history = planPluginRoute({path:'/rss/p-history',name:'历史'},describePluginPage({id:'history',owner:'root/rss',route:'/rss/p-history'}))
 assert.equal(history.page.path,'/plugins/rss/history')
 assert.equal(history.sectionIgnored,undefined)
 // Without an entry (a hand-registered route) the path still names the plugin.
 assert.equal(planPluginRoute({path:'/calendar',name:'日历'}).page.path,'/plugins/calendar/index')
 // A page hidden from navigation keeps its route but gets no tab.
 assert.equal(planPluginRoute({path:'/rss/p-raw',name:'Raw',meta:{hideInMenu:true}}).page.meta.pluginTab.hidden,true)
})

test('the Sandbox keeps its 会话 entry and project pages keep their menu place; neither redirects', () => {
 const sandbox = planPluginRoute({path:'/sandbox',name:'会话',meta:{fullWidth:true}},describePluginPage({id:'index',owner:'root/sandbox',route:'/sandbox'}))
 assert.equal(sandbox.page.path,'/sandbox')
 assert.equal(sandbox.page.meta.group,NAV_GROUPS.WORK)
 assert.equal(sandbox.page.meta.fullWidth,true)
 assert.equal(sandbox.redirect,undefined)
 const project = planPluginRoute({path:'/p-backup',name:'备份'},describePluginPage({id:'backup',owner:'root',route:'/p-backup'}))
 assert.equal(project.page.path,'/p-backup')
 assert.equal(project.page.meta.group,NAV_GROUPS.FEATURES)
 assert.equal(project.redirect,undefined)
})

test('an adapter page is not mounted twice: its old path redirects to the adapter object page', () => {
 const entry = {id:'index',owner:'root/adapter-icqq',route:'/icqq',blueprint:{kind:'zhin.console.adapter-page',adapterKey:'icqq'},meta:{keywords:['QQ 个人号']}}
 for (const plan of [planPluginRoute({path:'/icqq',name:'ICQQ',icon:'MessageCircle'},describePluginPage(entry)),planPluginRoute({path:'/icqq',name:'ICQQ',icon:'MessageCircle'},null,{adapterKey:'icqq'})]) {
  assert.equal(plan.page,undefined,'no second copy of the connection management')
  assert.equal(plan.redirectTo,'/scope/icqq')
  assert.equal(plan.redirect.path,'/icqq','old links, onboarding cards and the palette still reach it')
  assert.equal(plan.redirect.parent,CONSOLE_PATHS.scope)
  assert.equal(plan.redirect.meta.hideInMenu,true)
  assert.equal(plan.redirect.meta.adapterPage,true)
  assert.equal(routeSectionId(plan.redirect),'sessions')
  assert.equal(plan.redirect.meta.pluginTab.kind,'adapter')
  assert.equal(plan.redirect.meta.pluginTab.href,'/scope/icqq')
 }
 assert.deepEqual(planPluginRoute({path:'/icqq',name:'ICQQ'},describePluginPage(entry)).redirect.meta.pluginTab.keywords,['QQ 个人号'])
})

// #64 `scenario-lab-placement`: 消息场景试验台 is a developer tool, not a bot feature. It moved from 功能 to 运维 at the
// same address; the menu, the breadcrumb section and the ⌘K group all read the route's section.
test('消息场景试验台 sits in 运维 (after 连接自检), no longer in 功能, at the same address', async () => {
 const {buildNavigation, routeSectionId, sectionById} = await import(sectionsUrl)
 const {resolveNavigationLocation} = await import(new URL('navigation-location.mjs',root).href)
 const routes = (await registeredBuiltinRoutes()).filter(route=>!Object.hasOwn(LEGACY_ROUTE_REDIRECTS,route.path))
 const lab = routes.find(route=>route.path==='/scenario-lab')
 assert.equal(CONSOLE_PATHS.scenarioLab,'/scenario-lab','the address is unchanged, so no redirect is needed')
 assert.equal(routeSectionId(lab),'ops')
 const sections = buildNavigation(routes).flatMap(tier=>tier.sections)
 const paths = id => sections.find(section=>section.id===id).routes.map(route=>route.path)
 assert.ok(paths('ops').includes('/scenario-lab'))
 assert.ok(!paths('features').includes('/scenario-lab'))
 assert.deepEqual(paths('ops').slice(-2),['/ops/self-check','/scenario-lab'],'last in 运维, after 连接自检')
 // Breadcrumb (layouts/dashboard.tsx) and ⌘K (ConsoleCommandCenter.tsx) label: sectionById(routeSectionId(route)).label.
 const location = resolveNavigationLocation(routes,'/scenario-lab',(pattern,pathname)=>pattern===pathname)
 assert.equal(location.current.path,'/scenario-lab')
 assert.equal(location.group,NAV_GROUPS.OPS)
 assert.equal(sectionById(routeSectionId(location.current)).label,'运维')
 // Its own permission (feature.view) still decides who sees it, as in 功能.
 const access = names => ({unrestricted:false,permissions:new Set(names),scoped:[]})
 const opsFor = names => buildNavigation(routes,access(names)).flatMap(tier=>tier.sections).find(section=>section.id==='ops')?.routes.map(route=>route.path) ?? []
 assert.ok(opsFor(['feature.view']).includes('/scenario-lab'),'feature.view still reaches it, now under 运维')
 assert.ok(!opsFor(['ops.database.read']).includes('/scenario-lab'),'an ops permission alone does not')
})
