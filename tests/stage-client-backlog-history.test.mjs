import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageBacklogHistory}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/backlog-history.cjs')
test('history coalesces invalidations, retains successful data on error and ignores late reads',async()=>{
 const pending=[],published=[];let notify,stops=0
 const history=createStageBacklogHistory({read:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),subscribe:(_,fn)=>{notify=fn;return()=>stops++}})
 const off=history.watch('session',value=>published.push(value))
 notify();notify();assert.equal(pending.length,1)
 pending[0].resolve({turns:[1],kinds:[]});await Promise.resolve()
 assert.equal(pending.length,2);assert.deepEqual(published,[null,{turns:[1],kinds:[]}])
 pending[1].reject(Error('offline'));await Promise.resolve()
 assert.equal(published.length,2)
 notify();assert.equal(pending.length,3)
 history.dispose();off();notify();pending[2].resolve({turns:[2],kinds:[]});await Promise.resolve()
 assert.equal(stops,1);assert.equal(published.length,2);assert.equal(pending.length,3)
})
test('session replacement releases old subscription and fences its pending result',async()=>{
 const pending=[],published=[];let stops=0
 const history=createStageBacklogHistory({read:id=>new Promise(resolve=>pending.push({id,resolve})),subscribe:()=>()=>stops++})
 const old=history.watch('old',value=>published.push(['old',value]));old()
 history.watch('new',value=>published.push(['new',value]))
 pending[0].resolve({turns:[1]});pending[1].resolve({turns:[2],kinds:[]});await Promise.resolve()
 assert.deepEqual(published,[['old',null],['new',null],['new',{turns:[2],kinds:[]}]])
 history.dispose();assert.equal(stops,2)
})
