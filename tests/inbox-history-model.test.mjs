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

test('formal message history maps public sender/timestamp/channel fields and sorts oldest first',async()=>{
 const {readMessageHistory}=await import('../console-ui/src/pages/endpoint-detail/inbox-history-model.mjs')
 const incoming={...common,id:2,platformMessageId:'platform-2',sender:{id:'10001',name:'Alice'},content:'second',raw:null}
 const first={...incoming,id:1,platformMessageId:'platform-1',content:'first',channel:{id:'user',type:'private',parent:{id:'server',type:'guild'}}}
 const rows=readMessageHistory({inboxEnabled:true,messages:[incoming,first]})
 assert.deepEqual(rows.map(row=>row.id),[1,2]);assert.equal(rows[0].sender.name,'Alice');assert.equal(rows[0].platformMessageId,'platform-1');assert.equal(rows[0].timestamp,common.timestamp)
 assert.equal(Number.isFinite(new Date(rows[0].timestamp).getTime()),true);assert.deepEqual(rows[0].channel.parent,{id:'server',type:'guild'})
 assert.throws(()=>readMessageHistory({inboxEnabled:true,messages:[{id:1,sender_id:'user',created_at:common.timestamp,content:'old database shape'}]}),/历史记录/)
 assert.throws(()=>readMessageHistory({inboxEnabled:true,messages:[{...incoming,timestamp:1e20}]}),/消息历史/)
})

test('observed history keeps actual outbound direction, canonical identity and rendering; old rows stay unknown',async()=>{
 const {readMessageHistory}=await import('../console-ui/src/pages/endpoint-detail/inbox-history-model.mjs')
 const conversation={endpoint:{id:'root/icqq\0adapter\0icqq~20001',adapter:'icqq'},kind:'private',id:'user'}
 const row={...common,platformMessageId:'sent-1',sender:{id:'20001'},content:'sent text',raw:'stored observation',direction:'outbound',conversation,rendering:{forms:['text'],fallbacks:['interactive_text_policy']}}
 const observed=readMessageHistory({inboxEnabled:true,messages:[row]})[0]
 assert.equal(observed.direction,'outbound');assert.deepEqual(observed.rendering,row.rendering);assert.deepEqual(observed.conversation,conversation);assert.equal(observed.platformMessageId,'sent-1')
 const old=readMessageHistory({inboxEnabled:true,messages:[{...row,raw:null,direction:undefined,conversation:undefined,rendering:undefined}]})[0]
 assert.equal(old.direction,undefined);assert.equal(old.rendering,undefined);assert.equal(old.conversation,undefined)
 assert.equal(readMessageHistory({inboxEnabled:true,messages:[{...row,rendering:{}}]})[0].renderingError,'渲染诊断格式无效')
 assert.throws(()=>readMessageHistory({inboxEnabled:true,messages:[{...row,conversation:{...conversation,id:'different'}}]}),/会话标识/)
})
