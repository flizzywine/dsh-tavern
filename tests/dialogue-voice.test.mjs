// Bilingual voice, 双语配音 (docs/design/cast-presentation.md, 33/N): a speaker's 配音语言 lives in their
// own voice setting; the story model then writes `…|[display text]|[voice text]`, and every reader voices that field.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sourceFunction } from './fixtures/source-function.mjs'
import { dialogueBubbleLines, dialogueBubblePlainText, bubbleSpeech, bubbleEmotion, bubbleSpeaker, CAST_EMOTIONS } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import { parseBubbles, effectiveVoiceLanguage, voiceTranslates } from '../tavern-plugin/src/client/bubble-line.cjs'
import { dialogueFormatText } from '../tavern-plugin/lib/domain/dialogue-format.js'
import { stagePages, stagePageText } from '../tavern-plugin/lib/domain/stage-performance.js'
import { buildCharx, cardImport } from '../tavern-plugin/lib/domain/card-assets.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { readZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

const reply = [
  '晨光照进教室。',
  '@bubble:hina|日向|开心|[早上好。]|[おはよう。]',
  '@bubble:hina|日向|紧张|[*终于赶上了。*]|[*やっとまにあった。*]',
  '@bubble:hina|日向|期待|[走吧。]|[いこう。]|',
  '@bubble:lin|林月|平静|[早。]'
].join('\n')

test('the fifth field is the voice text: shown nowhere, the display text reads as before', () => {
  const bubbles = parseBubbles(reply).filter(segment => segment.kind === 'bubble')
  assert.deepEqual(bubbles.map(segment => [bubbleSpeaker(segment), bubbleEmotion(segment.mood), segment.text, segment.thought === true, segment.voiced ? segment.speech : undefined]), [
    ['日向', 'joy', '早上好。', false, 'おはよう。'],
    ['日向', 'nervousness', '终于赶上了。', true, 'やっとまにあった。'],
    ['日向', 'optimism', '走吧。', false, 'いこう。'],
    ['林月', 'neutral', '早。', false, undefined]
  ], 'a thought keeps its asterisks out of both fields; a separator after the voice field is formatting; a four-field line has no voice')
  assert.deepEqual(dialogueBubbleLines(parseBubbles(reply)).map(line => line.quote), ['早上好。', '终于赶上了。', '走吧。', '早。'], 'plugins read the display text, in the same shape')
  assert.equal(dialogueBubblePlainText(parseBubbles(reply)).includes('おはよう'), false)
  const pages = stagePages(reply)
  assert.deepEqual(pages.map(page => page.voice), [undefined, 'おはよう。', 'やっとまにあった。', 'いこう。', undefined])
  assert.equal(pages.map(stagePageText).join('\n').includes('おはよう'), false, 'the director reads the display text only')
})

test('an unfinished voice field: the line shows, says nothing, and never falls back to the display text', () => {
  const live = text => parseBubbles(text, true).at(-1)
  for (const tail of ['@bubble:hina|日向|开心|[早上好。]|', '@bubble:hina|日向|开心|[早上好。]|[おは']) {
    const segment = live('晨光照进教室。\n' + tail)
    assert.deepEqual([segment.text, segment.streaming, segment.voiced], ['早上好。', true, true], tail)
    assert.equal(bubbleSpeech(segment, voiceTranslates('ja')), '')
  }
  const ended = parseBubbles('@bubble:hina|日向|开心|[早上好。]|[おは')[0]
  assert.deepEqual([ended.kind, ended.text, ended.streaming, ended.speech], ['bubble', '早上好。', false, ''], 'a reply that ended early keeps the line, without speech')
  assert.equal(bubbleSpeech(ended, voiceTranslates('ja')), '')
})

