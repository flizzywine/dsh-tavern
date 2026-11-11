import {withVoiceCues} from './helpers/voice-cues-source.mjs'
import { createStageHandlers } from '../tavern-plugin/packages/dsh-tavern-stage/lib/rpc.js'
// tagged English defaults; retain protocol, payload, cache and budget assertions.
// historical vocabulary is fixture data, not a runtime default.
// include source literally, without String.replace replacement-token expansion.
// assert the extracted native service/retained stage owner contract.
// follow upstream module extraction without weakening behavior assertions.
import { inspectWorldBookDocument, updateWorldBookDocument, exportSillyTavernWorldBook, exportCharacterBook } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { DEFAULT_BUBBLE_TEMPLATE } from '../tavern-plugin/lib/domain/dialogue-bubble-presets.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with { type: 'json' }
import { normalizeBubbleConfig, syncDialogueBubbleWorldbook, readDialogueBubblePlacement, bubbleInstructionPreview, bubbleInjection, BUBBLE_WORLDBOOK_COMMENT } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {createForegroundCapabilities,foregroundCapabilityEntries} from '../tavern-plugin/lib/domain/foreground-capabilities.js'
import figureResolution from '../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs'
import bubbleLine from '../tavern-plugin/src/client/bubble-line.cjs'
import {projectWorldBookTemplates} from '../tavern-plugin/lib/domain/worldbook-recall.js'

