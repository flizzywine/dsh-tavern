// streamed call replies, barge-in and one context per contact.
import test from 'node:test'
import assert from 'node:assert/strict'
import {callRequest,createCallReplyParser,createPhoneCalls,storyAnchor} from '../tavern-plugin/mods/phone/call.js'
import {callGreeting,createCallGreetings} from '../tavern-plugin/mods/phone/call-greeting.js'
import {createCallSections,roundPhoneMessages,storyRoundMessages} from '../tavern-plugin/mods/phone/call-context.js'

import {effectiveBubbleMoods, bubbleVoiceSwitches, bubbleInstructionPreview} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {parseBubbles} from '../tavern-plugin/src/client/bubble-line.cjs'
import {fishSpeechText} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/fish-audio.js'
import {modLibrary} from '../tavern-plugin/lib/mod-library.js'
// the phone's prompt sections, built with the core's mod library as the stage service builds them.
const {callStorySection,callPhoneRecords,callRoundWorldbook,callRecognitionContext}=createCallSections(modLibrary)

test('call voice switches match story rules for every language, enabled and direction combination', () => {
  for (const language of ['ja','zh']) for (const enabled of [false,true]) for (const bound of [false,true]) for (const direction of [false,true]) {
    const character = {alias:'actor_17',name:'辉夜',voice:bound ? 'voice_17' : '',voiceLang:language,voiceDirection:direction}
    const config = {enabled:true,voice:{enabled},characters:[character]}
    const voiceRules = bubbleVoiceSwitches(config, character)
    const request = callRequest({library:modLibrary, contact:{...callee,voiceRules},language,lines:[]})
    const story = bubbleInstructionPreview(config).sections.find(row => row.key === 'voice').text
    assert.equal(request.system.includes('Voice direction ('), story.includes('Voice direction ('))
    assert.equal(request.system.includes('|[voice]'), enabled && bound && language !== 'zh')
    const examples = request.system.match(/<examples>\n([\s\S]*?)\n<\/examples>/)[1]
    assert.equal(examples.includes('{small laugh}'), enabled && bound && direction)
    for (const line of examples.split('\n')) assert.equal(line.split('|').length, voiceRules.voiceTranslates ? 3 : 2)
  }
})

test('call mode supplies contact identity and keeps direction cues on the shared TTS path, never captions or transcript', async () => {
  const identity = {handle:'actor_17',name:'辉夜'}
  assert.deepEqual(parseBubbles('平和|[喂。]',false,{callSpeaker:identity})[0], {...parseBubbles('@bubble:actor_17|辉夜|平和|[喂。]',false)[0]})
  for (const language of ['zh','ja']) {
    const spoken = language === 'zh' ? '你好，接着说。' : 'もしもし。'
    const wire = '平和|[' + (language === 'zh' ? '{softly}' + spoken : '你好。') + ']' + (language === 'ja' ? '|[{softly}' + spoken + ']' : '')
    const parser = createCallReplyParser({library:modLibrary, language,contact:identity})
    for (const char of wire) parser.feed(char)
    parser.finish()
    assert.match(parser.segments[0].say, /\{softly\}/)
    assert.match(fishSpeechText(parser.segments[0].say, {}, true), /\[softly\]/)
    assert.doesNotMatch(parser.segments.map(row => row.sub).join(''), /softly|[{}]/)
    const files = new Map()
    const calls = createPhoneCalls({library:modLibrary, store:{read:async () => null,update:async (id, fn) => files.set(id,fn(files.get(id)))},model:async ({onText}) => onText(wire)})
    const contact = {...callee,voiceRules:{voiceTranslates:language === 'ja',voiceDirection:true}}
    const {callId} = await calls.start({sessionId:'s',chat:chat(1),contact,language})
    contact.voiceRules.voiceDirection = false
    const {turnId} = await calls.turn({sessionId:'s',callId,said:'你好',chat:chat(1)})
    await new Promise(resolve => setImmediate(resolve))
    const {segments} = await calls.poll({sessionId:'s',callId,turnId,waitMs:0})
    await calls.heard({sessionId:'s',callId,turnId,heard:segments.map(row => row.index)})
    assert.doesNotMatch(JSON.stringify(await calls.threads({chat:chat(1)})), /softly|[{}]softly/)
    calls.dispose()
  }
})

const callee = {id:'actor-17', handle:'辉夜', name:'辉夜', defaultEmotion:'m04', moods:effectiveBubbleMoods({characters:[{alias:'actor-17', name:'辉夜', emotions:[{id:'m00',label:'喜悦',words:['开心']},{id:'m04',label:'平和'}]},{alias:'actor-99',name:'无关人物',emotions:[{id:'m99',label:'无关差分'}]}]}, 'actor-17')}

