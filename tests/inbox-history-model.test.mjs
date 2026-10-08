import test from 'node:test'
import assert from 'node:assert/strict'
import {readRequestHistory,readNoticeHistory,mergeHistoryRows} from '../console-ui/src/pages/endpoint-detail/inbox-history-model.mjs'
const common={id:71,channel:{id:'user',type:'private'},timestamp:1791421200000}
test('formal request history retains actor, timestamps and resolved lifecycle',()=>{
 const row=readRequestHistory({inboxEnabled:true,requests:[{...common,platformRequestId:'one',type:'friend',actor:{id:'user',name:'申请人'},resolved:true,resolvedAt:1791424800000}]})[0]
 assert.equal(row.sender_name,'申请人');assert.equal(row.created_at,common.timestamp);assert.equal(row.resolved,1);assert.equal(row.resolved_at,1791424800000)
 assert.throws(()=>readRequestHistory({inboxEnabled:true,requests:[common]}))
})
test('formal notice history retains type, timestamp and optional actors without inventing availability',()=>{
 const row=readNoticeHistory({inboxEnabled:true,notices:[{...common,platformNoticeId:'one',noticeType:'group_mute',operator:{id:'admin'},payload:'{}'}]})[0]
 assert.equal(row.type,'group_mute');assert.equal(row.created_at,common.timestamp);assert.equal(row.operator_id,'admin');assert.equal(row.target_id,null)
 assert.deepEqual(readNoticeHistory({inboxEnabled:false,notices:[]}),[])
 assert.throws(()=>readNoticeHistory({inboxEnabled:true}))
})
test('overlapping history pages replace repeated ids without duplicate records',()=>{
 assert.deepEqual(mergeHistoryRows([{id:1,value:'old'}],[{id:1,value:'new'},{id:2}]),[{id:1,value:'new'},{id:2}])
})
