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