import {createWorldbookRecallLog} from '../tavern-plugin/lib/domain/worldbook-recall-log.js'

test('call uses only anchored card worldbook entries by source ref, in recorded order and frozen at dial', async () => {
  const files = new Map([
    ['worldbook-recalls/chat-fixture/index.json', {records:[
      {turn:2,branchId:'branch-a',path:'round-2'}, {turn:3,branchId:'branch-a',path:'round-3'},
    ]}],
    ['round-2', {entries:[
      {ref:'foreground-capabilities:format',title:'辉夜'}, {ref:'plugin:example/lore/17',title:'人物总览'},
      {ref:'entry:17',title:'Dialogue format'}, {ref:'entry:42',title:'AI检定'},
    ],outputs:[
      {ref:'foreground-capabilities:format',location:'prefix',text:'系统对白格式'},
      {ref:'entry:17',location:'prefix',text:' 常驻设定\n原文 '},
      {ref:'foreground-capabilities:figure:common-roster',location:'prefix',text:'系统说话人名单'},
      {ref:'foreground-capabilities:mod:dsh.dice:rules',location:'prefix',text:'模组检定规则'},
      {ref:'plugin:example/lore/17',location:'foreground',text:'插件注入条目'},
      {ref:'entry:42',location:'foreground',text:'辉夜本轮的设定'},
    ]}],
    ['round-3', {outputs:[{ref:'entry:99',text:'尚未读到的未来'}]}],
  ])
  const recallLog = createWorldbookRecallLog({store:{readJson:async path => files.get(path)}})
  const requests = [], source = {...chat(3),id:'chat-fixture',timeline:{branchId:'branch-a'}}
  assert.equal(await callRoundWorldbook({chat:source,turn:0,recallLog,fallback:() => ''}), '', 'opening without a record must not read the latest round')
  const calls = createPhoneCalls({library:modLibrary, 
    store:{read:async () => null,update:async () => {}},
    context:async ({chat,anchor,phase}) => phase === 'start' ? {promptSections:[{name:'persona',text:await callRoundWorldbook({chat,turn:anchor.turn,recallLog,fallback:() => '不应读取档案'})}]} : {},
    model:async request => {requests.push(request.system)},
  })
  const {callId} = await calls.start({sessionId:'s',chat:source,...contact('actor-17'),at:{turn:2,para:1}})
  await calls.turn({sessionId:'s',callId,said:'你好',chat:source})
  await new Promise(resolve => setImmediate(resolve))
  files.set('round-2',{outputs:[{ref:'entry:17',text:'拨号后改变的文本'}]})
  await calls.turn({sessionId:'s',callId,said:'接着说',chat:source})
  await new Promise(resolve => setImmediate(resolve))
  assert.match(requests[0], /<call_round_worldbook>\n 常驻设定\n原文 \n\n辉夜本轮的设定\n<\/call_round_worldbook>/)
  assert.doesNotMatch(requests[0], /尚未读到|不应读取档案|系统对白格式|系统说话人名单|模组检定规则|插件注入条目/)
  assert.equal(requests[1],requests[0])
  calls.dispose()
})

test('call input is append-only across changing story/plugins, interruption and retraction', async t => {
  const requests = [], files = new Map()
  let serial = 0, plugin = '拨号时的插件', calls
  calls = createPhoneCalls({library:modLibrary, 
    store:{read:async () => null, update:async (id, fn) => files.set(id, fn(files.get(id)))},
    id:() => String(++serial),
    context:async ({phase, chat}) => ({promptSections:[{name:'recent-story', text:chat.messages.at(-1).text}, {name:'plugin',text:plugin}], turnSections:[{text:plugin,position:'before'}]}),
    model:async ({system,messages,onText}) => { requests.push(structuredClone({system,messages})); onText('|[你好。]|[こんにちは。]') },
  })
  const {callId} = await calls.start({sessionId:'s',chat:chat(3),...contact('A')})
  const send = async said => {
    const {turnId} = await calls.turn({sessionId:'s',callId,said,chat:{...chat(9),messages:[{role:'assistant',turn:9,text:'后来发生的秘密'}]}})
    await new Promise(resolve => setImmediate(resolve))
    return turnId
  }
  const first = await send('第一句')
  plugin = '下一回合插件'
  await calls.interrupt({sessionId:'s',callId,turnId:first,heard:[]})
  const second = await send('还没有说完')
  await calls.interrupt({sessionId:'s',callId,turnId:second,retract:true})
  await send('还没有说完，现在说完了')
  await send('最后一句')
  assert.doesNotMatch(requests[0].system, /后来发生的秘密/)
  const bytes = []
  for (let i = 0; i < requests.length; i++) {
    if (i) {
      assert.equal(requests[i].system, requests[i-1].system)
      assert.equal(JSON.stringify(requests[i].messages.slice(0, requests[i-1].messages.length)), JSON.stringify(requests[i-1].messages))
    }
    bytes.push(Buffer.byteLength(requests[i].system) + requests[i].messages.reduce((n,m) => n + Buffer.byteLength(m.content[0].text),0))
  }
  t.diagnostic('input UTF-8 bytes: ' + bytes.join(', ') + '; reusable prefix: 0, ' + bytes.slice(0,-1).join(', '))
  calls.dispose()
})

