// 双语配音 (cast-presentation.md 33/N), over the real host and a stand-in Fish-compatible service. A
// character's 配音语言 is chosen beside their 配音来源 in 舞台素材; with 配音 on the story model's format then tags them in the
// roster and adds the voiced rules. A line's fifth field is said in the chat, on the stage and in its backlog, and never shown;
// a line of theirs without it shows and is not said; a speaker without a 配音语言 is said as before. A reply still streaming
// never shows its voice field. An unset 配音语言 shows and counts as 中文 (choosing 中文 stores it unset); only a 配音语言 other than 中文 needs voice text. Fresh disposable profile only; the reply comes from an uploaded fixture model, no paid calls.
// Nothing reaches a speaker: every played <audio> runs into a zero gain.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { openStagePanel } from './cast-stage.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP, modulePath = process.env.TAVERN_E2E_LLM_MODULE
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || !modulePath || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, the runtime LLM module, --isolated and --artifacts DIR; never use a live browser')

// An original sine tone as 16-bit mono WAV (8 kHz).
function tone(seconds) {
  const samples = Math.round(8000 * seconds), bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / 8000) * 9000), 44 + i * 2)
  return bytes
}
const requests = []
const fish = createServer((req, res) => {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    if (req.url === '/v1/tts' && req.method === 'POST') { requests.push(JSON.parse(body)); res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(tone(1)); return }
    res.writeHead(404); res.end('not found')
  })
})
await new Promise(resolve => fish.listen(0, '127.0.0.1', resolve))
const fishUrl = 'http://127.0.0.1:' + fish.address().port
const said = () => requests.map(item => [item.reference_id, item.text])

const reply = ['晨光照进教室。', '@bubble:hina|日向|开心|[早上好。]|[おはよう。]', '@bubble:hina|日向|难过|[对不起，昨天没来。]', '@bubble:lin|林月|平静|[早。]', '铃声响了。'].join('\n')

