import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import bubbleLine from '../tavern-plugin/src/client/bubble-line.cjs'
import {roundBody, replyBody, voiceBackfillLines, voiceBackfillKept} from '../tavern-plugin/lib/domain/round-body.js'
import {createWorkflow} from '../tavern-plugin/lib/domain/workflow.js'
import { createStoryEvents } from '../tavern-plugin/lib/domain/story-events.js'
import { createVoiceBackfill } from '../tavern-plugin/packages/dsh-tavern-stage/lib/voice-backfill.js'

const require = createRequire(import.meta.url)
const {createStageTextIndexModule} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/text-index.cjs')
const pages = require('../tavern-plugin/src/client/stage-page-index.cjs')
const {bubbleCharacter, matchBubbleMood, packSpeechInput} = bubbleLine

// Fixture ids differ from every name and alias; moods are Chinese labels.
const moods = [{id:'angry', label:'生气'}, {id:'calm', label:'平静'}, {id:'joy', label:'开心'}]
const config = {enabled:true, voice:{enabled:true}, characters:[
  {alias:'fig-07', name:'角色戊', aliases:['杏子'], voice:'voice-kyoko', voiceKey:'vk-07', voiceLanguage:'ja', emotions:moods},
  {alias:'fig-11', name:'角色甲', aliases:['小甲'], voice:'voice-fixture', voiceKey:'vk-11', voiceLanguage:'zh', emotions:moods},
  {alias:'fig-21', name:'角色乙', aliases:['焰', '转学生'], voice:'voice-homura', voiceKey:'vk-21', voiceLanguage:'ja', emotions:moods},
  {alias:'fig-22', name:'美树沙耶香', aliases:['沙耶香', '转学生'], voice:'voice-sayaka', voiceKey:'vk-22', voiceLanguage:'ja', emotions:moods}
]}
const TRANSLATE = '@bubble:杏子|杏子|生气|[哼，这点小事也要我帮忙？]'
const VOICED = '@bubble:杏子|杏子|开心|[走吧。]|[行こう。]'
const EMPTY = '@bubble:杏子|杏子|平静|[……没什么。]|[]'
const CHINESE = '@bubble:小甲|小甲|开心|[早上好。]'
const AMBIGUOUS = '@bubble:转学生|转学生|平静|[快走。]'
const UNKNOWN = '@bubble:路人|路人|平静|[谁在那里？]'
const REPLY = [TRANSLATE, VOICED, EMPTY, CHINESE, AMBIGUOUS, UNKNOWN].join('\n')
const JAPANESE = 'ふん、こんなことでもあたしに頼むわけ？'

const body = (text, options = {}) => roundBody([{kind:'markdown', text}], {chatId:'chat-a', branchId:'b1', turn:2, ...options})
const lineOf = (round, text) => round.paragraphs.find(row => row.kind === 'line' && row.source.text === text)
const speech = paragraph => packSpeechInput(paragraph.segment, config, bubbleCharacter(config, paragraph.segment), matchBubbleMood(paragraph.segment.mood, moods))

function harness({reply = () => '1. ' + JAPANESE, delayMs = 0} = {}) {
  const events = createStoryEvents({logger:{warn() {}}})
  const workflow = createWorkflow({events, logger:{warn() {}}})
  const chat = {id:'chat-a', sessionId:'game-a', cardPath:'cards/a.json', mode:'story', timeline:{branchId:'b1'}, messages:[
    {role:'user', text:'去找杏子。'},
    {role:'assistant', turn:2, sourceText:REPLY, text:REPLY, displayText:REPLY}]}
  const calls = [], writes = []
  let running = 0, overlap = 0, compacting = false
  const voiceBackfill = createVoiceBackfill({workflow,
    chatHeaderForSession:async () => ({cardPath:chat.cardPath, mode:chat.mode, regenInProgress:false}),
    dialogueBubbles:{read:async () => config},
    chatForSession:async () => structuredClone(chat),
    voiceBackfillLines, voiceBackfillKept,
    bodyForTurn:async (current, turn) => {
      const message = current.messages.find(row => row.role === 'assistant' && row.turn === turn)
      return replyBody({turn, text:message.text, mode:'markdown'}, current, message)
    },
    writeMessage:async (_id, index, mutate) => {
      const next = structuredClone(chat.messages[index]); mutate(next); chat.messages[index] = next; writes.push(next.voiceBackfill.status)
    },
    runAgent:async input => {
      calls.push(input); running++; overlap = Math.max(overlap, running)
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs)
          input.signal.addEventListener('abort', () => { clearTimeout(timer); reject(input.signal.reason) }, {once:true})
        })
        return {text:reply(input)}
      } finally { running-- }
    },
    selection:async () => ({provider:'fake', model:'fake-model'}),
    blocked:() => compacting})
  const settle = () => new Promise(resolve => setTimeout(resolve, delayMs + 30))
  return {events, workflow, chat, calls, writes, voiceBackfill, settle, overlap:() => overlap, compact(value) { compacting = value }}
}