test('dial context: the latest four rounds in full, then every phone record of the story in round order', async () => {
  const long = '正文全文'.repeat(1000)
  const story = callStorySection([2, 3, 4, 5].map(turn => ({turn, input:turn === 3 ? '我去车站' : '', text:turn === 4 ? long : '第' + turn + '轮正文'})))
  assert.ok(story.includes(long), 'no per-round cut and no total budget')
  assert.match(story, /\[Round 2\]\n第2轮正文\n\n\[Round 3\]\nPlayer: 我去车站\n第3轮正文\n\n\[Round 4\]/)
  assert.ok(story.indexOf('[Round 5]') > story.indexOf(long))
  assert.equal(callStorySection([]), '')
  // A round's input is the user messages before its first reply (they carry no round number); later rounds are not read.
  const rows = storyRoundMessages([{role:'assistant', greeting:true, text:'开场'}, ...[2, 3, 4, 5, 6, 7].flatMap(turn => [{role:'user', text:'输入' + turn}, {role:'assistant', turn, text:'正文' + turn}]),
    {role:'assistant', turn:6, text:'同轮续写'}], 6)
  assert.deepEqual(rows.map(row => [row.turn, row.input.map(m => m.text), row.replies.map(m => m.text)]),
    [[3, ['输入3'], ['正文3']], [4, ['输入4'], ['正文4']], [5, ['输入5'], ['正文5']], [6, ['输入6'], ['正文6', '同轮续写']]])

  const files = new Map([['chat-1', {version:1, threads:{
    B:{calls:[{id:'b1', startedAt:5, anchor:{branchId:'main', turn:4, para:2}, video:true, lines:[{role:'player', text:'看得到我吗', at:6}, {role:'contact', text:'見える', sub:'看得到', at:7}]}]},
    A:{calls:[
      {id:'a1', startedAt:1, anchor:{branchId:'main', turn:1}, lines:[{role:'player', text:'接通', cue:true}, {role:'player', text:'第一通', at:2}]},
      {id:'a2', startedAt:9, anchor:{branchId:'main', turn:5, para:3}, lines:[{role:'player', text:'未读页的通话'}]},
      {id:'a3', startedAt:3, anchor:{branchId:'other', turn:2}, lines:[{role:'player', text:'另一条分支'}]},
    ]},
  }}]])
  let given
  const calls = createPhoneCalls({library:modLibrary, store:{read:async id => structuredClone(files.get(id)), update:async () => {}}, model:async () => {},
    context:async input => { if (input.phase === 'start') given = input; return {} }})
  await calls.start({sessionId:'s', chat:{...chat(6), messages:[5, 6].map(turn => ({role:'assistant', turn, text:'x'}))}, ...contact('A'), at:{turn:5, para:2}})
  assert.deepEqual(given.calls.map(row => row.call.id).sort(), ['a1', 'b1'], 'every contact on this branch through the dial page')
  const marks = roundPhoneMessages(4, {entries:[{at:1, ops:[{op:'mod.command', modId:'dsh.phone', commandId:'mark', params:{contact:'A', side:'in'}}]}, {at:3, ops:[{op:'mod.command', modId:'dsh.phone', commandId:'mark', params:{contact:'A', side:'out', form:'voice'}}]}]},
    [{text:'爱音的短信'}, {text:'旁白'}, {text:'我的语音'}])
  const group = roundPhoneMessages(5, {entries:[{at:1, ops:[{op:'mod.command', modId:'dsh.phone', commandId:'mark', params:{thread:'band', sender:'B', side:'in'}}]}, {at:4, ops:[{op:'mod.command', modId:'dsh.phone', commandId:'mark', params:{contact:'B', side:'in'}}]}]},
    [{text:'群里的话'}, {}, {}, {text:'未读页的短信'}], 2)
  const records = callPhoneRecords({calls:given.calls, messages:[...group, ...marks], names:new Map([['A', '爱音'], ['B', '灯'], ['band', '乐队']]), contact:'爱音', player:'我'})
  const order = ['[Round 1] Phone call: 我 ↔ 爱音', '我：第一通', '[Round 4, page 1] Message 爱音 → 我：爱音的短信', '[Round 4, page 2] FaceTime call: 我 ↔ 灯', '我：看得到我吗\n灯：看得到',
    '[Round 4, page 3] Voice message 我 → 爱音：我的语音', '[Round 5, page 1] Message in group 「乐队」 from 灯：群里的话']
  order.reduce((at, piece) => { const next = records.indexOf(piece, at); assert.ok(next >= at, piece); return next }, 0)
  assert.doesNotMatch(records, /接通|未读页|另一条分支/)
  calls.dispose()
})