test('speaker handles are card-unique, order/recall stable, and resolve Chinese moods through the existing path', () => {
  const config = normalizeBubbleConfig({enabled:true,characters:[
    {alias:'f_efed52c1c67556e0',name:'大肥鱼',aliases:['dafeiyu'],ref:{packId:'pack',figureId:'figure-a'},recall:{mode:'constant'},emotions:[{id:'calm',label:'平和'}]},
    {alias:'f_abcdef0123456789',name:'大肥鱼',aliases:['dafeiyu'],ref:{packId:'pack',figureId:'figure-b'},recall:{mode:'keyword',keywords:['guest']},emotions:[{id:'joy',label:'喜悦'}]},
    {alias:'f_0123456789abcdef',name:'高坂月',aliases:['Kosaka Tsuki'],ref:{packId:'pack',figureId:'figure-c'},recall:{mode:'constant'},emotions:[{id:'shy',label:'害羞'}]},
    {alias:'guest',name:'来客',emotions:[{id:'surprise',label:'惊讶'}]}
  ]})
  const {figureSpeakerHandle,resolveFigureName}=figureResolution
  const handles=config.characters.map(row=>figureSpeakerHandle(config.characters,row))
  assert.deepEqual(handles,['dafeiyu_1','dafeiyu_2','kosaka_tsuki','guest'])
  assert.equal(new Set(handles).size,config.characters.length)
  const reversed={...config,characters:[...config.characters].reverse()}
  for(const [index,row] of config.characters.entries()) {
    const handle=handles[index]
    assert.equal(figureSpeakerHandle(reversed.characters,row),handle)
    for(const alias of [handle,row.alias]) {
      const [segment]=bubbleLine.parseBubbles(`@bubble:${alias}|${row.name}|${row.emotions[0].label}|[你好。]|[こんにちは。]`)
      assert.equal(bubbleLine.bubbleCharacter(config,segment)?.alias,row.alias)
      assert.equal(bubbleLine.matchBubbleMood(segment.mood,bubbleLine.bubbleCharacter(config,segment).emotions)?.id,row.emotions[0].id)
      assert.equal(segment.speech,'こんにちは。')
      assert.equal(resolveFigureName(config.characters.map(row=>({...row,actorKey:row.alias})),alias).actorKey,row.alias)
    }
  }
  const figureConfig={...config,characters:config.characters.filter(row=>row.ref)}
  const entries=foregroundCapabilityEntries(figureConfig,{messages:[]})
  const text=entries.map(entry=>entry.content).join('\n')
  assert.match(text,/dafeiyu_1\|大肥鱼/)
  // Copy values from the rendered roster, not from internal IDs or a golden prompt.
  // A speaker line copies its group's first option from the `Variants:` line above it.
  let options = ''
  for (const line of entries[0].content.match(/<speaker_roster>\n([\s\S]*?)\n<\/speaker_roster>/)[1].split('\n')) {
    if (line.startsWith('Variants: ')) options = line.slice('Variants: '.length)
    if (!line.startsWith('- ')) continue
    const [,identity,name] = line.match(/^- ([^|]+\|([^\s[]+))/)
    const variant = options.match(/^[^、（]+/)[0]
    const [segment] = bubbleLine.parseBubbles(`@bubble:${identity}|${variant}|[你好。]`)
    const resolved = bubbleLine.bubbleCharacter(config,segment)
    assert.equal(resolved.name,name)
    assert.ok(resolved.emotions.some(row=>row.label===variant))
  }
  const empty = bubbleInjection({enabled:true,characters:[{alias:'f_empty',name:'访客',aliases:['visitor'],ref:{packId:'pack',figureId:'empty'},emotions:[]}]})
  assert.match(empty[0].text,/^Variants: none\n- visitor\|访客$/m)
  assert.deepEqual(bubbleLine.parseBubbles('@bubble:visitor|访客||[你好。]')[0].mood,'')
  assert.doesNotMatch(text,/dafeiyu_2|f_efed52c1c67556e0/)
  assert.deepEqual(foregroundCapabilityEntries(figureConfig,{messages:[{role:'user',text:'next turn'}]}),entries)
  const carriedRows=figureConfig.characters.map((row,index)=>({...row,actorKey:'old_'+(9-index)}))
  assert.equal(resolveFigureName(carriedRows,{alias:handles[0],name:'大肥鱼'}).ref.figureId,'figure-a')
  const reserved={alias:'f_9999999999999999',name:'占位',aliases:['dafeiyu_1'],ref:{packId:'pack',figureId:'figure-d'}}
  const full=[...config.characters,reserved]
  assert.equal(new Set(full.map(row=>figureSpeakerHandle(full,row))).size,full.length)
})

// inline previews and separate live entries share one roster, including voice languages.
test('inline and live rosters share names, variants and a single voice-language annotation', () => {
  const config = {enabled:true,voice:{enabled:true},characters:[
    {alias:'figure_mira',aliases:['traveler'],name:'Mira',ref:{packId:'pack',figureId:'mira'},voice:'sample',voiceLang:'ja',emotions:[{id:'joy',label:'喜悦'}]},
    {alias:'figure_ren',aliases:['guide'],name:'Ren',ref:{packId:'pack',figureId:'ren'},voice:'same',voiceLang:'zh',emotions:[{id:'joy',label:'喜悦'}]}
  ]}
  const preview = bubbleInstructionPreview(config)
  const entries = bubbleInjection(config)
  assert.equal(preview.sections.find(section=>section.key==='characters').text,entries[0].text.match(/<speaker_roster>[\s\S]*<\/speaker_roster>/)[0])
  assert.match(entries[0].text,/traveler\|Mira \[Voice language: Japanese\]/)
  assert.match(entries[0].text,/^Variants: 喜悦\n- traveler\|Mira \[Voice language: Japanese\]\n- guide\|Ren$/m)
  assert.equal(preview.instruction.match(/^- .*\[Voice language:/gm).length,1)
  assert.equal(entries.map(entry=>entry.text).join('\n').match(/^- .*\[Voice language:/gm).length,1)
  assert.doesNotMatch(entries[0].text,/Characters with|［/)
  const resolved = bubbleInstructionPreview(config,{voices:[{id:'sample',languages:['zh']},{id:'same',languages:['zh']}]})
  assert.equal(resolved.sections.find(section=>section.key==='voice').text,'')
  assert.doesNotMatch(resolved.instruction,/\[Voice language:/)
  assert.match(entries[0].text,/A `\[Voice language: \.\.\.\]` tag after the name gives the translation language/)
  const plain = bubbleInstructionPreview({...config,voice:{enabled:false}}).sections.find(section=>section.key==='characters').text
  assert.equal(plain,resolved.sections.find(section=>section.key==='characters').text)
  assert.ok(plain.startsWith('<speaker_roster>\nEach `Variants:` line gives the options for the speakers listed under it. Parentheses after a variant give guidance, not part of its value.\nThe player is 你; the player\'s own lines use the name 你, never another roster entry.\nVariants: '))
})

// this isolated server-case closure must receive every host dependency, including the foreground owner.
async function bubbleRpcFixture({chat,config,placement,foregroundCapabilities}) {
  const dependencies={readStageChat:{view:async()=>chat},chatForSession:async()=>chat,requestPerformance:{stage:(_name,read)=>read()},
    cardStage:{forSession:async()=>({voices:{list:async()=>({voices:[]})}})},dialogueVoice:{status:async()=>({})},
    dialogueBubbles:{snapshot:async()=>({config:normalizeBubbleConfig(config),requireAvailable:()=>normalizeBubbleConfig(config)})},dialogueBubblePresets:{list:async()=>[]},
    DEFAULT_BUBBLE_TEMPLATE,bubbleInstructionPreview,bubbleInjection,readDialogueBubblePlacement:async()=>placement,
    worldBooks:{},normalizeBubbleConfig,str:value=>String(value || ''),assetEngineSettings:{read:()=>({values:{dialogue:config}})},foregroundCapabilities}
  const handlers = createStageHandlers(dependencies)
  return (method, args) => handlers[method](args, method)
}

// execute the actual native RPC branch with the real foreground owner, recall, macro projection and prefix order.
test('native get RPC exposes actual recalled/rendered foreground bytes, not all figures or legacy entries, without freezing preview',async()=>{
  const chat={id:'native',sessionId:'s',mode:'story',cardPath:'cards/a.json',cardName:'卡',macroState:{userName:'本局玩家'},messages:[]}
  const original=structuredClone(chat),config=normalizeBubbleConfig({enabled:true,
    injection:{template:'{{user}}\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}'},characters:[
      {alias:'blue',name:'Blue',ref:{packId:'pack',figureId:'blue'},recall:{mode:'constant'}},
      {alias:'green',name:'UnrecalledGreen',ref:{packId:'pack',figureId:'green'},recall:{mode:'keyword',keywords:['activate-green']}}]})
  const render=(current,worldBook)=>projectWorldBookTemplates({worldBook,chat:current,card:{name:current.cardName},includeConstants:true,
    runtime:{render:()=>assert.fail('This plain-macro fixture must not call a model or author EJS runtime')}})
  const owner=createForegroundCapabilities({session:()=>null,readConfig:async()=>config,render,
    save:async()=>assert.fail('RPC preview must not persist an epoch')})
  const placement={books:['legacy'],current:{book:'card',order:555},entries:[{ref:'legacy',content:'retired placement entry'}]}
  const rpc=await bubbleRpcFixture({chat,config,placement,foregroundCapabilities:owner})
  const result=await rpc('getDialogueBubbles',{sessionId:'s'})
  assert.deepEqual(chat,original)
  assert.deepEqual(result.placement,{...placement,entries:[]})
  const prefix=result.injection.map(row=>row.text).join('\n\n')
  assert.match(prefix,/Blue/);assert.doesNotMatch(prefix,/UnrecalledGreen|\{\{user\}\}|retired placement/)
  assert.deepEqual(result.injection.map(row=>row.key),['format']);assert.ok(result.injection.every(row=>row.tokens>0))
  assert.ok(prefix.indexOf('<dialogue_format>') < prefix.indexOf('<speaker_roster>'))
  assert.match(prefix,/Each `Variants:` line/)
  const expected=createForegroundCapabilities({session:()=>null,readConfig:async()=>config,render,save:async()=>assert.fail('persist:false')})
  assert.equal(prefix,(await render(chat,await expected.project(structuredClone(chat),null,{persist:false}))).prefixContext)
  config.enabled=false
  assert.deepEqual((await rpc('getDialogueBubbles',{sessionId:'s'})).injection,[],'Unsent preview cannot freeze the enabled epoch')
  assert.deepEqual(chat,original)
})

test('设置归一化：别名去重、非法别名与图片丢弃、差分只收声明项', () => {
  const png = 'data:image/webp;base64,AAAA'
  const config = normalizeBubbleConfig({ enabled: true, emotions:[{id:'shy',label:'害羞'}], characters: [
    { alias: 'Madoka', name: '鹿目圆', avatar: png, emotions:[{id:'shy',label:'害羞'}], moods: { shy: png, weird: png }, color: '#E0689F' },
    { alias: 'madoka', name: '重复' },
    { alias: 'bad alias!', name: 'x' },
    { alias: 'player', name: '高坂月', avatar: 'javascript:alert(1)' }
  ] })
  assert.equal(config.enabled, true)
  assert.deepEqual(config.characters.map(c => c.alias), ['madoka', 'player'])
  assert.deepEqual(Object.keys(config.characters[0].moods), ['shy'])
  assert.equal(config.characters[0].color, '#e0689f')
  assert.equal(config.characters[1].avatar, '')
})

// independent figure entries own IDs once, including figures without custom guidance.
test('writer figure entries use display labels and preserve ID-only figures without empty roster text', async () => {
  const config = {enabled:true, characters:[
    {alias:'fish',name:'大肥鱼',ref:{packId:'pack',figureId:'fish'},aliases:['鱼鱼'],recall:{mode:'constant'},emotions:[{id:'smug',label:'得意',guidance:'得意时使用。'},{id:'eating',label:'吃东西'},{id:'joy',label:'喜悦',guidance:'开心时使用。'}]},
    {alias:'guest',name:'来客',ref:{packId:'pack',figureId:'guest'},aliases:[],recall:{mode:'keyword'},emotions:moods.map(({note,...row})=>row)},
    {alias:'other',name:'另一位',ref:{packId:'pack',figureId:'other'},aliases:[],recall:{mode:'constant'},emotions:moods.map(({note,...row})=>row)}
  ]}
  const injected = bubbleInjection(config, { userName: '{{user}}' }), text = injected.map(row => row.text).join('\n\n')
  // one stable roster, grouped by available labels, with compact authored guidance.
  assert.equal(injected.length, 1)
  assert.doesNotMatch(text, /未配置角色表|人物情绪|smug:|eating:|通用差分/)
  for (const handle of ['鱼鱼','来客','另一位']) assert.equal(text.split('- ' + handle + '|').length + text.split('、' + handle + '|').length - 2, 1)
  assert.match(injected[0].text, /得意（得意时使用。）/)
  assert.match(injected[0].text, /吃东西/)
  assert.match(injected[0].text, /喜悦（开心时使用。）/)
  assert.equal(injected[0].constant, true)
  assert.match(injected[0].text, /Variants: 喜悦、愤怒、悲伤、紧张、平和、害羞、嫌弃、爱恋、哭泣\n- 来客\|来客\n- 另一位\|另一位\n<\/speaker_roster>$/)
  const guided = structuredClone(config)
  guided.characters[1].emotions = guided.characters[1].emotions.map(row=>row.id==='joy'?{...row,guidance:'来客高兴时。'}:row)
  assert.match(bubbleInjection(guided)[0].text, /喜悦（来客\|来客：来客高兴时。）/)
  const custom = bubbleInjection({...config,injection:{template:DEFAULT_BUBBLE_TEMPLATE + '\n'}})
  assert.doesNotMatch(custom[0].text, /\n[\t ]*$/)
  assert.doesNotMatch(custom[0].text, /未配置角色表|ID fish|ID guest/)
  const books = fakeWorldBooks()
  await syncDialogueBubbleWorldbook(books, 'cards/a.json', config)
  const entries = books.calls[0].request.operations.map(op => op.entry)
  assert.deepEqual(entries.map(row => row.content), injected.map(row => row.text))
  assert.equal(entries[0].comment, BUBBLE_WORLDBOOK_COMMENT)
  const projected = await projectWorldBookTemplates({worldBook:{view:{entries}},includeConstants:true,chat:{},card:{},runtime:{render:async text=>({ok:true,text})}})
  assert.ok(projected.prefixContext.indexOf('<dialogue_format>') < projected.prefixContext.indexOf('<speaker_roster>'))
  const existing = fakeWorldBooks(entries.map((row,index) => ({...row,ref:'entry:'+index,
    comment:'旧标题',
    rawEntry:{extensions:{dsh_tavern_helper_extra:row.helperExtra}}})))
  await syncDialogueBubbleWorldbook(existing, 'cards/a.json', config)
  assert.equal(existing.calls[0].request.operations.find(row => row.ref === 'entry:0').patch.comment, BUBBLE_WORLDBOOK_COMMENT)
})

test('one managed entry replaces both legacy entries without treating a figure description as variants', async () => {
  const description = '月见八千代身边会说话的白色毛绒海兔，嘴毒爱吐槽。'
  const config = {enabled:true, characters:[{
    alias:'f_1234567890abcdef', name:'不死', aliases:['FUSHI'],
    ref:{packId:'pack-42',figureId:'figure-73'}, description,
    emotions:[{id:'calm',label:'平和'}, {id:'grin',label:'坏笑'}]
  }]}
  const parts = bubbleInjection(config)
  assert.equal(parts.length, 1)
  assert.equal(parts[0].name, '格式要求（由「对话气泡」设置维护）')
  assert.match(parts[0].text, /<\/dialogue_format>\n<speaker_roster>/)
  assert.match(parts[0].text, /Variants: 平和、坏笑\n- fushi\|不死 — /)
  assert.equal(parts[0].text.split('fushi|不死').length, 2)
  assert.equal(parts[0].text.split(description).length, 2)
  assert.match(foregroundCapabilityEntries(config,{messages:[]})[0].ref, /^foreground-capabilities:/)
  const legacy = ['对白格式（由「对话气泡」设置维护）', '对话气泡格式（由「对话气泡」设置维护）', '说话人名单'].map(rawEntry)
  const user = rawEntry('用户规则')
  const docs = new Map([[JSON.stringify(cardSource),documentFor([...legacy,user])]])
  const books = mutableBooks([cardSource],docs)
  const result = await syncDialogueBubbleWorldbook(books,cardSource.cardPath,config)
  assert.equal(result.removed,2)
  const entries = docs.get(JSON.stringify(cardSource)).entries
  assert.equal(entries.length,2)
  assert.equal(entries[0].comment,BUBBLE_WORLDBOOK_COMMENT)
  assert.equal(entries[0].content,bubbleInjection(config, { userName: '{{user}}' })[0].text)
  assert.deepEqual(entries[1],user)
  assert.equal((await syncDialogueBubbleWorldbook(books,cardSource.cardPath,config)).changed,false)
})

function fakeWorldBooks(entries = [], binding = { kind: 'embedded', source: { kind: 'card', cardPath: 'cards/a.json' }, available: true }) {
  const calls = []
  return {
    calls,
    async binding() { return binding },
    async get(source) { return { source, view: { displayName: '見滝原', entries } } },
    async update(source, request) { calls.push({ source, request }) }
  }
}

test('客户端解析：旁白保留为 Markdown，气泡行与心里话、流式半行', async () => {
  const source = (await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/bubbles.js', import.meta.url), 'utf8')).split('// @include bubble-line.cjs').join(withVoiceCues(await readFile(new URL('../tavern-plugin/src/client/bubble-line.cjs', import.meta.url), 'utf8'))).replace('__TAVERN_BUBBLE_MOODS__', JSON.stringify(moods))
  const context = {}
  vm.runInNewContext(source.slice(0, source.indexOf('// Per-session bubble settings')) + ';this.parse = parseBubbles; this.mood = bubbleMood;', context)
  const segments = context.parse('她抬起头。\n@bubble:madoka|鹿目圆|害羞|[你好]\n@bubble:kyubey|丘比|平静|[*签订契约吧*]\n旁白', false)
  assert.deepEqual(JSON.parse(JSON.stringify(segments.map(s => [s.kind, s.alias || s.text, s.thought || false]))), [['markdown', '她抬起头。', false], ['bubble', 'madoka', false], ['bubble', 'kyubey', true], ['markdown', '旁白', false]])
  const streaming = context.parse('旁白\n@bubble:madoka|鹿目圆|紧张|[正在说', true)
  assert.equal(streaming[1].text, '正在说')
  assert.equal(context.parse('旁白\n@bubble:mad', true).length, 1)
  assert.equal(context.mood('害羞').id, 'shy')
})

// The full-screen stage hides its own session's transcript; a text with no session (the opening
// preview) must still render while no stage is active, the store's idle value being "" too.
test('气泡正文只在本局全屏舞台打开时隐藏，没有会话的开场预览照常显示', async () => {
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/bubbles.js', import.meta.url), 'utf8')
  const start = source.indexOf('function BubblePublication(props)'), end = source.indexOf('// thoughts are set', start)
  const context = { stage: '', BubbleContent() {}, galActive: { subscribe: () => () => {}, get: () => context.stage },
    React: { useSyncExternalStore: (_subscribe, get) => get(), useRef: value => ({ current: value }), createElement: (type, props) => ({ type, props }) } }
  vm.runInNewContext(source.slice(start, end) + ';this.BubblePublication = BubblePublication', context)
  assert.ok(context.BubblePublication({ sessionId: '', text: '开场白' }), 'no stage active: the opening preview renders')
  context.stage = 'session-a'
  assert.equal(context.BubblePublication({ sessionId: 'session-a', text: '正文' }), null, 'its own stage covers it')
  assert.ok(context.BubblePublication({ sessionId: 'session-b', text: '正文' }), 'another session still renders')
  assert.ok(context.BubblePublication({ sessionId: '', text: '开场白' }), 'no session is never covered')
})

// The test double uses the actual resource patcher, including embedded ref ordering.
function mutableBooks(sources, documents) {
  const calls = []
  return {
    calls, sources, documents, fail: false,
    async binding() { return { kind: 'multiple', books: this.sources.map(source => ({ source, available: true })) } },
    async get(source) { const document = documents.get(JSON.stringify(source)); return { source, view: inspectWorldBookDocument(document) } },
    async export(source) { return { document: exportSillyTavernWorldBook(documents.get(JSON.stringify(source))) } },
    async replaceNative(source, document) { documents.set(JSON.stringify(source), source.kind === 'card' ? exportCharacterBook(document, { replace: true }) : structuredClone(document)) },
    async update(source, request) {
      if (this.fail) throw new Error('simulated update failure')
      calls.push({ source, request })
      const key = JSON.stringify(source)
      documents.set(key, updateWorldBookDocument(documents.get(key), request).document)
    }
  }
}
const cardSource = { kind: 'card', cardPath: 'cards/a.json' }
const standaloneSource = { kind: 'standalone', path: 'worldbooks/b.json' }
const documentFor = entries => ({ name: 'isolated fixture', entries, extensions: { untouched: true } })
const rawEntry = (comment, extra = {}) => ({ id: 7, comment, content: 'original', keys: [], enabled: true, insertion_order: 37, position: 'before_char', extensions: { custom: 'keep', dsh_tavern_helper_extra: { another: 'keep', ...extra } } })

test('placement reports live fields, preserves untouched fields, moves across bound books and rolls back failures', async () => {
  const docs = new Map([[JSON.stringify(cardSource), documentFor([])], [JSON.stringify(standaloneSource), { name: 'target', entries: {} }]])
  const books = mutableBooks([cardSource, standaloneSource], docs)
  const config = { enabled: true, injection: { placement: { position: 1, order: 240 } } }
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, config)
  let live = await readDialogueBubblePlacement(books, cardSource.cardPath, config.injection.placement)
  assert.equal(live.current.book, 'card'); assert.equal(live.current.order, 240); assert.equal(live.manual, false)
  // the placement read lists the bubble entries the books hold, with their owner.
  const synced = (await books.get(cardSource)).view.entries[0].content
  assert.deepEqual(live.entries.map(entry => [entry.book, entry.own, entry.constant, entry.text === synced]), [['card', true, true, true]])
  const entry = (await books.get(cardSource)).view.entries[0]
  await books.update(cardSource, { operations: [{ op: 'update', ref: entry.ref, patch: { position: 4, depth: 7, role: 2, order: 19 } }] })
  docs.get(JSON.stringify(cardSource)).entries[0].extensions.unrelated = { preserve: true }
  docs.get(JSON.stringify(cardSource)).entries[0].id = 27 // Embedded ref index and native UID deliberately differ.
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: true, injection: { template: '{{user}}\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}' } })
  live = await readDialogueBubblePlacement(books, cardSource.cardPath, config.injection.placement)
  assert.equal(live.manual, true)
  assert.deepEqual([live.current.position, live.current.depth, live.current.role, live.current.order], [4, 7, 2, 19])
  assert.match((await books.get(cardSource)).view.entries[0].content, /\{\{user\}\}/, 'shared worldbook preserves runtime macro')
  const moving = { enabled: true, injection: { placement: { book: 'standalone:worldbooks/b.json', order: 99 } } }
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, moving)
  assert.equal((await books.get(cardSource)).view.entries.length, 0)
  const moved = (await books.get(standaloneSource)).view.entries[0]
  assert.equal(moved.order, 99); assert.equal(moved.depth, 7); assert.equal(moved.role, 2)
  assert.deepEqual(moved.rawEntry.extensions.unrelated, { preserve: true })
  assert.equal((await readDialogueBubblePlacement(books, cardSource.cardPath, moving.injection.placement)).manual, false)
  const before = await Promise.all([cardSource, standaloneSource].map(source => books.export(source)))
  const replace = books.replaceNative.bind(books)
  let attempts = 0
  books.replaceNative = async (source, document) => { await replace(source, document); if (++attempts === 2) throw new Error('second write failed after writing') }
  await assert.rejects(syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: true, injection: { placement: { book: 'card' } } }), /已回滚/)
  assert.deepEqual(await Promise.all([cardSource, standaloneSource].map(source => books.export(source))), before)
  await assert.rejects(syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: true, injection: { placement: { book: 'standalone:unbound' } } }), /不在本卡绑定列表/)
  assert.deepEqual(await Promise.all([cardSource, standaloneSource].map(source => books.export(source))), before)
})
