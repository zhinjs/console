import test from 'node:test'
import assert from 'node:assert/strict'
import {historyQuery,historyParams,changeHistoryFilter,validateHistoryResponse,selectedHistoryEntry,isCurrentHistoryRequest} from '../console-ui/src/pages/logs/history-model.mjs'
test('history filters are server parameters, exact source separate from search, every filter resets page',()=>{
 const params=new URLSearchParams('page=3&pageSize=50&q=beta&source=beta&level=error')
 assert.deepEqual(historyQuery(params),{page:3,pageSize:50,q:'beta',source:'beta',level:'error'})
 assert.equal(historyParams(historyQuery(params)).get('source'),'beta')
 for(const [key,value] of [['source','alpha'],['q','%_'],['level','info'],['pageSize',200]]) {
  const next=changeHistoryFilter(params,key,value)
  assert.equal(historyQuery(next).page,1)
  assert.equal(next.get(key),String(value))
 }
 assert.equal(historyQuery(new URLSearchParams('page=-2&pageSize=evil')).page,1)
})
test('formal history response requires real totals/id and accepts global source catalog',()=>{
 const payload={success:true,data:[{id:1,message:'same',source:'beta',level:'error',timestamp:'2026-10-08'}],sources:[{source:'alpha',count:100},{source:'beta',count:1}],total:1,page:1,pageSize:50,totalPages:1}
 assert.equal(validateHistoryResponse(payload).sources[0].count,100)
 assert.throws(()=>validateHistoryResponse({...payload,total:undefined}),/日志历史分页响应无效/)
 assert.throws(()=>validateHistoryResponse({success:true,data:[]}),/Host 不支持日志历史分页/)
 assert.throws(()=>validateHistoryResponse({...payload,data:[{...payload.data[0],id:undefined}]}))
})
test('selection uses row id even for duplicate text and retains actual snapshot across pages',()=>{
 const a={id:1,message:'duplicate',source:'a',level:'info',timestamp:'same'}
 const b={...a,id:2}
 assert.equal(selectedHistoryEntry([b,a],a).id,1)
 assert.equal(selectedHistoryEntry([b],a),a)
 assert.equal(selectedHistoryEntry([b],null),b)
 assert.equal(selectedHistoryEntry([],null),null)
})

test('late and aborted responses cannot publish into newer filter/page',()=>{
 const old=new AbortController(), newer=new AbortController()
 const current={controller:newer,key:'page=2&q=beta'}
 assert.equal(isCurrentHistoryRequest(current,old,'page=1'),false)
 assert.equal(isCurrentHistoryRequest(current,newer,'page=1'),false)
 assert.equal(isCurrentHistoryRequest(current,newer,current.key),true)
 newer.abort()
 assert.equal(isCurrentHistoryRequest(current,newer,current.key),false)
})