await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
const result = {}
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.addInitScript(() => {
    const Native = window.Audio
    window.voiceTap = { played: 0, lines: [] }
    // What the page asks the host to say (speechForLine), for the evidence.
    const fetch = window.fetch.bind(window)
    window.fetch = (url, init) => { if (String(url).includes('speechForLine')) window.voiceTap.lines.push(JSON.parse(init.body).text); return fetch(url, init) }
    window.Audio = function (src) {
      const element = new Native(src), play = element.play.bind(element)
      element.play = () => {
        const tap = window.voiceTap
        if (!tap.context) { tap.context = new AudioContext(); tap.silence = tap.context.createGain(); tap.silence.gain.value = 0; tap.silence.connect(tap.context.destination) }
        tap.context.createMediaElementSource(element).connect(tap.silence)
        tap.played++
        return play()
      }
      return element
    }
  })
  const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
    const result = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
    if (result.ok === false) throw Error(method + ': ' + JSON.stringify(result))
    return result
  }, [method, args])
  const played = () => page.evaluate(() => window.voiceTap.played)

  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const run = Date.now(), name = 'Voice text ' + run % 100000
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The bell rings.', extensions: {} } }
  const imported = (await call('importCard', { payload: { kind: 'charx', name: 'voice-text-' + run + '.charx', fileB64: writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }]).toString('base64') } })).card
  await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true } } })
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The bell rings.' },
    { name: 'Reader', is_user: true, mes: 'Morning.' }, { name, is_user: false, mes: reply }].map(JSON.stringify).join('\n')
  const game = await call('importChatHistoryText', { cardPath: imported.path, text: history, fileName: 'voice-text.jsonl' })
  const sessionId = game.sessionId, title = 'Voice text verification ' + run
  await call('renameConversation', { sessionId, title })
  await call('castSetCharacter', { sessionId, name: '日向', aliases: ['Hina'] })
  await call('castSetVoice', { sessionId, name: '日向', provider: 'fish', voice: 'ref-hina' })
  await call('castSetCharacter', { sessionId, name: '林月' })
  await call('castSetVoice', { sessionId, name: '林月', provider: 'fish', voice: 'ref-lin' })
  await call('updateSpeechSettings', { enabled: true, provider: 'fish', config: { baseUrl: fishUrl, voice: 'ref-default' } })

  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  const chatUrl = page.url()

  // 1. 舞台素材: 配音语言 sits beside the 配音来源; unset it shows 中文, 「其他语言…」 takes a code, choosing 中文 stores it unset,
  // and choosing 日语 is saved on the character.
  await openStagePanel(page, '舞台素材')
  const material = page.locator('.dsh-tavern-cast-manager-row').filter({ visible: true }).filter({ hasText: '日向' }).first()
  const language = material.getByLabel('日向 的配音语言', { exact: true })
  await language.waitFor()
  result.options = await language.locator('option').allTextContents()
  assert.deepEqual(result.options, ['配音语言：日语', '配音语言：中文', '配音语言：英语', '配音语言：韩语', '配音语言：粤语', '配音语言：其他语言…'])
  assert.equal(await language.inputValue(), 'zh')
  const stored = async () => (await call('castForTurns', { sessionId, turns: [] })).characters.find(item => item.name === '日向').voiceLanguage
  await language.selectOption('*other')
  await material.getByLabel('日向 的其他配音语言代码', { exact: true }).fill('de-DE')
  await material.getByLabel('日向 的其他配音语言代码', { exact: true }).press('Enter')
  await until(async () => await stored() === 'de-DE', 'the other code is saved')
  await page.waitForFunction(() => [...document.querySelectorAll('select[aria-label="日向 的配音语言"] option')].some(item => item.value === 'de-DE'))
  await language.selectOption('zh')
  await until(async () => await stored() === '', '中文 stores unset')
  await page.waitForFunction(() => [...document.querySelectorAll('select[aria-label="日向 的配音语言"]')].some(item => item.value === 'zh'))
  await language.selectOption('ja')
  await page.getByText('已保存 日向 的配音语言', { exact: true }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('select[aria-label="日向 的配音语言"]')].some(item => item.value === 'ja'))
  const cast = (await call('castForTurns', { sessionId, turns: [] })).characters
  result.stored = cast.map(item => [item.name, item.voiceLanguage])
  assert.deepEqual(result.stored.filter(([who]) => ['日向', '林月'].includes(who)), [['日向', 'ja'], ['林月', '']])
  assert.equal(await page.locator('.dsh-tavern-cast-manager-row').filter({ visible: true }).filter({ hasText: '林月' }).first().getByLabel('林月 的配音语言', { exact: true }).inputValue(), 'zh')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(output, 'materials-1920.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  await material.scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow at 375')
  await page.screenshot({ path: join(output, 'materials-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })

  // 2. The chat: lines show in the story's language, the voice text nowhere; 🔊 says the voice text, a line of hers without
  // one has no 🔊, and 林月 (no 配音语言) is said as written.
  await page.goto(chatUrl)
  const rows = page.locator('.dsh-tavern-cast-line').filter({ visible: true })
  await rows.filter({ hasText: '早上好' }).first().waitFor()
  const floor = page.locator('[data-chat-flow-kind="assistant-step"]').filter({ visible: true }).last()
  result.chatText = await floor.innerText()
  assert.ok(result.chatText.includes('早上好。') && !/おはよう|@bubble|\|/.test(result.chatText), result.chatText)
  const speak = text => rows.filter({ hasText: text }).first().getByRole('button', { name: '朗读这句', exact: true })
  result.buttons = await Promise.all(['早上好', '对不起', '早。'].map(text => speak(text).count()))
  assert.deepEqual(result.buttons, [1, 0, 1])
  await speak('早上好').click()
  await until(() => requests.length === 1, 'the chat says her voice text')
  await speak('早。').click()
  await until(() => requests.length === 2, 'the chat says his line')
  assert.deepEqual(said(), [['ref-hina', 'おはよう。'], ['ref-lin', '早。']])
  await page.screenshot({ path: join(output, 'chat-1920.png') })

  // 3. The stage: her page plays (the voice text, from the cache), her line without voice text plays nothing, his page plays.
  const stage = page.locator('.dsh-tavern-stage-overlay')
  await page.getByRole('button', { name: '舞台', exact: true }).click(); await stage.waitFor()
  const text = stage.locator('.dsh-tavern-stage-text')
  // A click first finishes a line still typing, the next one turns the page.
  const next = async words => { for (let i = 0; i < 4 && !(await text.filter({ hasText: words }).count()); i++) { await stage.getByRole('button', { name: '下一句', exact: true }).click(); await page.waitForTimeout(300) } }
  await text.filter({ hasText: '晨光' }).waitFor()
  let before = await played()
  await next('早上好'); await text.filter({ hasText: '早上好' }).waitFor()
  await until(async () => await played() > before, 'the stage plays her voice text').catch(async error => { await page.screenshot({ path: join(output, 'fail-stage.png') }); throw Error(error.message + ': ' + encodeURIComponent(JSON.stringify([await page.evaluate(() => window.voiceTap.lines), await text.allInnerTexts()]))) })
  assert.ok(!(await stage.innerText()).includes('おはよう'))
  await page.screenshot({ path: join(output, 'stage-1920.png') })
  before = await played()
  await next('对不起'); await text.filter({ hasText: '对不起' }).waitFor()
  await page.waitForTimeout(2500)
  result.silentPage = { played: await played() - before, requests: requests.length }
  assert.deepEqual(result.silentPage, { played: 0, requests: 2 }, 'no voice text, a 配音语言: nothing is said')
  await next('早。'); await text.filter({ hasText: '早。' }).waitFor()
  await until(async () => await played() > before, 'the stage plays his line')
  // The backlog voices the same words: her line without voice text has no 🔊.
  await stage.getByRole('button', { name: '履历', exact: true }).click()
  const backlog = page.locator('.dsh-tavern-stage-backlog-row.is-line').filter({ visible: true })
  await backlog.first().waitFor()
  result.backlog = await backlog.evaluateAll(items => items.map(item => [item.querySelector('.dsh-tavern-stage-backlog-text')?.textContent || item.textContent, Boolean(item.querySelector('.dsh-tavern-speak'))]))
  assert.deepEqual(result.backlog.map(([, button]) => button), [true, false, true], JSON.stringify(result.backlog))
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(output, 'backlog-1920.png') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' })
  assert.deepEqual(said(), [['ref-hina', 'おはよう。'], ['ref-lin', '早。']], 'nothing said the display text of a voiced speaker')

  // 4. A reply from the story model: the format it read tags her; while it streams her row shows the display text only.
  result.stream = await streamingChecks({ page, call, sessionId, chatUrl, rows, speak })
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await browser.close().catch(() => {})
  fish.close()
}

async function until(check, label) { const end = Date.now() + 40000; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)) } throw Error('Timed out: ' + label) }