test('a rewind or rewrite invalidates the result; a failure or compaction never blocks play', async () => {
  // Rewound while translating: the task stops and writes nothing more.
  const rewound = harness({delayMs:200})
  rewound.events.emit('reply-committed', {sessionId:'game-a'})
  await new Promise(resolve => setTimeout(resolve, 30))
  rewound.events.emit('story-rewound', {sessionId:'game-a', kind:'rollback'})
  await rewound.settle()
  assert.deepEqual(rewound.writes, ['pending'])
  // Regenerated while translating: the reply no longer matches, so the late text is dropped.
  const rewritten = harness({delayMs:60})
  rewritten.events.emit('reply-committed', {sessionId:'game-a'})
  await new Promise(resolve => setTimeout(resolve, 30))
  rewritten.chat.messages[1] = {...rewritten.chat.messages[1], sourceText:CHINESE, text:CHINESE, displayText:CHINESE}
  await rewritten.settle()
  assert.equal(rewritten.chat.messages[1].voiceBackfill.status, 'pending')
  const regenerated = replyBody({turn:2, text:CHINESE, mode:'markdown'}, rewritten.chat, rewritten.chat.messages[1])
  assert.equal(lineOf(regenerated, CHINESE).segment.voiceHold, undefined, 'the old record holds no line of the new reply')
  // A stored text belongs to its line: an edited line no longer finds it.
  const key = voiceBackfillLines(body(REPLY).paragraphs, config)[0].key
  const edited = TRANSLATE.replace('帮忙', '帮手')
  assert.equal(speech(lineOf(body(edited, {voiceBackfill:{status:'done', lines:{[key]:JAPANESE}}}), edited)).text, '哼，这点小事也要我帮手？')
  // A reply missing a line fails the task; the line speaks Chinese.
  const failed = harness({reply:() => 'ふん。'})
  failed.events.emit('reply-committed', {sessionId:'game-a'})
  await failed.settle()
  assert.deepEqual(failed.writes, ['pending', 'failed'])
  const message = failed.chat.messages[1]
  assert.equal(speech(lineOf(replyBody({turn:2, text:message.text, mode:'markdown'}, failed.chat, message), TRANSLATE)).text, '哼，这点小事也要我帮忙？')
  assert.equal(failed.workflow.runs('game-a').at(-1).status, 'failed')
  // During a compaction no task starts.
  const compacted = harness()
  compacted.compact(true)
  compacted.events.emit('reply-committed', {sessionId:'game-a'})
  await compacted.settle()
  assert.deepEqual([compacted.calls.length, compacted.writes], [0, ['failed']])
})

test('added latency: the line waits only for the fake model, plus the task overhead', async t => {
  const delayMs = 300
  const h = harness({delayMs})
  const started = performance.now()
  h.events.emit('reply-committed', {sessionId:'game-a'})
  while (h.chat.messages[1].voiceBackfill?.status !== 'done') await new Promise(resolve => setTimeout(resolve, 2))
  const waited = performance.now() - started, overhead = waited - delayMs
  t.diagnostic(JSON.stringify({fakeModelMs:delayMs, voiceWaitMs:Math.round(waited), overheadMs:Math.round(overhead)}))
  assert.ok(overhead < 250, 'overhead ' + overhead + ' ms')
})
