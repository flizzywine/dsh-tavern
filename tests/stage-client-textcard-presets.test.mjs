import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {TEXTCARD_STYLES,planTextcard,textcardHistory,createTextcardGate,textcardPeak}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/textcard-presets.cjs')
test('every built-in textcard preset produces a bounded plan and backlog projection',()=>{
 for(const style of Object.keys(TEXTCARD_STYLES)){
  const payload={version:1,style,parts:['第一行','第二行'],steps:['第一行','第二行'],intensity:'standard'}
  if(style==='morph'){payload.parts=['明'];payload.steps=['明']}
  const plan=planTextcard(payload),reduced=planTextcard(payload,{reduced:true})
  assert.ok(plan?.frames.length,style);assert.ok(reduced?.frames.length,style)
  assert.ok(plan.frames.every(frame=>Number.isFinite(frame.ms)&&frame.ms>0),style)
  assert.ok(textcardHistory(payload)?.parts.length,style)
 }
 assert.equal(planTextcard({style:'unknown'}),null)
})
test('colour changes respect gate spacing over consecutive cards',()=>{
 const gate=createTextcardGate(),times=[]
 for(let i=0;i<20;i++){const next=gate.slot(i?times.at(-1):0);gate.mark(next);times.push(next)}
 assert.ok(times.slice(1).every((value,i)=>value-times[i]>=375))
 assert.ok(textcardPeak(times,1000)<=3)
})