function harness() {
  const files = new Map(), requests = []
  let gate = null, serial = 0
  const store = {read:async id => structuredClone(files.get(id) ?? null), update:async (id, fn) => { const next = fn(structuredClone(files.get(id) ?? null)); files.set(id, next); return next }}
  const model = async ({system, messages, signal, onText}) => {
    requests.push({system, messages})
    await new Promise((resolve, reject) => { gate = resolve; signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name:'AbortError'}))) })
    onText('|[第一句]|[一行目]\n'); onText('|[第二句]|[二行目、続き]')
  }
  const calls = createPhoneCalls({library:modLibrary, store, model, now:() => 1000 + serial * 10, id:() => 'id' + ++serial})
  return {files, requests, calls, release:() => gate?.()}
}
const chat = (turn, branchId = 'main') => ({id:'chat-1', timeline:{branchId}, messages:[{role:'assistant', turn, text:'<p>放学后，她在车站等你。</p>'}]})
const contact = id => ({contact:{id, handle:id === 'A' ? 'anon' : 'tomori', name:id === 'A' ? '爱音' : '灯'}, persona:'', language:'ja', playerName:'我'})

// a call keeps the page it was made on.
test('a call is anchored to the page the reader was on, and the phone shows it only from that page on', async () => {
  const h = harness()
  const {callId, anchor} = await h.calls.start({sessionId:'s', chat:{...chat(7), messages:[1, 2, 7].map(turn => ({role:'assistant', turn, text:'x'}))}, ...contact('A'), at:{turn:2, para:5}})
  assert.deepEqual(anchor, {branchId:'main', turn:2, para:5}, 'the round and paragraph on screen, not the latest round')
  await h.calls.turn({sessionId:'s', callId, said:'喂', chat:chat(7)})
  await h.calls.end({sessionId:'s', callId})
  const [row] = (await h.calls.threads({chat:chat(7)})).threads.A
  assert.deepEqual([row.turn, row.para], [2, 5])
  // Checked once as it enters: a page past the story, or none, is the latest round (no paragraph).
  assert.deepEqual(storyAnchor(chat(7), {turn:9, para:1}), {branchId:'main', turn:7})
  assert.deepEqual(storyAnchor(chat(7), {turn:3, para:0}), {branchId:'main', turn:7})
  // The client helper (a browser script): its declaration ahead of the call controller.
  const source = await (await import('node:fs/promises')).readFile(new URL('../tavern-plugin/src/client/phone-call.js', import.meta.url), 'utf8')
  const phoneModCallsAt = new Function(source.slice(0, source.indexOf('const phoneModCall =')) + 'return phoneModCallsAt;')()
  const state = {status:'idle', threads:{A:[{id:'old', turn:1}, {id:'c', turn:2, para:5}], B:[{id:'later', turn:3, para:1}]}}
  const ids = value => Object.values(value.threads).flat().map(item => item.id)
  assert.deepEqual(ids(phoneModCallsAt(state, 2, 4)), ['old'], 'before its page the call has not happened yet')
  assert.deepEqual(ids(phoneModCallsAt(state, 2, 5)), ['old', 'c'])
  assert.equal(phoneModCallsAt(state, 3, 1), state, 'nothing held back: the same state, not sent again')
  assert.deepEqual(ids(phoneModCallsAt({threads:{A:[{id:'legacy', turn:2}]}}, 2, 1)), ['legacy'], 'a record without its page shows from its round on')
})

