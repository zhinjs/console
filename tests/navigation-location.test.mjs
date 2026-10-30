import { test } from 'node:test';import assert from 'node:assert/strict';import { matchPath } from 'react-router-dom';
import { resolveNavigationLocation } from '../console-ui/src/navigation-location.mjs';
const routes=[{path:'/plugins',name:'插件',meta:{group:'自动化与扩展'}},{path:'/plugins/:name',name:'插件详情',parent:'/plugins',meta:{hideInMenu:true}},{path:'/agent/workrooms',name:'Workroom',meta:{group:'Agent 与 Workroom'}},{path:'/agent/workrooms/catalog',name:'Workroom 配置',parent:'/agent/workrooms',meta:{hideInMenu:true}},{path:'/assistant/jobs',name:'助手任务',meta:{group:'自动化与扩展'}}];
const match=(pattern,pathname)=>matchPath({path:pattern,end:true},pathname)!==null;
test('details identify exact page and real registered parent independently of sidebar owner',()=>{
 const detail=resolveNavigationLocation(routes,'/plugins/repeater',match);assert.equal(detail.current.name,'插件详情');assert.equal(detail.parent.path,'/plugins');assert.equal(detail.visible.path,'/plugins');assert.equal(detail.group,'自动化与扩展');
 const catalog=resolveNavigationLocation(routes,'/agent/workrooms/catalog',match);assert.equal(catalog.current.name,'Workroom 配置');assert.equal(catalog.parent.name,'Workroom');
});
test('navigation changes do not retain previous active menu and top-level groups are not links',()=>{
 const jobs=resolveNavigationLocation(routes,'/assistant/jobs',match);assert.equal(jobs.parent,null);assert.equal(jobs.visible.path,'/assistant/jobs');assert.equal(jobs.group,'自动化与扩展');
 const missing=resolveNavigationLocation([{path:'/detail/:id',name:'Detail',parent:'/missing',meta:{hideInMenu:true}}],'/detail/1',match);assert.equal(missing.parent,null);
});

test('hidden nested details resolve the nearest visible registered ancestor', () => {
 const root = {path:'/tasks',name:'任务',meta:{group:'任务'}};
 const detail = {path:'/runs/:id',name:'运行详情',parent:'/tasks',meta:{hideInMenu:true}};
 const leaf = {path:'/assignments/:id',name:'分工详情',parent:'/runs/:id',meta:{hideInMenu:true}};
 const result = resolveNavigationLocation([root,detail,leaf],'/assignments/1',match);
 assert.equal(result.current,leaf);
 assert.equal(result.parent,root);
 assert.equal(result.visible,root);
 assert.equal(result.group,'任务');
});

test('missing and cyclic hidden ancestors cannot loop or borrow an unrelated menu', () => {
 const root = {path:'/plugins',name:'插件',meta:{group:'插件'}};
 const a = {path:'/detail/:id',name:'详情',parent:'/other/:id',meta:{hideInMenu:true}};
 const b = {path:'/other/:id',name:'其他详情',parent:'/detail/:id',meta:{hideInMenu:true}};
 const cycle = resolveNavigationLocation([root,a,b],'/detail/1',match);
 assert.equal(cycle.current,a);
 assert.equal(cycle.parent,null);
 assert.equal(cycle.visible,null);
 const missing = resolveNavigationLocation([root,a],'/detail/1',match);
 assert.equal(missing.parent,null);
 assert.equal(missing.visible,null);
});
