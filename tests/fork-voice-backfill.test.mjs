import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import bubbleLine from '../tavern-plugin/src/client/bubble-line.cjs'
import {roundBody, replyBody, voiceBackfillLines, voiceBackfillKept} from '../tavern-plugin/lib/domain/round-body.js'
import {paragraphSpeech} from '../tavern-plugin/lib/domain/paragraph-speech.js'
import {createWorkflow} from '../tavern-plugin/lib/domain/workflow.js'
import {createStoryEvents, STORY_EVENTS} from '../tavern-plugin/lib/domain/story-events.js'
import {describeTasks} from '../tavern-plugin/lib/domain/background-tasks.js'
import {createVoiceBackfill, voiceBackfillTaskText, readVoiceBackfill, VOICE_BACKFILL_PROMPT, VOICE_BACKFILL_TASK} from '../tavern-plugin/packages/dsh-tavern-stage/lib/voice-backfill.js'

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

test('detection: only a resolved translating speaker without a voice field is translated', () => {
  const round = body(REPLY)
  const lines = voiceBackfillLines(round.paragraphs, config)
  assert.deepEqual(lines.map(line => [line.name, line.language, line.text]), [['角色戊', 'ja', '哼，这点小事也要我帮忙？']])
  assert.equal(bubbleCharacter(config, lineOf(round, AMBIGUOUS).segment), null, 'an alias two figures share stays unresolved')
  // Without a record the round keeps today's fallback; an explicitly empty voice field stays silent.
  assert.equal(speech(lineOf(round, TRANSLATE)).text, '哼，这点小事也要我帮忙？')
  assert.equal(speech(lineOf(round, VOICED)).text, '行こう。')
  assert.equal(speech(lineOf(round, EMPTY)), null)
  assert.equal(speech(lineOf(round, CHINESE)).text, '早上好。')
  assert.equal(speech(lineOf(round, AMBIGUOUS)), null)
  assert.equal(speech(lineOf(round, UNKNOWN)), null)
  // The task text names the language for the model; the reply must answer every line exactly once.
  assert.equal(voiceBackfillTaskText(lines), '1. 角色戊〔日语〕：哼，这点小事也要我帮忙？')
  assert.deepEqual(readVoiceBackfill('1. ' + JAPANESE, lines), {[lines[0].key]:JAPANESE})
  assert.equal(readVoiceBackfill('ふん。', lines), null)
  assert.equal(readVoiceBackfill('1. a\n2. b', lines), null)
})

test('the line voice waits while the round streams or translates, then speaks the stored text; a failure falls back', () => {
  const lines = voiceBackfillLines(body(REPLY).paragraphs, config), key = lines[0].key
  const streaming = body(REPLY + '\n', {streaming:true})
  assert.equal(speech(lineOf(streaming, TRANSLATE)), null, 'held while the reply streams')
  assert.equal(speech(lineOf(streaming, CHINESE)).text, '早上好。', 'a Chinese voice is never held')
  assert.equal(speech(lineOf(streaming, VOICED)).text, '行こう。')
  assert.equal(speech(lineOf(body(REPLY, {voiceBackfill:{status:'pending', keys:[key], lines:{}}}), TRANSLATE)), null)
  assert.equal(speech(lineOf(body(REPLY, {voiceBackfill:{status:'pending', keys:['other line'], lines:{}}}), TRANSLATE)).text, '哼，这点小事也要我帮忙？', 'only the lines the task asked for wait')
  const done = lineOf(body(REPLY, {voiceBackfill:{status:'done', lines:{[key]:JAPANESE}}}), TRANSLATE)
  assert.equal(speech(done).text, JAPANESE)
  assert.equal(done.text, '哼，这点小事也要我帮忙？', 'the subtitle stays Chinese')
  const failed = lineOf(body(REPLY, {voiceBackfill:{status:'failed', keys:[key], lines:{}}}), TRANSLATE)
  assert.equal(speech(failed).text, '哼，这点小事也要我帮忙？')
  assert.equal(failed.segment.voiceFallback, true)
  // The stage page carries the marks, so its voice key changes when the voice text or the fallback arrives.
  const textIndex = createStageTextIndexModule({pageCards:pages.stagePageCards, character:() => null})
  const index = textIndex.createIndex({paginate:pages.stageBlockPages, storyTurn:(_, turn) => turn, superseded:() => false, projectionForTurn:(view, turn) => view.replyProjections.find(row => row.turn === turn)})
  const voiceOf = round => index.reconcile({view:{replyProjections:[{turn:2, body:round}]}, branchId:'b1'}).get(2).text.pages.find(page => page.voice?.text === '哼，这点小事也要我帮忙？').voice
  assert.equal(voiceOf(body(REPLY, {voiceBackfill:{status:'pending', keys:[key]}})).voiceHold, true)
  const staged = voiceOf(body(REPLY, {voiceBackfill:{status:'done', lines:{[key]:JAPANESE}}}))
  assert.deepEqual([staged.speech, staged.voiceBackfilled, staged.voiceHold], [JAPANESE, true, undefined])
})

