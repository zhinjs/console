import test from 'node:test'
import assert from 'node:assert/strict'
import { capabilityEmptyState } from '../console-ui/src/pages/introspection/empty-state.mjs'
test('no-match filtering is not described as missing runtime capabilities in any category',()=>{
 for(const title of ['命令目录','执行管线','组件画廊','Endpoint 状态','Agent 关系','工具目录','提示词片段','MCP 服务']) {
  const state=capabilityEmptyState({title,filter:' not-existing-acceptance0001 ',total:0})
  assert.equal(state.clearFilter,true)
  assert.match(state.title,/没有匹配/)
  assert.doesNotMatch(state.title,/generation/)
  assert.doesNotMatch(state.description,/尚未发布/)
 }
})
test('empty registry and empty page remain distinct without active filter',()=>{
 assert.match(capabilityEmptyState({title:'命令目录',filter:' ',total:0}).title,/generation 没有命令目录/)
 assert.equal(capabilityEmptyState({title:'命令目录',total:7}).title,'当前页没有能力条目')
})
