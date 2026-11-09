import test from 'node:test'
import assert from 'node:assert/strict'
import {createClipTimeline,verifyClipVoiceGraph} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/clip-export-timeline.js'

const rows=[
  {turn:1,para:1,voice:{key:'first',durationMs:3000}},
  {turn:1,para:2,voice:{key:'three',durationMs:9000}},
  {turn:1,para:3},
  {turn:2,para:1}
]
const measured=[
  {pages:[[{text:'First voiced line.',voiceAt:1}]]},
  {pages:[[{text:'First',voiceAt:0.2},{text:'Second longer',voiceAt:0.6},{text:'Third',voiceAt:1}]]},
  {pages:[[{text:'Narration one.',voiceAt:0.5},{text:'Narration two.',voiceAt:1}],[{text:'Next canonical page.',voiceAt:1}]]},
  {pages:[[{text:'Opening scene holds for its reading duration.',voiceAt:1}]]}
]

test('voice completeness rejects a missing first or multi-page line and a truncated continuous clip',()=>{
  const plan=createClipTimeline(rows,measured)
  const tracks=plan.voices.map(row=>({...row,voiceKey:row.key}))
  verifyClipVoiceGraph(plan.voices,tracks)
  for(const missing of ['first','three'])assert.throws(()=>verifyClipVoiceGraph(plan.voices,tracks.filter(row=>row.key!==missing)),/没有完整播放/)
  assert.throws(()=>verifyClipVoiceGraph(plan.voices,tracks.map(row=>({...row,durationMs:100}))),/提前截断/)
})