test('model completion does not publish unplayed transcript; only audio-clock receipts survive hang-up', async () => {
  const h = harness()
  const {callId} = await h.calls.start({sessionId:'s',chat:chat(3),...contact('A')})
  const {turnId} = await h.calls.turn({sessionId:'s',callId,said:'你是谁？',chat:chat(3)})
  await new Promise(resolve => setImmediate(resolve));h.release()
  while (!(await h.calls.poll({sessionId:'s',callId,turnId,waitMs:0})).done) await new Promise(resolve => setImmediate(resolve))
  const lines = async () => (await h.calls.threads({chat:chat(3)})).threads.A[0].lines
  assert.deepEqual((await lines()).map(l=>l.text), ['你是谁？'], 'generated audio is not a spoken transcript')
  await assert.rejects(h.calls.heard({sessionId:'other',callId,turnId,heard:[0]}), {code:'PHONE_CALL_GONE'})
  await assert.rejects(h.calls.heard({sessionId:'s',callId,turnId,heard:[2]}), {code:'INVALID_INPUT'})
  await h.calls.heard({sessionId:'s',callId,turnId,heard:[0]})
  await h.calls.end({sessionId:'s',callId,turnId,heard:[0]})
  assert.deepEqual((await lines()).map(l=>[l.text,l.sub]), [['你是谁？',undefined],['一行目','第一句']])
  assert.equal((await lines())[1].interrupted,true)
  h.calls.dispose()
})
test('call records retain numeric timing, usage and model identity through greeting, retract and hang-up', async () => {
  let doc, tick = 0, serial = 0
  const calls = createPhoneCalls({library:modLibrary, 
    store:{read:async () => doc,update:async (id, fn) => { doc = fn(doc) }},
    clock:() => ++tick, id:() => String(++serial),
    serviceState:async () => ({serviceId:'fake',state:'loading'}),
    context:async () => ({selection:{model:'fixture-model',provider:'fixture-provider',reasoningEffort:'off'}}),
    model:async ({onText,onChunk}) => {
      onChunk({type:'block-start',blockType:'reasoning'})
      onText('|[你好。]|[もしもし。]')
      onChunk({type:'usage',usage:{input:3,output:4,cacheRead:80,cacheWrite:10,privateText:'discard'}})
    },
  })
  const {callId} = await calls.start({sessionId:'s',chat:chat(1),...contact('A')})
  const {turnId,elapsedMs} = await calls.turn({sessionId:'s',callId,chat:chat(1),said:'greeting',cue:true,timing:{origin:2,rpcSentMs:0}})
  assert.ok(elapsedMs >= 0)
  await new Promise(resolve => setImmediate(resolve))
  await calls.ttsRequested({sessionId:'s',callId,turnId})
  await calls.heard({sessionId:'s',callId,turnId,heard:[0],timing:{ringToFirstPcmMs:2100,origin:1,endpointMs:0,hostStartMs:-50,clockErrorMs:2,ttsRequestMs:-30,firstPcmMs:-20,scheduledMs:20,audibleMs:220,outputLatencyMs:200,interruptions:0,stalls:1,outcome:1}})
  const next = await calls.turn({sessionId:'s',callId,chat:chat(1),said:'unfinished',timing:{origin:0,speechEndMs:0,asrFinalMs:150,rpcSentMs:160}})
  await calls.interrupt({sessionId:'s',callId,turnId:next.turnId,retract:true,timing:{outcome:3}})
  await calls.end({sessionId:'s',callId})
  await new Promise(resolve => setImmediate(resolve))
  const record = doc.threads.A.calls[0], rows = Object.values(record.timings)
  assert.equal(rows.length,2)
  assert.deepEqual(record.timingModel,{slot:'dsh.phone/call',model:'fixture-model',provider:'fixture-provider',reasoningEffort:'off'})
  assert.equal(rows[0].ttsService.state,'loading')
  assert.equal(rows[0].ttsService.serviceId,'fake')
  assert.ok(rows[0].ttsService.observedAt >= rows[0].ttsService.requestedAt)
  assert.equal(rows[0].client.ringToFirstPcmMs,2100)
  assert.equal(rows[0].cue,1); assert.equal(rows[0].client.origin,1); assert.equal(rows[0].client.audibleMs,220)
  assert.deepEqual(rows[0].model.usage,{input:3,output:4,cacheRead:80,cacheWrite:10})
  assert.ok(rows[0].model.bytes.system > 0 && rows[0].model.bytes.messages > 0)
  for (const key of ['contextMs','requestMs','thinkMs','textMs','firstSayMs','totalMs']) assert.ok(Number.isFinite(rows[0].model[key]),key)
  assert.equal(rows[1].client.interruptions,1); assert.equal(rows[1].client.outcome,3)
  assert.equal(rows[1].client.asrFinalMs,150)
  assert.ok(Object.values(rows[0].client).every(Number.isFinite))
  assert.equal(JSON.stringify(await calls.threads({chat:chat(1)})).includes('timings'),false)
})

