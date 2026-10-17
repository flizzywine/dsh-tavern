import test from 'node:test'
import assert from 'node:assert/strict'
import {createBackgroundProgress} from '../tavern-plugin/lib/domain/background-progress.js'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
const start={type:'start',attemptId:'a'}
test('silent model times out even if cancellation does not settle the provider',async()=>{
 let cancelled=0
 const p=createBackgroundProgress({idleMs:30,onCancel:()=>cancelled++})
 p.frame(start)
 const waiting=p.wait(new Promise(()=>{}))
 const check=assert.rejects(waiting,{code:'BACKGROUND_MODEL_IDLE_TIMEOUT'})
 await delay(50);await check
 assert.equal(cancelled,1);assert.equal(p.signal.aborted,true);p.dispose()
})
test('real reasoning extends liveness; empty chunks and stale attempts do not',async()=>{
 const p=createBackgroundProgress({idleMs:45})
 p.frame(start)
 const check=assert.rejects(p.wait(new Promise(()=>{})),{code:'BACKGROUND_MODEL_IDLE_TIMEOUT'})
 for(let i=0;i<4;i++){await delay(20);p.frame({type:'chunk',attemptId:'a',chunk:{type:'reasoning-delta',text:'thinking'}});assert.equal(p.signal.aborted,false)}
 p.frame({type:'chunk',attemptId:'a',chunk:{type:'text-delta',text:''}})
 p.frame({type:'chunk',attemptId:'old',chunk:{type:'text-delta',text:'stale'}})
 await delay(60);await check;p.dispose()
})
