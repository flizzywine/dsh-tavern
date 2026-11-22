import {withVoiceCues} from './helpers/voice-cues-source.mjs'
// tagged English defaults; retain protocol, payload, cache and budget assertions.
// historical vocabulary is fixture data, not a runtime default.
// include source literally, without String.replace replacement-token expansion.
// assert the extracted native service/retained stage owner contract.
// follow upstream module extraction without weakening behavior assertions.
import { inspectWorldBookDocument, updateWorldBookDocument, exportSillyTavernWorldBook, exportCharacterBook } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with { type: 'json' }
import { syncDialogueBubbleWorldbook, readDialogueBubblePlacement, bubbleInstructionPreview, bubbleInjection } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'

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
test('a figure without any face shows its name initial; unknown speakers and pending or failed leases stay empty', async () => {
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/bubbles.js', import.meta.url), 'utf8')
  const start = source.indexOf('function bubbleMediaDescriptor'), end = source.indexOf('// Transcript avatars are body text',start)
  const avatarStart = source.indexOf('function BubbleAvatar(props)')
  const rowEnd = source.indexOf('\nfunction ',source.indexOf('function BubbleRow(props)')+1)
  const context = {React:{createElement:(type,props,...children) => ({type,props,children}),useRef:value => ({current:value}),useState:value => [value,() => {}],useEffect() {},useSyncExternalStore:(subscribe,get) => get()},
    bubbleMoodBadge:() => null,PackImage:() => {},Spinner:() => {},bubbleMood:() => null,bubbleMoodList:() => [],bubbleColor:() => '#888',useFigureTextContrast() {},useBubbleMedia:() => null,
    bubbleViewport:{watch() {}},bubbleCharacter:(config,segment) => config.characters.find(row => row.alias === segment.alias),bubbleDisplayName:segment => segment.name}
  vm.runInNewContext(source.slice(start,end)+source.slice(avatarStart,rowEnd)+'\n;this.avatar = BubbleAvatar;this.row = BubbleRow',context)
  const avatarOf = (alias, name, characters) => context.row({sessionId:'s',segment:{alias,name,text:'…'},config:{characters}}).children[0].children[0].props
  const faceless = {alias:'figure-7c1',name:'新来客'}, faced = {alias:'figure-2b9',name:'白井',avatarMedia:{default:{identity:'face'}}}
  for (const name of ['新来客','𠮷野']) {
    const props = avatarOf('figure-7c1',name,[faceless]), result = context.avatar(props)
    assert.equal(result.children[0],Array.from(name)[0])
    assert.equal(result.props['aria-hidden'],true)
    assert.match(result.props.className,/avatar-ph/)
  }
  for (const props of [avatarOf('figure-2b9','白井',[faced]),avatarOf('stranger','路人甲',[faceless])]) {
    const result = context.avatar(props)
    assert.doesNotMatch(result.props.className,/avatar-ph/)
    assert.equal(result.children[0],null)
  }
  const loading = context.avatar({name:'白井',media:{loading:true}})
  assert.equal(loading.children[0].type,context.Spinner)
  const image = context.avatar({name:'白井',media:{src:'test.png'},zoomable:true})
  assert.equal(image.type,'button')
  assert.equal(image.children[0].type,context.PackImage)
})
