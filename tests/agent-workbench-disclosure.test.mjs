import { test } from 'node:test';import assert from 'node:assert/strict';import { readFileSync } from 'node:fs';
test('configuration-only bindings never assert Agent execution or MCP connection readiness',()=>{
 const source=readFileSync(new URL('../console-ui/src/pages/agent-workbench.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/个 Agent 可用|可用 Agent|所连接的 MCP|使用本地工具目录/);
 assert.match(source,/声明不代表 Agent 已启用或 MCP 已连接/);
 assert.match(source,/模型连接及实际对话结果需在对应会话中验证/);
});

 test('workbench starts with actionable state and discloses the explanation instead of a marketing hero',()=>{
  const source=readFileSync(new URL('../console-ui/src/pages/agent-workbench.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/模型负责思考|console-agent-hero-orbit/);
  assert.match(source,/aria-label="待完成配置"/);
  assert.match(source,/当前状态未确认/);
  assert.match(source,/<details className="console-agent-state-explanation">/);
  assert.match(source,/<summary>状态说明<\/summary>/);
  assert.match(source,/安装并装配可选 Agent 能力/);
 });
