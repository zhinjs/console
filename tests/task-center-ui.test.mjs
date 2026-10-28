import { prepareLocaleModule } from './locale-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const source = await readFile(new URL('../console-ui/src/pages/task-center.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('task-center.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AdminTaskCard')
assert.ok(component)
const summaries = ['TaskTargetSummary', 'TaskParameterSummary'].map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name))
assert.ok(summaries.every(Boolean))
const code = `import {availableTaskActions,taskTimeLabel,taskParameterSummary,TASK_STATE_LABELS,TASK_ACTION_LABELS} from ${JSON.stringify(new URL('../console-ui/src/pages/task-center-model.mjs', import.meta.url).href)};
  const Card='article',CardContent='section',Alert='aside',AlertDescription='p';
  const Button=({children,disabled,onClick})=><button disabled={disabled} onClick={onClick}>{children}</button>;
  ${component.getText(ast)}
  ${summaries.map(node => node.getText(ast)).join('\n')}`
let compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
compiled = compiled.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))
const { AdminTaskCard, TaskTargetSummary, TaskParameterSummary } = await import(`data:text/javascript;base64,${Buffer.from(prepareLocaleModule(compiled)).toString('base64')}`)
const target = { endpoint: { id: 'account-full-id', adapter: 'root/adapter' }, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'team' }, threadId: 'topic' }
const task = { id: 'task', ownership: 'administrator', title: '管理员提醒', target, state: 'unknown', createdAt: 100,
  nextRunAt: 200, timezone: 'Asia/Shanghai', parameters: {}, actions: ['resume', 'update', 'cancel'] }

test('unknown task UI shows actual target and uncertainty, without recovery or retry controls', () => {
  const html = renderToStaticMarkup(React.createElement(AdminTaskCard, { task, disabled: false, onAction: () => {} }))
  assert.match(html, /管理员任务/); assert.match(html, /投递结果不确定/); assert.match(html, /取消也无法撤回/)
  assert.match(html, />取消<\/button>/); assert.doesNotMatch(html, />恢复<\/button>|>修改<\/button>|>重试<\/button>/)
  assert.match(html, /account-full-id/); assert.match(html, /team/); assert.match(html, /topic/)
  assert.match(html, /Asia\/Shanghai/)
})

test('read-only or pending page state disables every task mutation button', () => {
  const html = renderToStaticMarkup(React.createElement(AdminTaskCard, { task: { ...task, state: 'paused', actions: ['resume', 'update', 'cancel'] }, disabled: true, onAction: () => {} }))
  assert.equal((html.match(/<button disabled=""/g) ?? []).length, 3)
})

test('target summary leads with the account name and readable conversation, with explicit full-ID fallback', () => {
  const html = renderToStaticMarkup(React.createElement(TaskTargetSummary, { target, accountName: '研发提醒账号' }))
  assert.match(html, /投递账号/); assert.match(html, /研发提醒账号/); assert.match(html, /频道/)
  assert.match(html, /room/); assert.match(html, /父容器/); assert.match(html, /team/); assert.match(html, /topic/)
  assert.doesNotMatch(html, /account-full-id/)
  const fallback = renderToStaticMarkup(React.createElement(TaskTargetSummary, { target }))
  assert.match(fallback, /<dt[^>]*>账号<\/dt>/); assert.match(fallback, /account-full-id/)
})

test('parameter summary uses Schema titles, an explicit human timezone, readable values and escaped user text', () => {
  const schema = { properties: { text: { title: '提醒内容' }, at: { title: '首次执行时间', format: 'date-time' }, intervalSeconds: { title: '周期秒数' }, enabled: { title: '额外提示' } } }
  const parameters = { text: '<script>alert(1)</script>\n第二行', at: '2027-01-01T09:00:00+08:00', intervalSeconds: 60, enabled: false, unknown: ['普通值', 3] }
  const html = renderToStaticMarkup(React.createElement(TaskParameterSummary, { schema, parameters }))
  assert.match(html, /提醒内容/); assert.match(html, /2027年1月1日 09:00（UTC\+08:00）/)
  assert.match(html, /周期秒数/); assert.match(html, />60</); assert.match(html, /额外提示/); assert.match(html, />否</)
  assert.match(html, /普通值、3/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|2027-01-01T09:00/)
})

test('a real polling provider task displays its supplied schedule details without claiming it is unscheduled', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/rss-task-providers.json', import.meta.url), 'utf8'))
  const rss = fixture.scheduled.data.providers[0].tasks[0]
  const html = renderToStaticMarkup(React.createElement(AdminTaskCard, {task:rss, disabled:false, onAction:()=>{}}))
  assert.match(html, /提供方未返回具体时间，请查看执行规则与任务详情/)
  assert.doesNotMatch(html, /下次执行：未安排|1970/)
  assert.match(html, /实例轮询 0 \*\/5 \* \* \* \*/)
  assert.match(html, /已建立基线；从后续新文章开始推送/)
  assert.match(html, /example-parent/); assert.match(html, /example-thread/)
})
