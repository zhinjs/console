import test from 'node:test'
import assert from 'node:assert/strict'
import { previewParameters, copyJson } from '../console-ui/src/pages/introspection/preview-parameters.mjs'
test('authored examples preserve null and values without fabricating schema', () => {
 assert.deepEqual(previewParameters({}), {hasExample:false,text:'{}'})
 assert.deepEqual(previewParameters({previewProps:null}), {hasExample:true,text:'null'})
 assert.equal(JSON.parse(previewParameters({previewProps:{title:'示例',lines:[]}}).text).title,'示例')
})
test('copy waits for actual clipboard completion and rejects failures', async () => {
 let written
 assert.equal(await copyJson({probe:'actual'}, {writeText:async value => {written=value}}),written)
 await assert.rejects(copyJson({}, {writeText:async()=>{throw new Error('denied')}}),/denied/)
})