test('what a line says: its voice text; else its words, unless the speaker\'s 配音语言 is not 中文', () => {
  const [, spoken, thought, , plain] = parseBubbles(reply)
  assert.equal(bubbleSpeech(spoken, voiceTranslates('ja')), 'おはよう。')
  assert.equal(bubbleSpeech(thought, voiceTranslates('ja')), 'やっとまにあった。')
  assert.equal(bubbleSpeech(spoken, voiceTranslates('')), 'おはよう。', 'a written voice text is said even when the setting was cleared since')
  assert.equal(bubbleSpeech(plain, voiceTranslates('')), '早。', 'no 配音语言: the line is said as before')
  assert.equal(bubbleSpeech(plain, voiceTranslates('ja')), '', 'a Japanese voice does not read the Chinese line')
  assert.equal(bubbleSpeech({ ...plain, streaming: true }, voiceTranslates('')), '')
  assert.equal(bubbleSpeech(plain, voiceTranslates('zh')), '早。', 'a Chinese voice reads the line')
  assert.equal(bubbleSpeech(plain, voiceTranslates('zh-CN')), '早。', 'compared by primary subtag')
  assert.equal(bubbleSpeech(spoken, voiceTranslates('zh')), 'おはよう。', 'written voice text is still what the voice says')
  assert.deepEqual(['', 'zh', 'ZH-tw', 'ja', 'yue', 'EN-us', 'de-DE'].map(voiceTranslates), [false, false, false, true, true, true, true])
  // The control shows the same value the rule reads: unset is 中文.
  assert.deepEqual(['', undefined, 'ja', 'pt-BR'].map(value => effectiveVoiceLanguage(value)), ['zh', 'zh', 'ja', 'pt-BR'])
})

test('the roster tags a speaker with a 配音语言 and adds the voiced rules; without any the format is unchanged', () => {
  const cast = [{ name: '日向', aliases: ['Hina'] }, { name: '林月' }]
  const plain = dialogueFormatText(cast)
  assert.equal(dialogueFormatText(cast.map(row => ({ ...row, voiceLanguage: '' }))), plain, 'an empty 配音语言 changes no byte')
  assert.equal(plain.includes('voice'), true, 'the base format keeps its rule on each character’s voice')
  assert.equal(/voiced_bubbles|Voice language/.test(plain), false)
  const voiced = dialogueFormatText([{ ...cast[0], voiceLanguage: 'ja' }, cast[1]])
  assert.match(voiced, /\n- hina\|日向 \[Voice language: Japanese\]\n- 林月\|林月\n<\/speaker_roster>/)
  assert.match(voiced, /A `\[Voice language: \.\.\.\]` tag after the name gives the translation language\.\nVariants: /)
  const order = ['<examples>', '<voiced_bubbles>', '<speaker_roster>'].map(tag => voiced.indexOf(tag))
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'format, examples, voiced rules, then the roster')
  assert.match(voiced, /\|\[display text\]\|\[voice text\]`/)
  assert.equal(voiced.includes("- Keep each character's voice:"), false, 'the voiced rules say it for both fields instead')
  assert.equal(voiced.includes("- Keep the character's way of speaking in both fields:"), true)
  assert.match(dialogueFormatText([{ name: 'Nora', voiceLanguage: 'pt-BR' }]), /- nora\|Nora \[Voice language: Brazilian Portuguese\]/)
  const examples = voiced.match(/`@bubble:hinata[^`]+`/g).map(example => parseBubbles(example.slice(1, -1))[0])
  assert.deepEqual(examples.map(row => [bubbleEmotion(row.mood), row.thought === true, row.speech]), [['joy', false, 'おはよう。'], ['nervousness', true, 'やっとまにあった。']], 'the examples read back with their voice text and a known variant')
})

function store() {
  const files = new Map()
  return {
    async readJson(path) { return files.has(path) ? JSON.parse(files.get(path)) : undefined },
    async updateJson(path, change) { const next = change(files.has(path) ? JSON.parse(files.get(path)) : undefined); files.set(path, JSON.stringify(next)); return next },
    async writeBytes(path, data) { files.set(path, Buffer.from(data)) },
    async readBytes(path) { return files.get(path) }
  }
}

test('配音语言 is the character’s own voice setting: kept once, cleared with \'\', carried with the card', async () => {
  const cast = createCastAssets({ store: store() })
  assert.equal((await cast.setVoiceLanguage({ cardPath: 'cards/a.json', name: '日向', language: 'ja' })).characters[0].voiceLanguage, 'ja')
  await assert.rejects(cast.setVoiceLanguage({ cardPath: 'cards/a.json', name: '日向', language: 'Japanese' }), /配音语言无效/)
  const manifest = await cast.read('cards/a.json')
  const charx = buildCharx({ document: { data: { name: '日向' } }, cover: null, manifest, characterName: '日向', readFile: () => undefined })
  const exported = JSON.parse(readZipEntries(charx).get('card.json').toString('utf8')).data.extensions.dsh_tavern.cast.characters[0]
  assert.equal(exported.voiceLanguage, 'ja')
  const copy = createCastAssets({ store: store() })
  await copy.importCardAssets({ cardPath: 'cards/b.json', name: '日向', collected: cardImport({ kind: 'charx', name: '日向.charx', fileB64: charx.toString('base64') }).collected })
  assert.equal((await copy.read('cards/b.json')).characters.find(item => item.name === '日向').voiceLanguage, 'ja')
  const cleared = await cast.setVoiceLanguage({ cardPath: 'cards/a.json', name: '日向', language: '' })
  assert.equal(Object.hasOwn(cleared.characters[0], 'voiceLanguage'), false, "'': the story's own language, nothing stored")
})

