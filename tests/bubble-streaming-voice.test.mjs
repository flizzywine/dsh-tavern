import test from 'node:test'
import assert from 'node:assert/strict'
import {createBubbleStream,parseBubbles,packSpeechInput} from '../tavern-plugin/src/client/bubble-line.cjs'

test('foreign speech waits for the shared fifth field and survives every character split',()=>{
  const parser=createBubbleStream({language:'ja'}), events=[]
  for(const char of '@bubble:lin_yue|林月|喜悦|[你好，今天好吗？]')events.push(...parser.feed(char))
  assert.deepEqual(events,[])
  for(const char of '|[こんにちは、きょうはどう？]\n')events.push(...parser.feed(char))
  events.push(...parser.finish());assert.deepEqual(parser.finish(),[])
  assert.equal(events.filter(row=>row.type==='say').map(row=>row.say).join(''),'こんにちは、きょうはどう？')
  assert.equal(events.filter(row=>row.type==='sub').at(-1).sub,'你好，今天好吗？')
  assert.deepEqual(parser.segments.map(row=>row.sub),[null,'你好，今天好吗？'])
})

test('single-field speech streams clauses, holds thought text and does not split voice directions',()=>{
  const parser=createBubbleStream(), events=[]
  for(const chunk of ['@bubble:lin_yue|林月||[{soft, calm}你好，','今天好吗？]','\n@bubble:lin_yue|林月||[*别念出心声*]'])events.push(...parser.feed(chunk))
  events.push(...parser.finish())
  assert.equal(events.filter(row=>row.type==='say').map(row=>row.say).join(''),'{soft, calm}你好，今天好吗？')
  assert.equal(events.filter(row=>row.type==='say').length,2)
  assert.equal(parser.segments.at(-1).sub,'你好，今天好吗？')
})

test('partial voice is visible to streaming consumers but never triggers ordinary stage playback',()=>{
  const [segment]=parseBubbles('@bubble:lin_yue|林月|喜悦|[你好]|[こんに',true)
  assert.equal(segment.speech,'こんに');assert.equal(segment.streaming,true)
  assert.equal(packSpeechInput(segment,{stage:{textLanguage:'zh'}},{voice:'voice-1',voiceLanguage:'ja'},null),null)
  const parser=createBubbleStream({language:'ja'})
  parser.feed('@bubble:lin_yue|林月||[第一句]|[こんにちは。]\n@bubble:lin_yue|林月||[不能覆盖前一句]|')
  parser.finish()
  assert.equal(parser.segments[0].sub,'第一句')
})
