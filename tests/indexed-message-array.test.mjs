import test from 'node:test'
import assert from 'node:assert/strict'
import { createIndexedArrayApi } from '../tavern-plugin/lib/domain/indexed-array.js'

for (const length of [20,400,10000]) test(`indexed floor update has bounded work at ${length}`,()=>{
 let visits=0
 const api=createIndexedArrayApi({valid:row=>Boolean(row&&!row.stub),measure:()=>100,visit:()=>visits++})
 const rows=Array.from({length},(_,id)=>({id,value:10}))
 const before=api.from(rows);visits=0
 const after=api.update(before,[[length-1,{id:length-1,value:9}]],length)
 assert.ok(visits<=64,`visited ${visits} nodes`)
 visits=0
 assert.deepEqual(api.changed(before,after),[length-1])
 assert.ok(visits<=16,`difference visited ${visits} nodes`)
 assert.equal(api.changed(rows,after),null,'unindexed baselines require explicit full synchronization')
 assert.equal(before[length-1].value,10);assert.equal(after[length-1].value,9)
 assert.equal(before[0],after[0]);assert.equal(api.info(after).complete,true)
 assert.deepEqual(JSON.parse(JSON.stringify(after)),rows.map((r,i)=>i===length-1?{id:i,value:9}:r))
 for(let i=0;i<1000;i++) api.update(after,[[0,{id:0,value:i}]],length)
 visits=0;assert.equal(after[0].value,10);assert.ok(visits<=8,'lookups must not accumulate overlay chains')
})
test('indexed truncation, holes, append and previous eligible floor',()=>{
 const api=createIndexedArrayApi({valid:row=>Boolean(row&&!row.stub)})
 let rows=api.from([{id:0},null,{id:2}]);assert.equal(api.info(rows).complete,false)
 assert.equal(api.previous(rows,2),0)
 rows=api.update(rows,[[1,{id:1}]],3);assert.equal(api.info(rows).complete,true)
 const old=rows;rows=api.update(rows,[],1);rows=api.update(rows,[[1,{id:9}]],2)
 assert.equal(rows[2],undefined);assert.equal(rows[1].id,9);assert.equal(old[2].id,2)
 assert.equal(api.info(rows).complete,true)
 assert.equal(Array.isArray(rows),true)
 assert.deepEqual(Object.keys(rows),['0','1'])
 assert.throws(()=>{rows[0]={}},/immutable/)
})
