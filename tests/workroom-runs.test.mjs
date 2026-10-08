import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRuns, validateDetail, runTotals, retainRunDetail } from '../console-ui/src/pages/workroom-runs-model.mjs';
const list=JSON.parse(readFileSync(new URL('./fixtures/workroom-run-list.json',import.meta.url))).body.data;
const detail=JSON.parse(readFileSync(new URL('./fixtures/workroom-run-details.json',import.meta.url))).detail.body.data;
test('official list uses counts and never requires internal tasks maps',()=>{
 validateRuns(list);assert.equal(list.runs[0].tasks,undefined);
 assert.deepEqual(runTotals(list.runs),{activeRuns:1,tasks:1,assignments:0,blocked:1});
});
test('background summary refresh retains the complete authorized detail',()=>{
 validateDetail(detail);assert.equal(retainRunDetail(detail,list.runs),detail);
 assert.equal(retainRunDetail(detail,[]),null);
 assert.equal(retainRunDetail(detail,[{...list.runs[0],projectId:'different'}]),null);
 assert.equal(detail.tasks[0].blockerCount,1);assert.equal(detail.blockers[0].kind,'approval');
});
test('malformed responses surface an error instead of fabricated empty records',()=>{
 assert.throws(()=>validateRuns({projectId:list.projectId,runs:[{...list.runs[0],counts:undefined}]}));
 assert.throws(()=>validateDetail(list.runs[0]));
});