async function streamingChecks({ page, call, sessionId, chatUrl, rows, speak }) {
  const fixture = 'voice-text-fixture', modelName = 'Voice text fixture'
  const pieces = ['她推门进来。\n@bubble:hina|日向|开心|[我回来了。]|[ただい', 'ま。]\n@bubble:lin|林月|平静|[欢迎。]']
  // Only the model output is substituted; `inputs` keeps what each story request carried, `release` lets the next piece out.
  const source = `import { LlmAdapter } from ${JSON.stringify(pathToFileURL(modulePath).href)}
export const name = ${JSON.stringify(fixture)}, inject = ['llm', 'tavern']
export function apply(ctx) {
  const pieces = ${JSON.stringify(pieces)}, inputs = [], gates = []
  let released = 0
  ctx.tavern.handle(${JSON.stringify(fixture + '/control')}, ({ action } = {}) => { if (action === 'release') { released++; gates.splice(0).forEach(open => open()) } return { inputs, released } })
  const wait = (count, signal) => new Promise(resolve => { const check = () => released >= count || signal?.aborted ? resolve() : gates.push(check); check() })
  class Model extends LlmAdapter {
    async listModels(provider) { return [await this.resolveModel(provider, 'fixed')] }
    async resolveModel(provider, id) { return { provider, id, name: ${JSON.stringify(modelName)}, context: { contextWindow: 64000 } } }
    async *stream(input) {
      const tools = (input.tools || []).map(tool => tool.name), seen = JSON.stringify([input.system, input.messages])
      if (!tools.includes('candidate_submit_choices') && seen.includes('VOICE_STREAM')) {
        const all = [...seen.matchAll(/【对白格式 · [0-9a-f]+】/g)], last = all.length ? seen.slice(all.at(-1).index) : ''
        inputs.push({ tag: last.includes('hina|日向 [Voice language: Japanese]'), voiced: last.includes('<voiced_bubbles>'), plain: last.includes('- 林月|林月\\\\n') })
        yield { type: 'block-start', index: 0, blockType: 'text' }
        if (inputs.length === 1) {
          for (const [index, piece] of pieces.entries()) {
            if (index) await wait(index, input.signal)
            yield { type: 'text-delta', index: 0, text: piece }
          }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: pieces.join('') } }
        } else yield { type: 'block-end', index: 0, block: { type: 'text', text: '@bubble:lin|林月|平静|[好。]' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Done.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter([${JSON.stringify(fixture)}], new Model())
}`
  const zip = writeZipEntries([{ path: 'package.json', content: JSON.stringify({ name: fixture, type: 'module', main: 'index.mjs' }) }, { path: 'index.mjs', content: source }])
  const upload = await page.evaluate(async base64 => (await fetch('/api/dsh-tavern/card-upload', { method: 'POST', body: Uint8Array.from(atob(base64), c => c.charCodeAt(0)), headers: { 'content-type': 'application/octet-stream' } })).json(), zip.toString('base64'))
  await call('installUserPluginUpload', { uploadId: upload.uploadId, name: fixture + '.zip' })
  const control = async action => (await call('callPluginHandler', { name: fixture + '/control', args: { action } })).result
  await until(() => control().catch(() => null), 'fixture plugin')
  const model = { provider: fixture, model: 'fixed' }
  // The stage director is not part of this check.
  await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: false }, defaultForegroundModel: model, defaultBackgroundModel: model } })
  await call('setConversationBackgroundModel', { sessionId, backgroundModel: model, backgroundTasks: { variables: false, posture: false, characterDesign: false, ledger: false, styleReference: false }, webSearchEnabled: false })
  await page.goto(chatUrl)
  const selector = page.getByRole('button', { name: /Select model/ })
  await selector.waitFor()
  if (!(await selector.innerText()).includes(modelName)) {
    await selector.click()
    const item = page.getByRole('menuitemradio', { name: modelName, exact: true })
    await until(async () => await item.isVisible() || (await selector.innerText()).includes(modelName), 'model menu')
    if (await item.isVisible()) await item.click()
  }
  await until(async () => (await selector.innerText()).includes(modelName), 'fixture model selected')
  await rows.nth(2).waitFor()
  const before = await rows.count()
  const box = page.getByRole('textbox', { name: /发消息|Message/ })
  const send = async () => { await box.fill('VOICE_STREAM'); await box.press('Enter') }
  const floor = page.locator('[data-chat-flow-kind="assistant-step"]').filter({ visible: true }).last()
  const stream = {}
  const requested = requests.length

  await send()
  await rows.nth(before).waitFor()
  await until(async () => (await control()).inputs.length === 1, 'the story request')
  stream.input = (await control()).inputs[0]
  assert.deepEqual(stream.input, { tag: true, voiced: true, plain: true }, 'the format tags her with Japanese, adds the voiced rules and leaves him untagged')
  // The voice field is still being written: her row shows the display text, no voice text, no markup and no 🔊.
  stream.streaming = await floor.innerText()
  assert.ok(stream.streaming.includes('我回来了。') && !/ただ|\||@/.test(stream.streaming), stream.streaming)
  assert.equal(await speak('我回来了').count(), 0)
  await page.screenshot({ path: join(output, 'stream-voice-field-1920.png') })
  await control('release')
  await until(async () => (await page.locator('.dsh-tavern-assistant[data-streaming]').count()) === 0, 'reply committed')
  await speak('欢迎。').waitFor()
  stream.final = await floor.innerText()
  assert.ok(!/ただいま|\|/.test(stream.final), stream.final)
  await speak('我回来了').click()
  await until(() => requests.length > requested, 'her new line is said')
  assert.deepEqual(said().slice(requested), [['ref-hina', 'ただいま。']])
  await page.screenshot({ path: join(output, 'stream-final-1920.png') })

  // 配音 off: the next request's format has no tag and no voiced rules (and is sent again, once).
  await call('updateSpeechSettings', { enabled: false, provider: 'fish' })
  await send()
  await until(async () => (await control()).inputs.length === 2, 'the second story request')
  stream.off = (await control()).inputs[1]
  assert.deepEqual(stream.off, { tag: false, voiced: false, plain: true })
  await until(async () => (await page.locator('.dsh-tavern-assistant[data-streaming]').count()) === 0, 'second reply committed')

  // 配音 on, her 配音语言 中文 (stored unset): her voice speaks the display text, so the format is the plain one again.
  await call('updateSpeechSettings', { enabled: true, provider: 'fish' })
  await call('castSetVoiceLanguage', { sessionId, name: '日向', language: '' })
  await send()
  await until(async () => (await control()).inputs.length === 3, 'the third story request')
  stream.sameLanguage = (await control()).inputs[2]
  assert.deepEqual(stream.sameLanguage, { tag: false, voiced: false, plain: true })
  await until(async () => (await page.locator('.dsh-tavern-assistant[data-streaming]').count()) === 0, 'third reply committed')
  return stream
}
