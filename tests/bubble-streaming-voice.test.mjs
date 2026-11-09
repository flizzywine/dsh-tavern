import test from 'node:test'
import assert from 'node:assert/strict'
import { createBubbleStream } from '../tavern-plugin/src/client/bubble-line.cjs'

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
