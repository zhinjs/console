import test from 'node:test'
import assert from 'node:assert/strict'
import { endpointAddress, requestApproval, consumedRows, canShowReadEmpty } from '../console-ui/src/pages/endpoint-detail/endpoint-request.mjs'
test('address approval and consumed payloads preserve separate canonical endpoint and platform row identities', () => {
  assert.deepEqual(endpointAddress('adapter', 'endpoint'), { adapter: 'adapter', endpointKey: 'endpoint' })
  assert.deepEqual(requestApproval('adapter', 'endpoint', 'platform-17'), { adapter: 'adapter', endpointKey: 'endpoint', platformRequestId: 'platform-17' })
  assert.deepEqual(consumedRows(17), { rowIds: [17] })
})
test('empty read state requires successful completed read rather than loading or failure', () => {
  assert.equal(canShowReadEmpty(true, null), false)
  assert.equal(canShowReadEmpty(false, 'network failed'), false)
  assert.equal(canShowReadEmpty(false, null), true)
})