// The chat row's 🔊, the stage and its backlog say what bubbleSpeech says, for the speaker's own setting.
const castSource = readFileSync(new URL('../tavern-plugin/src/client/features/cast-presentation.js', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../tavern-plugin/src/client/features/stage-runtime.js', import.meta.url), 'utf8')
const bubbleLineSource = readFileSync(new URL('../tavern-plugin/src/client/bubble-line.cjs', import.meta.url), 'utf8')
const domain = name => readFileSync(new URL('../tavern-plugin/lib/domain/' + name, import.meta.url), 'utf8').replace(/^export \{[^}]+\};?$/gm, '')
const client = new Function('React', 'TAVERN_CAST_EMOTIONS', 'TavernCastAvatar', 'TavernCastSpeak', 'tavernCastLineAvatar', 'tavernCastHue',
  bubbleLineSource + '\n' + domain('dialogue-bubbles.js') + '\n' + domain('cast-stage-state.js') + '\n'
  + [sourceFunction(castSource, 'TavernCastRow'), sourceFunction(castSource, 'renderTavernDialogueText'), sourceFunction(runtimeSource, 'tavernPageSpeech'), sourceFunction(runtimeSource, 'tavernBeatSpeech')].join('\n')
  + '\nreturn { renderTavernDialogueText, TavernCastRow, tavernPageSpeech, tavernBeatSpeech }')
const h = (type, props, ...children) => ({ type, props: props || {}, children })
const ui = client({ createElement: h, Fragment: 'fragment' }, CAST_EMOTIONS, 'avatar', 'speak', () => '', () => 0)

test('chat rows, stage pages and the backlog voice the same words', () => {
  const characters = [{ name: '日向', aliases: ['Hina'], voiceLanguage: 'ja' }, { name: '林月', aliases: [], voiceLanguage: '' }]
  const text = reply + '\n@bubble:hina|日向|难过|[对不起。]'
  const flat = node => !node || typeof node !== 'object' ? [] : node.type === ui.TavernCastRow ? [node] : node.children.flat(Infinity).flatMap(flat)
  const rows = flat(ui.renderTavernDialogueText(text, 0, (value, key) => h('md', { key }, value), { sessionId: 'game', lines: [], characters }, false))
  const said = ['おはよう。', 'やっとまにあった。', 'いこう。', '早。', '']
  assert.deepEqual(rows.map(row => [row.props.speaker, row.props.speech, row.children[0].children[0]]),
    [['日向', said[0], '早上好。'], ['日向', said[1], '（终于赶上了。）'], ['日向', said[2], '走吧。'], ['林月', said[3], '早。'], ['日向', '', '对不起。']],
    'shown in the display language; the last line has no voice text and no 🔊')
  const pages = stagePages(text).filter(page => page.kind === 'line')
  const data = { cast: characters }
  assert.deepEqual(pages.map(page => ui.tavernPageSpeech(page, data)), said)
  assert.deepEqual(ui.tavernBeatSpeech('game', pages[0], data), { sessionId: 'game', speaker: '日向', text: 'おはよう。', emotion: 'joy' })
  assert.equal(ui.tavernBeatSpeech('game', pages[4], data).text, '', 'the stage says nothing for her line without voice text')
  assert.equal(ui.tavernPageSpeech(pages[3], { cast: [] }), '早。', 'a speaker without material speaks the story language')
  // An earlier turn's annotated paragraph says its quotes, as before (no 配音语言, no voice text).
  assert.equal(ui.tavernPageSpeech({ kind: 'line', speaker: '林月', text: '她说：“早。”然后走了。', quotes: ['早。'] }, data), '早。')
  // A Chinese voice tagged zh-CN reads the display text, in the chat row too.
  const chinese = [{ ...characters[0], voiceLanguage: 'zh-CN' }, characters[1]]
  assert.equal(ui.tavernPageSpeech(pages[4], { cast: chinese }), '对不起。')
  const zhRows = flat(ui.renderTavernDialogueText(text, 0, (value, key) => h('md', { key }, value), { sessionId: 'game', lines: [], characters: chinese }, false))
  assert.equal(zhRows.at(-1).props.speech, '对不起。')
})
