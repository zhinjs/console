import assert from 'node:assert/strict'
import test from 'node:test'
import { numericFieldIssue, numericConfigInvalid } from '../console-ui/src/components/PluginConfigForm/numeric-validation.mjs'

test('numeric edits preserve empty values and reject bounds and fractions before submission', () => {
 const field = {type:'number', min:1, max:5, integer:true}
 for (const value of ['', 0, 6, 1.5, Infinity]) assert.ok(numericFieldIssue(field, value))
 assert.equal(numericFieldIssue(field, 3), null)
 assert.equal(numericFieldIssue(field, undefined), null)
 assert.ok(numericFieldIssue({...field, required:true}, undefined))
 assert.equal(numericConfigInvalid({settings:{type:'object', object:{count:field}}}, {settings:{count:0}}), true)
 assert.equal(numericConfigInvalid({values:{type:'list', inner:field}}, {values:[3,0]}), true)
 assert.equal(numericConfigInvalid({count:field}, {count:3}), false)
})