// 通用声音 in another language (its 配音语言 on the 配音 page): a passing NPC and a figure without a voice of its own are
// translated in that language; a Chinese 通用声音 or a 「不配音」 figure is not. The general voice speaks the voice text.
test('通用声音 lines are translated into its 配音语言 and spoken from the voice text; a Chinese 通用声音 is not', async () => {
  const general = {...config, voice:{enabled:true, general:'vk-general', generalLanguage:'en'}, characters:[...config.characters,
    {alias:'fig-31', name:'店员', aliases:[], general:true, emotions:moods}, {alias:'fig-32', name:'帝', aliases:[], emotions:moods}]}
  const SHOP = '@bubble:店员|店员|平静|[欢迎光临。]', MUTE = '@bubble:帝|帝|平静|[退下。]'
  const round = body([TRANSLATE, UNKNOWN, SHOP, MUTE].join('\n'))
  const lines = voiceBackfillLines(round.paragraphs, general)
  assert.deepEqual(lines.map(line => [line.name, line.language, line.text]),
    [['角色戊', 'ja', '哼，这点小事也要我帮忙？'], ['路人', 'en', '谁在那里？'], ['店员', 'en', '欢迎光临。']])
  assert.equal(voiceBackfillTaskText(lines).split('\n')[1], '2. 路人〔英语〕：谁在那里？')
  assert.deepEqual(voiceBackfillLines(round.paragraphs, {...general, voice:{...general.voice, generalLanguage:'zh'}}).map(line => line.name), ['角色戊'])
  // the chat and the stage speak a general line through segmentSpeechInput (voice-speech.cjs).
  const ctx = {...bubbleLine, bubbleMood:() => null, bubbleMoodList:() => []}
  vm.runInNewContext(await readFile(new URL('../tavern-plugin/src/client/voice-speech.cjs', import.meta.url), 'utf8'), ctx)
  const keyOf = text => lines.find(line => line.text === text).key, said = (round, text) => ctx.segmentSpeechInput(lineOf(round, text).segment, general)
  assert.equal(said(body([UNKNOWN].join('\n'), {voiceBackfill:{status:'pending', keys:[keyOf('谁在那里？')], lines:{}}}), UNKNOWN), null, 'held while it translates')
  assert.deepEqual({...said(body(UNKNOWN, {voiceBackfill:{status:'done', lines:{[keyOf('谁在那里？')]:'Who is there?'}}}), UNKNOWN)}, {text:'Who is there?', mood:null, general:true})
  assert.equal(said(body(UNKNOWN, {voiceBackfill:{status:'failed', keys:[keyOf('谁在那里？')], lines:{}}}), UNKNOWN).text, '谁在那里？', 'a failure speaks Chinese')
  assert.equal(said(round, MUTE), null, '「不配音」 stays silent')
})

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

test('the job is declared in the task table on 正文写完, serialised per game, and stores the text with the round', async t => {
  const h = harness({delayMs:20})
  const task = h.workflow.catalog().find(item => item.task === 'voice-backfill')
  assert.equal(task.name, VOICE_BACKFILL_TASK.name)
  const job = h.workflow.table().find(item => item.id === 'voice-backfill')
  assert.deepEqual([job.on, job.cancelOn], [['reply-committed'], ['turn-discarded', 'story-rewound']])
  const described = describeTasks(h.workflow.catalog(), h.workflow.table(), event => STORY_EVENTS[event]).find(item => item.task === 'voice-backfill')
  assert.match(described.trigger, /^正文写完/)
  assert.match(described.waits, /回合作废、剧情回退或改写时取消/)
  h.events.emit('reply-committed', {sessionId:'game-a'})
  h.events.emit('reply-committed', {sessionId:'game-a'})
  await h.settle(); await h.settle()
  assert.equal(h.overlap(), 1, 'one task per game at a time')
  assert.equal(h.calls.length, 1, 'the queued rerun finds the line translated and calls no model')
  const input = h.calls[0]
  assert.deepEqual([input.task, input.ownPrefix, input.tools, input.maxTokens], ['voice-backfill', true, [], undefined], 'no plugin output cap: the runner applies the official maximum')
  assert.equal(input.taskText, '1. 角色戊〔日语〕：哼，这点小事也要我帮忙？')
  assert.deepEqual(h.writes, ['pending', 'done'])
  assert.equal(h.chat.messages[1].voiceBackfill.status, 'done')
  assert.equal(h.chat.messages[1].text, REPLY, 'the reply text is never rewritten')
  t.diagnostic(JSON.stringify({promptBytes:Buffer.byteLength(VOICE_BACKFILL_PROMPT, 'utf8'), taskBytesPerLine:Buffer.byteLength(input.taskText, 'utf8')}))
})

test('replay and clip export reuse the stored voice text with no model call', async () => {
  const h = harness()
  h.events.emit('reply-committed', {sessionId:'game-a'})
  await h.settle()
  const calls = h.calls.length
  const message = h.chat.messages[1]
  const round = replyBody({turn:2, text:message.text, mode:'markdown'}, h.chat, message)
  // Export (paragraphSpeech) and the stage both read the round body: Japanese voice, Chinese subtitle.
  const exported = paragraphSpeech(h.chat, {turn:2, para:lineOf(round, TRANSLATE).para, segment:lineOf(round, TRANSLATE).segment}, config)
  assert.deepEqual([exported.alias, exported.language, exported.input.text, exported.input.mood], ['fig-07', 'ja', JAPANESE, 'angry'])
  assert.equal(speech(lineOf(round, TRANSLATE)).text, JAPANESE)
  h.events.emit('reply-committed', {sessionId:'game-a'})
  await h.settle()
  assert.equal(h.calls.length, calls, 'a replayed or re-read round never calls the model again')
})

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
