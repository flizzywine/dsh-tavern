// streamed call replies, barge-in and one context per contact.
import test from 'node:test'
import assert from 'node:assert/strict'
import {callRequest,createCallReplyParser,createPhoneCalls,storyAnchor} from '../tavern-plugin/mods/phone/call.js'
import {callGreeting,createCallGreetings} from '../tavern-plugin/mods/phone/call-greeting.js'
import {callStorySection,callPhoneRecords,roundPhoneMessages,storyRoundMessages} from '../tavern-plugin/mods/phone/call-context.js'

import {effectiveBubbleMoods, bubbleVoiceSwitches, bubbleInstructionPreview} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {parseBubbles} from '../tavern-plugin/src/client/bubble-line.cjs'
import {fishSpeechText} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/fish-audio.js'

test('call voice switches match story rules for every language, enabled and direction combination', () => {
  for (const language of ['ja','zh']) for (const enabled of [false,true]) for (const bound of [false,true]) for (const direction of [false,true]) {
    const character = {alias:'actor_17',name:'辉夜',voice:bound ? 'voice_17' : '',voiceLang:language,voiceDirection:direction}
    const config = {enabled:true,voice:{enabled},characters:[character]}
    const voiceRules = bubbleVoiceSwitches(config, character)
    const request = callRequest({contact:{...callee,voiceRules},language,lines:[]})
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
    const parser = createCallReplyParser({language,contact:identity})
    for (const char of wire) parser.feed(char)
    parser.finish()
    assert.match(parser.segments[0].say, /\{softly\}/)
    assert.match(fishSpeechText(parser.segments[0].say, {}, true), /\[softly\]/)
    assert.doesNotMatch(parser.segments.map(row => row.sub).join(''), /softly|[{}]/)
    const files = new Map()
    const calls = createPhoneCalls({store:{read:async () => null,update:async (id, fn) => files.set(id,fn(files.get(id)))},model:async ({onText}) => onText(wire)})
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

test('call format is self-contained and contains only the callee and her variants', () => {
  for (const language of ['ja','zh']) {
    const request = callRequest({contact:{...callee,handle:'kaguya'},language,playerName:'彩叶',lines:[]})
    assert.deepEqual(Object.keys(request.bytes.sections), ['phone-call'])
    assert.match(request.system, /variant\|\[text\]/)
    assert.match(request.system, /from: `喜悦`, `平和`/)
    assert.match(request.system, /Use `平和` by default/)
    for (const tag of ['phone_call_role','call_dialogue_format','examples']) {
      assert.equal(request.system.split('<' + tag + '>').length, 2)
      assert.equal(request.system.split('</' + tag + '>').length, 2)
    }
    const examples = request.system.match(/<examples>\n([\s\S]*?)\n<\/examples>/)[1].split('\n')
    assert.equal(examples.length, 3)
    for (const line of examples) {
      assert.match(line, /^(平和|喜悦)\|\[/)
      assert.equal(line.split('|').length, language === 'ja' ? 3 : 2)
    }
    assert.doesNotMatch(request.system, /无关人物|无关差分|actor-99|沿用舞台|差分留空|lin_yue|hinata/)
    assert.equal(request.system.includes('|[voice]'), language === 'ja')
    assert.equal(request.system.includes('Japanese voice text'), language === 'ja')
  }
})

test('call moods use stage labels and aliases, with the callee default for empty or unknown variants', async () => {
  for (const language of ['zh','ja']) {
    const parser = createCallReplyParser({language,moods:callee.moods,defaultEmotion:callee.defaultEmotion})
    for (const word of ['喜悦','开心','','不存在']) parser.feed('' + word + '|[第一子句，第二子句。]' + (language === 'ja' ? '|[うん。]' : '') + '\n')
    parser.finish()
    assert.deepEqual(parser.segments.map(row => row.mood), language === 'ja' ? ['m00','m00','m04','m04'] : ['m00','m00','m00','m00','m04','m04','m04','m04'])
  }
  const requests = []
  let serial = 0
  const calls = createPhoneCalls({store:{read:async()=>null,update:async()=>{}},id:()=>String(++serial), model:async input => {requests.push(input); input.onText('开心|[好。]')}})
  const {callId} = await calls.start({sessionId:'s',chat:chat(1),contact:callee,language:'zh'})
  const {turnId} = await calls.turn({sessionId:'s',callId,said:'你好',chat:chat(1)})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await calls.poll({sessionId:'s',callId,turnId,waitMs:0})).segments[0].mood,'m00')
  await calls.turn({sessionId:'s',callId,said:'继续',chat:chat(1)})
  assert.match(requests[1].messages[1].content[0].text, /喜悦\|/)
  calls.dispose()
})

import {callRoundWorldbook,callDesignPersona} from '../tavern-plugin/mods/phone/call-context.js'
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
  const calls = createPhoneCalls({
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

test('call falls back to the unchanged contact design when its round has no nonempty card entries; empty when neither', async () => {
  const design = callDesignPersona({identity:'身份',personality:'性格',appearance:'外貌',speechStyle:'说话方式',narrativeRole:'角色职责',relationships:'不存在的字段'})
  assert.equal(design,'身份\n性格\n外貌\n说话方式\n角色职责')
  for (const log of [null,{outputs:[]},{outputs:[
    {ref:'foreground-capabilities:format',text:'系统对白格式'},
    {ref:'plugin:example/lore/17',text:'插件注入条目'},
    {ref:'entry:17',text:' \n '},
  ]}]) {
    const recallLog = {read:async () => ({log})}
    assert.equal(await callRoundWorldbook({chat:{id:'chat-17'},turn:2,recallLog,fallback:() => '# 辉夜的资料\n'+design}), '# 辉夜的资料\n'+design)
    assert.equal(await callRoundWorldbook({chat:{id:'chat-17'},turn:2,recallLog,fallback:() => callDesignPersona()}), '')
  }
})

test('call captions have independently synthesized clauses, with explicit foreign subtitle/voice pairs', () => {
  const parser = createCallReplyParser({language:'ja'})
  assert.deepEqual(parser.feed('|[喂，]|[もしもし、'), [])
  assert.deepEqual(parser.feed(']'), [{type:'say',index:0,say:'もしもし、',mood:'default'}, {type:'sub',index:0,sub:'喂，'}])
  parser.feed('\n|[你现在在哪儿？]|[どこ？]')
  assert.deepEqual(parser.segments, [{say:'もしもし、',sub:'喂，',mood:'default'}, {say:'どこ？',sub:'你现在在哪儿？',mood:'default'}], 'translation length never determines audio alignment')
  const chinese = createCallReplyParser()
  chinese.feed('|[第一句，第二句，最后的秘密。]'); chinese.finish()
  assert.deepEqual(chinese.segments, [{say:'第一句，',sub:'第一句，',part:true,mood:'default'}, {say:'第二句，',sub:'第二句，',part:true,mood:'default'}, {say:'最后的秘密。',sub:'最后的秘密。',mood:'default'}])
  const loose = createCallReplyParser()
  loose.feed('喂？')
  assert.deepEqual(loose.finish(), [], 'unmarked prose is never accidentally spoken')
})

test('call input is append-only across changing story/plugins, interruption and retraction', async t => {
  const requests = [], files = new Map()
  let serial = 0, plugin = '拨号时的插件', calls
  calls = createPhoneCalls({
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
  const calls = createPhoneCalls({store:{read:async id => structuredClone(files.get(id)), update:async () => {}}, model:async () => {},
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
  const calls = createPhoneCalls({store, model, now:() => 1000 + serial * 10, id:() => 'id' + ++serial})
  return {files, requests, calls, release:() => gate?.()}
}
const chat = (turn, branchId = 'main') => ({id:'chat-1', timeline:{branchId}, messages:[{role:'assistant', turn, text:'<p>放学后，她在车站等你。</p>'}]})
const contact = id => ({contact:{id, handle:id === 'A' ? 'anon' : 'tomori', name:id === 'A' ? '爱音' : '灯'}, persona:'', language:'ja', playerName:'我'})

test('a call keeps only what she started saying when the player cuts in, and stays with its own contact', async () => {
  const h = harness()
  const {callId} = await h.calls.start({sessionId:'s', chat:chat(3), ...contact('A')})
  const {turnId} = await h.calls.turn({sessionId:'s', callId, said:'在吗', chat:chat(3)})
  await new Promise(resolve => setImmediate(resolve))
  h.release()
  await new Promise(resolve => setImmediate(resolve))
  const polled = await h.calls.poll({sessionId:'s', callId, turnId, waitMs:0})
  assert.deepEqual(polled.segments.map(row => row.say), ['一行目', '二行目、続き'])
  // She had started the first line when the player spoke over her: the second is gone from the record.
  await h.calls.interrupt({sessionId:'s', callId, turnId, heard:[0]})
  await h.calls.end({sessionId:'s', callId})
  const saved = h.files.get('chat-1').threads.A.calls[0]
  assert.deepEqual(saved.anchor, {branchId:'main', turn:3})
  assert.deepEqual(saved.lines.map(line => [line.role, line.text, line.interrupted === true]), [['player', '在吗', false], ['contact', '一行目', true]])

  h.calls.dispose()
})

test('her line cut for speech is one line again in the record and in the next request', async () => {
  const files = new Map(), requests = []
  const store = {read:async id => structuredClone(files.get(id) ?? null), update:async (id, fn) => { files.set(id, fn(structuredClone(files.get(id) ?? null))) }}
  const model = async ({messages, onText}) => { requests.push(messages); onText('|[嗯，对。回头见。]|[うん、そう。またね。]') }
  let serial = 0
  const calls = createPhoneCalls({store, model, now:() => ++serial, id:() => 'id' + serial})
  const {callId} = await calls.start({sessionId:'s', chat:chat(2), ...contact('A')})
  const {turnId} = await calls.turn({sessionId:'s', callId, said:'是吗', chat:chat(2)})
  const polled = await calls.poll({sessionId:'s', callId, turnId, waitMs:1000})
  while (!(await calls.poll({sessionId:'s', callId, turnId, waitMs:0})).done) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(polled.segments.map(row => [row.say, row.sub]), [['うん、そう。またね。', '嗯，对。回头见。']])
  await calls.heard({sessionId:'s',callId,turnId,heard:polled.segments.map(row=>row.index)})
  await calls.turn({sessionId:'s', callId, said:'好', chat:chat(2)})
  assert.equal(requests[1].find(row => row.role === 'assistant').content[0].text, '|[嗯，对。回头见。]|[うん、そう。またね。]')
  await calls.end({sessionId:'s', callId})
  const saved = files.get('chat-1').threads.A.calls[0].lines[1]
  assert.deepEqual([saved.text, saved.sub], ['うん、そう。またね。', '嗯，对。回头见。'])
})

test('calls belong to the story position they happened at', async () => {
  const h = harness()
  const {callId} = await h.calls.start({sessionId:'s', chat:chat(5), ...contact('A')})
  await h.calls.turn({sessionId:'s', callId, said:'第五回合打来的', chat:chat(5)})
  await h.calls.end({sessionId:'s', callId})
  assert.equal(Object.keys((await h.calls.threads({chat:chat(5)})).threads).length, 1)
  // Rewound to before the call, or on another branch: that call has not happened.
  assert.deepEqual((await h.calls.threads({chat:chat(4)})).threads, {})
  assert.deepEqual((await h.calls.threads({chat:chat(9, 'b2')})).threads, {})
  assert.deepEqual(storyAnchor({messages:[{role:'assistant', greeting:true}]}), {branchId:'main', turn:1})
})

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

test('a reply started at a pause is retracted with the player\'s words when they go on, and the turn measures where its time went', async () => {
  const h = harness()
  const {callId} = await h.calls.start({sessionId:'s', chat:chat(3), ...contact('A')})
  // The pause inside the sentence: a request goes out; the player goes on talking, so both lines are forgotten.
  const first = await h.calls.turn({sessionId:'s', callId, said:'我刚到家然后', chat:chat(3)})
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(await h.calls.interrupt({sessionId:'s', callId, turnId:first.turnId, heard:[], retract:true}), {interrupted:true, kept:0})
  assert.deepEqual(await h.calls.poll({sessionId:'s', callId, turnId:first.turnId, waitMs:0}), {segments:[], done:true, superseded:true})
  const {turnId} = await h.calls.turn({sessionId:'s', callId, said:'我刚到家然后突然很想你？', chat:chat(3)})
  await new Promise(resolve => setImmediate(resolve))
  // Model input keeps the already sent fragment plus a correction; the audible record below does not.
  const messages = h.requests.at(-1).messages.map(row => row.content[0].text)
  assert.equal(messages[0], '我刚到家然后')
  assert.match(messages[1], /尚未说完/)
  assert.equal(messages[2], '我刚到家然后突然很想你？')
  h.release()
  while (!(await h.calls.poll({sessionId:'s', callId, turnId, waitMs:0})).done) await new Promise(resolve => setImmediate(resolve))
  const {timing} = await h.calls.poll({sessionId:'s', callId, turnId, waitMs:0})
  // Prompt size per section, the first text, how the text arrived, the first spoken piece and the end.
  assert.deepEqual(Object.keys(timing.bytes.sections), ['phone-call'])
  assert.ok(timing.bytes.system > 500 && timing.bytes.messages > 0 && timing.bytes.turns === 3)
  assert.ok(timing.contextMs >= 0 && timing.requestMs >= timing.contextMs && timing.textMs >= timing.requestMs && timing.firstSayMs >= timing.textMs && timing.totalMs >= timing.firstSayMs)
  assert.equal(timing.deltas, 2)
  const final = await h.calls.poll({sessionId:'s',callId,turnId,waitMs:0})
  await h.calls.end({sessionId:'s', callId,turnId,heard:final.segments.map(row=>row.index)})
  assert.deepEqual(h.files.get('chat-1').threads.A.calls[0].lines.map(line => line.text), ['我刚到家然后突然很想你？', '一行目二行目、続き'])
  h.calls.dispose()
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
test('a Chinese playback receipt supplies the dialer subtitle without marking a finished line interrupted', async () => {
  const files=new Map();let serial=0
  const calls=createPhoneCalls({id:()=>String(++serial),store:{read:async id=>files.get(id),update:async(id,fn)=>files.set(id,fn(files.get(id)))},
    model:async({onText})=>onText('|[我是辉夜。]')})
  const {callId}=await calls.start({sessionId:'s',chat:chat(3),...contact('A'),language:'zh'})
  const {turnId}=await calls.turn({sessionId:'s',callId,chat:chat(3),said:'你是谁？'})
  while(!(await calls.poll({sessionId:'s',callId,turnId,waitMs:0})).done)await new Promise(resolve=>setImmediate(resolve))
  await calls.end({sessionId:'s',callId,turnId,heard:[0]})
  const line=(await calls.threads({chat:chat(3)})).threads.A[0].lines[1]
  assert.equal(line.text,'我是辉夜。');assert.equal(line.sub,'我是辉夜。');assert.equal(line.interrupted,undefined)
  calls.dispose()
})
test('call records retain numeric timing, usage and model identity through greeting, retract and hang-up', async () => {
  let doc, tick = 0, serial = 0
  const calls = createPhoneCalls({
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
  const calls=createPhoneCalls({id:()=>String(++serial),store:{read:async id=>files.get(id),update:async(id,fn)=>files.set(id,fn(files.get(id)))},
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
  const {callRecognitionContext} = await import('../tavern-plugin/mods/phone/call-context.js')
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
  const before = callRequest({...args,context:{promptSections:sections}})
  const after = callRequest({...args,context:{promptSections:[...sections,{name:'call-speech-recognition',text:hint}]}})
  assert.equal(after.system, before.system + '\n\n' + hint)
  assert.deepEqual(after.messages, before.messages)
  for (const [key, bytes] of Object.entries(before.bytes.sections)) assert.equal(after.bytes.sections[key], bytes)
  t.diagnostic('recognition section UTF-8 bytes=' + Buffer.byteLength(hint) + '; net system bytes=' + (after.bytes.system - before.bytes.system))
})
test('phone records include only this chat anchored photos through the dial page, as short text in story order', t => {
  const photo=(name,turn,para,chatId='this-chat')=>({file:'files/'+name+'.webp',name,anchor:{chatId,branchId:'branch',turn,para},data:'data:image/webp;base64,SECRET'})
  const photos=[photo('Later',8,3),photo('Earlier',7,2),photo('Other chat',6,1,'other'),photo('Legacy',6,1,undefined),{file:'files/import.webp',name:'Imported'},photo('Future',8,5)]
  delete photos[3].anchor.chatId
  const records=callPhoneRecords({photos,chatId:'this-chat',anchor:{turn:8,para:3},contact:'Alice',player:'Player'})
  assert.match(records,/\[Round 7, page 2\] FaceTime photo: Earlier/)
  assert.match(records,/\[Round 8, page 3\] FaceTime photo: Later/)
  assert.ok(records.indexOf('Earlier')<records.indexOf('Later'))
  assert.doesNotMatch(records,/Other chat|Legacy|Imported|Future|SECRET|files\/|data:image/)
  const empty=callPhoneRecords({contact:'Alice',player:'Player'})
  t.diagnostic('photo records UTF-8 bytes: '+Buffer.byteLength(records)+'; added bytes: '+(Buffer.byteLength(records)-Buffer.byteLength(empty)))
})
for (const roundCount of [0, 12]) test(`production dial context and call start accept a chat with ${roundCount} story rounds`, async () => {
  const {readFileSync} = await import('node:fs')
  const {default:vm} = await import('node:vm')
  const {createCardPreparation} = await import('../tavern-plugin/lib/domain/card-preparation.js')
  const source = readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/mods/phone/host.js', import.meta.url), 'utf8')
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
    callRecognitionContext:(await import('../tavern-plugin/mods/phone/call-context.js')).callRecognitionContext,
  }, {filename:'tavern-plugin/packages/dsh-tavern-stage/lib/mods/phone/host.js', lineOffset:source.slice(0,start).split('\n').length - 1})
  const sections = await context({sessionId:empty.sessionId, contact:callee, anchor:storyAnchor(empty), phase:'start', calls:[], playerName:'Player'})
  const story = sections.promptSections.find(row => row.name === 'recent-story').text
  if (roundCount) assert.match(story, /Story round 12/)
  else assert.equal(story, '')
  const calls = createPhoneCalls({store:{read:async () => null, update:async () => {}}, context})
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
// The phone's host side lives in the stage (lib/mods/phone/host.js): its requests answer from the stage-owned directory and
// call host, and a card with the phone off answers as off.
test('stage phone requests answer from the stage-owned phone host', async () => {
  const {createStagePhoneHost} = await import('../tavern-plugin/packages/dsh-tavern-stage/lib/mods/phone/host.js')
  const {createStageHandlers} = await import('../tavern-plugin/packages/dsh-tavern-stage/lib/rpc.js')
  const cleanups = [], sections = []
  const chat = {id:'chat-1', sessionId:'s', cardPath:'cards/a.json', messages:[]}, readStageChat = {view:async () => chat}
  const {stagePhoneDirectory, phoneCallHost} = createStagePhoneHost({ctx:{effect:install => cleanups.push(install()), get:() => undefined},
    managedModManagement:{enabled:async ({modId}) => { assert.equal(modId, 'dsh.phone'); return false }}, readStageChat, chatForSession:async () => chat,
    pluginApi:{builtinPromptSection:(entry, owner) => owner.effect(() => {
      sections.push(entry.target + ':' + entry.name)
      return () => sections.pop()
    })},
    speechRecognition:{readiness:async () => ({available:false})}})
  assert.deepEqual(sections, ['call:persona'])
  const handlers = createStageHandlers({ctx:{}, readStageChat, stagePhoneDirectory, phoneCallHost})
  assert.deepEqual(await handlers.getStagePhoneThreads({sessionId:'s'}), {enabled:false, contacts:[], threads:[]})
  await assert.rejects(handlers.phoneCallStart({sessionId:'s', contactId:'A'}), /手机模组没有为这张卡开启/)
  assert.equal(phoneCallHost.calls.activeCount(), 0)
  for (const cleanup of cleanups.reverse()) cleanup()
  assert.deepEqual(sections, [], 'the call persona section goes with the stage')
})