// FaceTime (§2.6): the record says the call was on video; the camera's quiet line goes to
// the model before the player's words, once, and never into the transcript or the 电话 app.
test('a FaceTime call is recorded as video and its camera note reaches only the model', async () => {
  const files=new Map(),requests=[];let serial=0
  const calls=createPhoneCalls({library:modLibrary, id:()=>String(++serial),store:{read:async id=>files.get(id),update:async(id,fn)=>files.set(id,fn(files.get(id)))},
    model:async input=>{requests.push(structuredClone(input.messages));input.onText('|[看到了。]')}})
  const {callId}=await calls.start({sessionId:'s',chat:chat(3),...contact('A'),language:'zh'})
  await calls.video({sessionId:'s',callId})
  const note='（对方打开了摄像头，你能看到对方）'
  const {turnId}=await calls.turn({sessionId:'s',callId,chat:chat(3),said:'看得到我吗？',note})
  while(!(await calls.poll({sessionId:'s',callId,turnId,waitMs:0})).done)await new Promise(resolve=>setImmediate(resolve))
  const second=(await calls.turn({sessionId:'s',callId,chat:chat(3),said:'好的。'})).turnId
  while(!(await calls.poll({sessionId:'s',callId,turnId:second,waitMs:0})).done)await new Promise(resolve=>setImmediate(resolve))
  await calls.end({sessionId:'s',callId,turnId:second,heard:[0]})
  assert.equal(requests[0].at(-1).content[0].text,note+'\n看得到我吗？')
  assert.equal(requests[1].filter(row=>row.content[0].text.includes(note)).length,1,'the note is sent once and stays in the append-only log')
  assert.equal(requests[1].at(-1).content[0].text,'好的。')
  const [row]=(await calls.threads({chat:chat(3)})).threads.A
  assert.equal(row.video,true)
  assert.ok(row.lines.every(line=>!line.text.includes('摄像头')),'the transcript has only what was said')
  assert.equal(files.get(chat(3).id).threads.A.calls[0].video,true)
  calls.dispose()
})
// microphone chunk boundaries must not turn voiced frames into NaN/silence.
test('call resampling preserves every voiced frame across 48/44.1 kHz chunks', async () => {
  const {readFile} = await import('node:fs/promises')
  const {runInNewContext} = await import('node:vm')
  const source = await readFile(new URL('../tavern-plugin/src/client/phone-call.js', import.meta.url), 'utf8')
  const resampler = runInNewContext(source.slice(0, source.indexOf('const phoneModCall =')) + '\ncallResampler')
  for (const rate of [48000, 44100, 16000]) {
    const input = Float32Array.from({length:rate * 2}, (_, i) => 0.3 + 0.1 * Math.sin(i * 2 * Math.PI * 220 / rate))
    const whole = resampler(rate)(input)
    for (const sizes of [[2048], [1, 17, 2048, 3, 511]]) {
      const push = resampler(rate), samples = []
      for (let at = 0, n = 0; at < input.length; n++) {
        const size = sizes[n % sizes.length]
        samples.push(...push(input.subarray(at, at + size))); at += size
      }
      assert.equal(samples.length, 32000)
      assert.ok(samples.every(Number.isFinite), 'no NaN at chunk boundaries')
      assert.deepEqual(samples, Array.from(whole), 'chunking preserves samples and phase')
      let voiced = 0
      for (let at = 0; at + 320 <= samples.length; at += 320) {
        const energy = samples.slice(at, at + 320).reduce((sum, value) => sum + value * value, 0) / 320
        if (10 * Math.log10(energy) > -46) voiced++
      }
      assert.equal(voiced, 100, 'every 20 ms voiced frame survives the VAD energy calculation')
    }
  }
})

