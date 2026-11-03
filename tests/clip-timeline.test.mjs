import test from 'node:test'
import assert from 'node:assert/strict'
import {createClipTimeline,verifyClipVoiceGraph} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/clip-export-timeline.js'
import auto from '../tavern-plugin/src/client/stage-auto-timing.cjs'

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

test('one measured stage plan holds the voiced first line, turns three cards on its continuous voice clock, and times narration/opening with stage auto',()=>{
  const plan=createClipTimeline(rows,measured),frames=ms=>Math.round(ms*30/1000)
  const wait=auto.stageAutoDelay(700,1.3,true,'')
  assert.equal(plan.voices[0].startFrame,0)
  assert.equal(plan.lines[0].frames,frames(3000+wait))
  const start=plan.lines[1].startFrame
  assert.equal(plan.voices[1].startFrame,start)
  assert.deepEqual(plan.cards.filter(row=>row.para===2).map(row=>row.start),[start,start+frames(1800),start+frames(5400)])
  assert.equal(plan.lines[1].frames,frames(9000+wait))
  let elapsed=0,at=plan.lines[2].startFrame
  for(const card of plan.cards.filter(row=>row.turn===1&&row.para===3)) {
    assert.equal(card.start,at+frames(elapsed))
    elapsed+=auto.stageAutoDelay(700,1.3,false,card.text)
    assert.equal(card.end,at+frames(elapsed))
  }
  assert.equal(plan.lines[3].frames,frames(auto.stageAutoDelay(700,1.3,false,measured[3].pages[0][0].text)))
  assert.equal(plan.frames,plan.cards.at(-1).end)
  assert.throws(()=>createClipTimeline(rows,[{pages:[]},...measured.slice(1)]),/舞台分页/)
})

test('voice completeness rejects a missing first or multi-page line and a truncated continuous clip',()=>{
  const plan=createClipTimeline(rows,measured)
  const tracks=plan.voices.map(row=>({...row,voiceKey:row.key}))
  verifyClipVoiceGraph(plan.voices,tracks)
  for(const missing of ['first','three'])assert.throws(()=>verifyClipVoiceGraph(plan.voices,tracks.filter(row=>row.key!==missing)),/没有完整播放/)
  assert.throws(()=>verifyClipVoiceGraph(plan.voices,tracks.map(row=>({...row,durationMs:100}))),/提前截断/)
})

test('旁白配音: a narration paragraph holds each page for its own narrator voice, the voice starting with its page', () => {
  const frames = ms => Math.round(ms * 30 / 1000), wait = auto.stageAutoDelay(700, 1.3, true, '')
  const pageVoices = [{key:'n0', durationMs:2000}, null, {key:'n2', durationMs:1500}]
  const plan = createClipTimeline([{turn:1, para:1, kind:'narration', pageVoices}],
    [{pages:[[{text:'第一页。', voiceAt:1}], [{text:'第二页没有配音。', voiceAt:1}], [{text:'第三页。', voiceAt:1}]]}])
  const starts = [0, 1, 2].map(page => plan.cards.find(card => card.card === page).start)
  assert.deepEqual(plan.voices.map(row => [row.id, row.key, row.page, row.startFrame]), [['1:1:0', 'n0', 0, starts[0]], ['1:1:2', 'n2', 2, starts[2]]])
  assert.equal(starts[1], frames(2000 + wait))
  assert.equal(starts[2] - starts[1], frames(2000 + wait + auto.stageAutoDelay(700, 1.3, false, '第二页没有配音。')) - frames(2000 + wait))
  assert.equal(plan.frames - starts[2], frames(2000 + wait + auto.stageAutoDelay(700, 1.3, false, '第二页没有配音。') + 1500 + wait) - starts[2])
  assert.equal(plan.lines[0].voice, 'cached')
  verifyClipVoiceGraph(plan.voices, plan.voices.map(row => ({...row, voiceKey:row.key})))
})