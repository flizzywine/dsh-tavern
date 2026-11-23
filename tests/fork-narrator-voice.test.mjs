// 旁白配音: host display units decide; the stage voice handles speak them.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import bubbleLine from '../tavern-plugin/src/client/bubble-line.cjs'
import {createStageTextIndex, nativeNode, textHelpers} from './helpers/stage-session-harness.mjs'
import {voiceFixture, tick} from './fixtures/native-voice-player.mjs'

const {bubbleCharacter, characterVoiceLanguage, packSpeechInput} = bubbleLine
const stagePart = name => createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/' + name)
const chat = nodes => ({nodes:new Map(nodes.map(node => [node.id, node]))})
// The alias and the shown name differ from the figure's canonical name; moods are Chinese.
const TEXT = [
  '## 第一章',
  '雨下了一整夜。**街灯**亮着。',
  '@bubble:f_a1|小圆|开心|[早上好！]',
  '@bubble:f_b2|路人|平静|[让一让。]',
  '@bubble:f_a1|小圆|害怕|[*他在看我吗*]',
  '---'
].join('\n\n')
// The host projects an HTML block as its own part (reply-presentation.js); the stage never reads inside it.
const PARTS = [{kind:'markdown', text:TEXT}, {kind:'html', text:'<div class="status">\n\n状态栏\n\n</div>'}, {kind:'markdown', text:'广播里传来「列车即将进站」的声音。'}]
const config = (narrator, extra = {}) => ({voice:{enabled:true}, ...(narrator ? {narrator} : {}),
  characters:[{alias:'f_a1', name:'鹿目圆', aliases:['小圆'], voice:'voice/a', voiceKey:'key-a', voiceLanguage:'zh'},
    {alias:'f_b2', name:'路人甲', aliases:['路人'], voice:'', voiceKey:null}], ...extra})

function pages(parts = PARTS) {
  const index = createStageTextIndex(textHelpers())
  return index.reconcile({chat:chat([nativeNode(3, 'x')]), view:{mode:'story', replyProjections:[{version:2, turn:3, parts}]}, branchId:'b'}).get(3).text.pages
}
async function handles() {
  // The stage's speech module (speech.cjs), wired as gal-stage.js hands it the core's player, speech input and resolver.
  const f = voiceFixture()
  const speech = stagePart('speech.cjs').createStageSpeech({player:f.player, available:() => !!f.client.available(),
    speechInput:(segment, cfg) => packSpeechInput(segment, cfg, bubbleCharacter(cfg, segment), null), character:bubbleCharacter, language:characterVoiceLanguage,
    open:async (id, args) => { f.opened = [...(f.opened || []), args]; return f.descriptor }})
  return {f, handle:(page, cfg) => speech.handle('s', page.voice, cfg, page.anchor.paragraphId, true)}
}
test('旁白配音 off: nothing extra is synthesized', async t => {
  const {f, handle} = await handles(); t.after(() => f.player.dispose())
  const spoken = pages().map(page => handle(page, config(null))).filter(Boolean)
  for (const row of spoken) await row.prefetch()
  await tick()
  assert.deepEqual(f.synths.map(row => row.input.text), ['早上好！', '他在看我吗'])
})

// 旁白 speaks with the figure tts.reading().narrator.figure points at (any installed pack), in that figure's 配音语言.
const VOICES = '33333333-3333-4333-8333-333333333333'
const voicePack = {revision:'vp-1', manifest:{id:VOICES, voiceLibrary:{version:1, voices:{
  ja:{name:'旁白', language:'ja', defaultSource:'s', sources:{s:{kind:'preset', provider:'minimax', voiceName:'narrator-voice'}}},
  zh:{name:'旁白', language:'zh', defaultSource:'s', sources:{s:{kind:'preset', provider:'minimax', voiceName:'narrator-voice'}}}}}},
  figures:{ja:{id:'ja', name:'旁白', voice:{voice:'ja'}}, zh:{id:'zh', name:'旁白', voice:{voice:'zh'}}, mute:{id:'mute', name:'不配音', voice:{voice:'zh', source:null}}}}
// 履历 (gal-backlog.js): a narration row replays its narrator voice; an earlier round's row is its whole paragraph, its pages
// played one after another under the row's one id.
async function backlog({voicePlayer}) {
  // the 履历 rows are the stage's backlog-rows.cjs (stageHistoryEntries) and its replay backlog-voice.cjs (narration).
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/backlog-rows.cjs', import.meta.url), 'utf8')
  const scope = {stageVoiceDescriptor:() => null}
  vm.runInNewContext(source.slice(source.indexOf('function stageHistoryEntries'), source.indexOf('// ---------- Performance rows')), scope)
  scope.galBacklogNarration = stagePart('backlog-voice.cjs').createStageBacklogVoice({player:voicePlayer}).narration
  return scope
}test('履历: an earlier round\'s narration row carries its pages\' narrator voices and plays them in order under one id', async t => {
  const {f, handle} = await handles(); t.after(() => f.player.dispose())
  const scope = await backlog({voicePlayer:f.player})
  const text = Array.from({length:3}, (_, n) => `第${n + 1}页的旁白。`)
  const cards = text.map((page, n) => ({kind:'narration', text:page, voice:{narration:true, paragraphId:'p1', lineIdentity:[3, 0, n * 10], text:page}, anchor:{paragraphId:'p1', para:1, offset:n * 10}}))
  const index = new Map([[3, {units:[{kind:'narration', para:1, paragraphId:'p1', text:text.join(''), cards}, {kind:'line', para:2, paragraphId:'p2', text:'台词', segment:{alias:'f_a1'}}]}]])
  const rows = scope.stageHistoryEntries(index, 4, [], 0, {}).filter(row => row.type === 'page')
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row => row.descriptors?.map(descriptor => descriptor.text) ?? null))), [text, null], 'only a narration unit lists its page voices')
  const cfg = config({voiceKey:'narrator-key'})
  assert.equal(scope.galBacklogNarration(rows[0].descriptors.map(descriptor => handle({voice:descriptor, anchor:{paragraphId:'p1'}}, config(null))).filter(Boolean)), null, 'silent while the narrator is off')
  const row = scope.galBacklogNarration(rows[0].descriptors.map(descriptor => handle({voice:descriptor, anchor:{paragraphId:'p1'}}, cfg)))
  row.click()
  const played = []
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < 5; i++) await tick()
    const current = f.player.get()
    assert.equal(current?.id, row.id, 'every page plays under the row\'s id (one button state)')
    played.push(f.synths.at(-1).input.text)
    current.audio.ended = true; current.audio.onended()
  }
  assert.deepEqual(played, text)
  for (let i = 0; i < 5; i++) await tick()
  assert.equal(f.player.get(), null, 'the last page ends the row')
})

// 旁白 in another language (owner 11-11, r2 A): each narration paragraph is translated whole by 配音补译 and read from its
// first page; page turns inside the paragraph do not cut it.
const JA = {voiceKey:'narrator-ja', language:'ja', wholeParagraph:true}