test('call recognition hints use roster names only and leave all other prompt bytes intact', async t => {
  const {phonePeople} = await import('../tavern-plugin/mods/phone/threads.js')
  const people = phonePeople([
    {actorKey:'actor-17',name:'\u8f89\u591c'},
    {actorKey:'actor-18',name:'\u5f69\u53f6'},
    {actorKey:'actor-19',name:'Hidden',enabled:false},
  ])
  const hint = callRecognitionContext(callee, people)
  assert.match(hint, /<call_speech_recognition>/)
  assert.match(hint, /speech recognition/)
  assert.ok(hint.endsWith('- Names: \u8f89\u591c, \u5f69\u53f6\n</call_speech_recognition>'))
  assert.doesNotMatch(hint, /actor-|Hidden/)
  assert.equal(callRecognitionContext({}, []), '')
  const sections = [{name:'existing',text:'<existing>\nUnchanged context.\n</existing>'}]
  const args = {contact:callee,language:'zh',lines:[{role:'player',text:'misheard name'}]}
  const before = callRequest({library:modLibrary, ...args,context:{promptSections:sections}})
  const after = callRequest({library:modLibrary, ...args,context:{promptSections:[...sections,{name:'call-speech-recognition',text:hint}]}})
  assert.equal(after.system, before.system + '\n\n' + hint)
  assert.deepEqual(after.messages, before.messages)
  for (const [key, bytes] of Object.entries(before.bytes.sections)) assert.equal(after.bytes.sections[key], bytes)
  t.diagnostic('recognition section UTF-8 bytes=' + Buffer.byteLength(hint) + '; net system bytes=' + (after.bytes.system - before.bytes.system))
})
for (const roundCount of [0, 12]) test(`production dial context and call start accept a chat with ${roundCount} story rounds`, async () => {
  const {readFileSync} = await import('node:fs')
  const {default:vm} = await import('node:vm')
  const {createCardPreparation} = await import('../tavern-plugin/lib/domain/card-preparation.js')
  const source = readFileSync(new URL('../tavern-plugin/mods/phone/host/extension.js', import.meta.url), 'utf8')
  const start = source.indexOf('    context:async ({sessionId, contact, input, anchor, phase, calls, playerName}) => {')
  const end = source.indexOf('\n  })', start)
  const empty = {id:'empty-chat', sessionId:'empty-session', cardPath:'cards/empty.json', messages:Array.from({length:roundCount}, (_, index) => ({role:'assistant', turn:index + 1, content:'Story round ' + (index + 1)}))}
  const preparation = createCardPreparation({id:() => 'card-empty'})
  const workspace = preparation.create({kind:'import', payload:{name:'Empty', description:'A new story'}})
  const card = preparation.project(workspace)
  assert.equal(card.meta, undefined, 'runtime projections do not carry workspace identity')
  const context = vm.runInNewContext('({' + source.slice(start, end) + '}).context', {
    readRoundOps:async () => ({records:new Map(), view:async () => empty}),
    readChatCard:async () => card,
    readModCard:async path => { assert.equal(path, empty.cardPath); return workspace },
    modConfigHost:{store:{read:async args => { assert.equal(args.cardId, workspace.meta.id); return {card:{}, global:{}} }}},
    replyDisplayForChat:async () => ({projections:[]}),
    projectAgentMessageText:row => row.content,
    stagePhoneDirectory:async () => ({threads:[]}), PHONE_FIGURES:Symbol(), phonePeople:() => [],
    pluginApi:{promptSections:async () => [], turnContext:async () => []}, resolveSlot:async () => ({}),
    storyRoundMessages, phoneMarkRounds:(await import('../tavern-plugin/mods/phone/call-context.js')).phoneMarkRounds,
    roundPhoneMessages, callStorySection, callPhoneRecords,
    callRecognitionContext,
  }, {filename:'tavern-plugin/mods/phone/host/extension.js', lineOffset:source.slice(0,start).split('\n').length - 1})
  const sections = await context({sessionId:empty.sessionId, contact:callee, anchor:storyAnchor(empty), phase:'start', calls:[], playerName:'Player'})
  const story = sections.promptSections.find(row => row.name === 'recent-story').text
  if (roundCount) assert.match(story, /Story round 12/)
  else assert.equal(story, '')
  const calls = createPhoneCalls({library:modLibrary, store:{read:async () => null, update:async () => {}}, context})
  try {
    const started = await calls.start({sessionId:empty.sessionId, chat:empty, contact:callee, language:'zh'})
    assert.ok(started.callId)
    assert.equal(started.anchor.turn, roundCount)
  } finally { calls.dispose() }
})
// Her first sound (call-greeting.js): a fixed line in her voice language, made in idle time and read from the voice cache.
test('her cached greeting enters the record after the dial cue once it sounded, before her reply', async () => {
  const h = harness()
  const {callId} = await h.calls.start({sessionId:'s', chat:chat(3), ...contact('A'), greeting:callGreeting('ja', 'm04')})
  const {turnId} = await h.calls.turn({sessionId:'s', callId, said:'（电话接通了。你接起电话，已经说了「喂？」，接着往下说。）', cue:true, chat:chat(3)})
  await new Promise(resolve => setImmediate(resolve))
  h.release()
  await new Promise(resolve => setImmediate(resolve))
  await h.calls.heard({sessionId:'s', callId, turnId, heard:[0]})
  assert.deepEqual(await h.calls.greeted({sessionId:'s', callId}), {accepted:true})
  assert.deepEqual(await h.calls.greeted({sessionId:'s', callId}), {accepted:false})
  await h.calls.end({sessionId:'s', callId})
  const saved = h.files.get('chat-1').threads.A.calls[0]
  assert.deepEqual(saved.lines.map(line => [line.role, line.cue === true, line.text, line.sub]), [['player', true, '（电话接通了。你接起电话，已经说了「喂？」，接着往下说。）', undefined],
    ['contact', false, 'もしもし？', '喂？'], ['contact', false, '一行目', '第一句']])
  assert.equal(saved.lines[1].segments[0].mood, 'm04')
  // A call without a cached greeting has none to record.
  const plain = await h.calls.start({sessionId:'s', chat:chat(3), ...contact('B')})
  assert.deepEqual(await h.calls.greeted({sessionId:'s', callId:plain.callId}), {accepted:false})
  h.calls.dispose()
})

