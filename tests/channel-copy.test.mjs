import { test } from 'node:test';import assert from 'node:assert/strict';import { readFileSync } from 'node:fs';
const read=path=>readFileSync(new URL(`../console-ui/src/${path}`,import.meta.url),'utf8');
test('channel navigation and conversation searches use clear task labels',()=>{
 const list=read('pages/endpoints.tsx'),sidebar=read('pages/endpoint-detail/ConversationSidebar.tsx'),detail=read('pages/endpoint-detail/index.tsx');
 assert.doesNotMatch(list,/机器人管理/);assert.match(list,/title=\{i18n\.t\("聊天账号"\)\}/);
 assert.match(sidebar,/aria-label=\{i18n\.t\("返回聊天账号"\)\}/);assert.match(sidebar,/aria-label=\{i18n\.t\("搜索会话"\)\}/);
 assert.match(detail,/aria-label=\{i18n\.t\("搜索成员"\)\}/);assert.doesNotMatch(detail,/Telegram Web/);
});