test('greetings are made one at a time, only after the app has been idle a while', async () => {
  let now = 0, busy = false
  const timers = [], made = []
  const greetings = createCallGreetings({idle:() => !busy, quietMs:20, checkMs:5, clock:() => now,
    prepare:async entry => { made.push(entry.contactId); if (entry.contactId === 'bad') throw new Error('offline') },
    timer:{set:fn => { timers.push(fn); return fn }, clear:fn => { const at = timers.indexOf(fn); if (at >= 0) timers.splice(at, 1) }}})
  const step = async ms => { now += ms; const fn = timers.shift(); if (fn) await fn() }
  greetings.want({sessionId:'s', contactId:'bad'}); greetings.want({sessionId:'s', contactId:'A'}); greetings.want({sessionId:'s', contactId:'A'})
  assert.deepEqual(greetings.pending().map(row => row.contactId), ['bad', 'A'])
  busy = true
  for (let i = 0; i < 6; i++) await step(5)
  assert.deepEqual(made, [], 'nothing while a turn, voice or call is under way')
  busy = false
  await step(5); await step(5); await step(5); await step(5); await step(5)
  assert.deepEqual(made, ['bad'], 'the first once the app has been quiet for quietMs')
  for (let i = 0; i < 6; i++) await step(5)
  assert.deepEqual(made, ['bad', 'A'])
  assert.deepEqual(greetings.pending(), [])
  assert.equal(timers.length, 0, 'no polling with nothing to make')
  assert.deepEqual(callGreeting('zh', 'm01'), {say:'喂？', sub:'喂？', mood:'m01'})
  assert.equal(callGreeting('fr', 'm01'), null)
  greetings.dispose()
})
// The phone's host side is its stage service (mods/phone/host/extension.js, stage.js hostExtension): its requests are
// built from the stage's request bindings, answer from the phone's own directory and call host, and a card with the phone
// off answers as off; its live calls are reported to deployment (work).
test('phone stage service requests answer from the phone host built from the request bindings', async () => {
  const {createPhoneExtension} = await import('../tavern-plugin/mods/phone/host/extension.js')
  const {createStageExtensions} = await import('../tavern-plugin/packages/dsh-tavern-stage/lib/stage-extensions.js')
  const {default:stage} = await import('../tavern-plugin/mods/phone/stage.js')
  assert.equal(stage.hostExtension, createPhoneExtension)
  const cleanups = [], sections = [], routes = new Map()
  const chat = {id:'chat-1', sessionId:'s', cardPath:'cards/a.json', messages:[]}, readStageChat = {view:async () => chat}
  const extensions = createStageExtensions()
  extensions.register('dsh.phone', createPhoneExtension)
  extensions.start({ctx:{effect:install => cleanups.push(install()), get:() => undefined}})
  extensions.bind({register:(id, requests) => { routes.set(id, requests); return () => routes.delete(id) }}, {
    managedModManagement:{enabled:async ({modId}) => { assert.equal(modId, 'dsh.phone'); return false }}, readStageChat, chatForSession:async () => chat,
    pluginApi:{builtinPromptSection:(entry, owner) => owner.effect(() => {
      sections.push(entry.target + ':' + entry.name)
      return () => sections.pop()
    })},
    speechRecognition:{readiness:async () => ({available:false})}, hostLibrary:{}})
  assert.deepEqual(sections, ['call:persona'])
  assert.ok(routes.get('stage.extension.dsh.phone').methods.includes('phoneCallStart'))
  assert.deepEqual(await extensions.call('getStagePhoneThreads', {sessionId:'s'}), {enabled:false, contacts:[], threads:[]})
  await assert.rejects(extensions.call('phoneCallStart', {sessionId:'s', contactId:'A'}), /手机模组没有为这张卡开启/)
  assert.deepEqual(extensions.works().map(work => work()), [{calls:0}])
  extensions.dispose()
  for (const cleanup of cleanups.reverse()) cleanup()
  assert.deepEqual(sections, [], 'the call persona section goes with the stage')
})