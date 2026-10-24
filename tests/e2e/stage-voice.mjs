// 配音（上）(cast-presentation.md 21/N): the Fish protocol channel over the real host and a stand-in Fish-compatible service.
// Keyless requests carry no Authorization; the 配音 page lists the models the service's /v1/info names; a voiced line is
// said in its character's voice (reference_id) from the chat and on the stage; the stage readies the voices (/v1/warm) only
// when the service declares prepareVoice; with 配音 off nothing is asked. Fresh disposable profile only, no model calls.
// Nothing reaches a speaker: every played <audio> runs into an analyser feeding a zero gain; the evidence is its spectrum.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { buildGameSave, readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { createCastPresentation } from '../../tavern-plugin/lib/domain/cast-presentation.js'
import { stageDirectorFixture } from '../helpers/stage-director-fixture.mjs'
import { openStagePanel } from './cast-stage.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

const HZ = 440
// An original sine tone as 16-bit mono WAV (8 kHz).
function tone(hz, seconds) {
  const samples = Math.round(8000 * seconds), bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / 8000) * 9000), 44 + i * 2)
  return bytes
}
// A stand-in Fish-compatible service: /v1/tts answers a sine; /v1/info is optional (404 without it); /v1/warm records.
async function fishServer(info) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization ?? null, model: req.headers.model ?? null, body: body ? JSON.parse(body) : null })
      if (req.url === '/v1/info' && info) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(info)); return }
      if (req.url === '/v1/tts' && req.method === 'POST') { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(tone(HZ, 2.5)); return }
      if (req.url === '/v1/warm' && req.method === 'POST' && info?.capabilities?.prepareVoice) { res.writeHead(200); res.end(); return }
      res.writeHead(404); res.end('not found')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, requests, url: 'http://127.0.0.1:' + server.address().port }
}

await mkdir(output, { recursive: true })
const warmable = await fishServer({ models: [{ id: 'model-a', label: 'Model A' }, { id: 'model-b', label: 'Model B' }], capabilities: { prepareVoice: true } })
const plain = await fishServer(null)
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.addInitScript(() => {
    const Native = window.Audio
    window.voiceTap = { played: [] }
    // Every played element runs into one analyser that feeds a zero gain.
    window.Audio = function (src) {
      const element = new Native(src), play = element.play.bind(element)
      element.play = () => {
        const tap = window.voiceTap
        if (!tap.context) {
          tap.context = new AudioContext(); tap.analyser = tap.context.createAnalyser(); tap.analyser.fftSize = 4096; tap.analyser.smoothingTimeConstant = 0
          const silence = tap.context.createGain(); silence.gain.value = 0; tap.analyser.connect(silence); silence.connect(tap.context.destination)
        }
        tap.context.createMediaElementSource(element).connect(tap.analyser)
        tap.played.push(element.src)
        return play()
      }
      return element
    }
    window.voiceLevel = hz => {
      const tap = window.voiceTap
      if (!tap.analyser) return -200
      const data = new Float32Array(tap.analyser.frequencyBinCount); tap.analyser.getFloatFrequencyData(data)
      const bin = Math.round(hz * tap.analyser.fftSize / tap.context.sampleRate)
      return Math.round(Math.max(data[bin - 1], data[bin], data[bin + 1]))
    }
  })
  const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
    const result = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
    if (result.ok === false) throw Error(method + ': ' + JSON.stringify(result))
    return result
  }, [method, args])
  const heard = async label => {
    await page.waitForFunction(hz => window.voiceLevel(hz) > -50, HZ, { timeout: 12000, polling: 100 }).catch(async () => { throw Error(label + ': ' + await page.evaluate(hz => window.voiceLevel(hz), HZ)) })
    return { level: await page.evaluate(hz => window.voiceLevel(hz), HZ), played: (await page.evaluate(() => window.voiceTap.played.length)) }
  }
  const quiet = () => page.waitForFunction(hz => window.voiceLevel(hz) < -80, HZ, { timeout: 12000, polling: 100 })
  const until = async (requests, match, label) => {
    for (let i = 0; i < 100; i++) { const found = requests.find(match); if (found) return found; await page.waitForTimeout(100) }
    throw Error(label + ': ' + JSON.stringify(requests))
  }

  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const run = Date.now(), name = 'Voice ' + run % 100000
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {} } }
  const imported = (await call('importCard', { payload: { kind: 'charx', name: 'voice-' + run + '.charx', fileB64: writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }]).toString('base64') } })).card
  await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true } } })

  // Turn 2: Nora's line, then narration. Its annotation (who says the line) comes from the real cast tool, kept in the save.
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' },
    { name: 'Reader', is_user: true, mes: 'Hello?' }, { name, is_user: false, mes: '“Welcome back, traveller.”\nThe hall is quiet.' }].map(JSON.stringify).join('\n')
  const game = await call('importChatHistoryText', { cardPath: imported.path, text: history, fileName: 'voice.jsonl' })
  const save = readGameSave(Buffer.from((await call('exportGameSave', { sessionId: game.sessionId, images: false })).base64, 'base64'))
  const fixture = await stageDirectorFixture(save.chat, { player: 'Reader', cast: [{ name: 'Nora' }], background: [], music: [] })
  const cast = createCastPresentation({ enabled: async () => true, turns: { readPendingTurn: () => fixture.body() }, data: fixture.data })
  assert.match(await cast.settlement.section({ gameId: 'game', turn: 2 }), /Welcome back/)
  assert.equal(JSON.parse(await cast.settlement.call('cast_submit', { lines: [{ n: 1, speaker: 'Nora', emotion: 'joy' }] }, { gameId: 'game', turn: 2 })).ok, true)
  save.plugins = { data: { version: 1, owners: (await fixture.data.snapshot(save.chat.id)).owners }, media: null, attachments: [] }
  const restored = await call('importGameSave', { fileB64: buildGameSave({ ...save, tavernVersion: save.manifest.tavernVersion, exportedAt: Date.now() }).toString('base64') })
  const sessionId = restored.sessionId, title = 'Voice verification ' + run
  await call('renameConversation', { sessionId, title })
  // Nora's own voice on the Fish channel: a reference id on the service.
  await call('castSetCharacter', { sessionId, name: 'Nora' })
  await call('castSetVoice', { sessionId, name: 'Nora', provider: 'fish', voice: 'ref-nora' })
  const result = {}

  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  const chatUrl = page.url()
  const form = page.locator('.dsh-tavern-speech-settings')
  async function speechPage() {
    await openStagePanel(page, '配音')
    await form.filter({ visible: true }).waitFor()
  }
  // 1. 配音 › Fish 协议 with no key: saved, and the models come from the service's /v1/info, asked without Authorization.
  await speechPage()
  await page.getByRole('combobox', { name: '配音渠道', exact: true }).selectOption('fish')
  await form.getByText('API Key（选填）', { exact: true }).waitFor()
  await form.getByRole('textbox', { name: '服务地址', exact: true }).fill(warmable.url)
  await form.getByLabel('默认声音', { exact: true }).fill('ref-default')
  await page.getByRole('switch', { name: '开启配音', exact: true }).click()
  await page.getByText('已保存，使用「Fish 协议」配音').waitFor()
  await form.getByText('服务提供的模型：Model A、Model B', { exact: true }).waitFor()
  result.models = await form.locator('#dsh-tavern-speech-models option').evaluateAll(options => options.map(option => option.value))
  assert.deepEqual(result.models, ['model-a', 'model-b'])
  const info = warmable.requests.find(item => item.path === '/v1/info')
  assert.equal(info.authorization, null, 'a keyless request carries no Authorization')
  await page.screenshot({ path: join(output, 'voice-settings-1920.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: join(output, 'voice-settings-375.png'), fullPage: true })
  await page.setViewportSize({ width: 1920, height: 1080 })

  // 2. The chat's voiced line: said in Nora's voice, with the first listed model, no Authorization; the audio plays.
  await page.goto(chatUrl)
  const row = page.locator('.dsh-tavern-cast-line').filter({ visible: true }).filter({ hasText: 'Welcome back' }).first()
  await row.getByRole('button', { name: '朗读这句', exact: true }).click()
  const tts = await until(warmable.requests, item => item.path === '/v1/tts', 'the line reaches /v1/tts')
  result.bubble = { request: tts, ...(await heard('the chat line is heard')) }
  assert.deepEqual([tts.authorization, tts.model, tts.body], [null, 'model-a', { text: 'Welcome back, traveller.', reference_id: 'ref-nora', format: 'wav' }])
  await page.screenshot({ path: join(output, 'voice-bubble-1920.png') })
  await quiet()

  // 3. The stage opening with 配音 on readies Nora's voice (prepareVoice declared) and reads the page's line (from the cache).
  const stage = page.locator('.dsh-tavern-stage-overlay')
  const open = async () => { await page.getByRole('button', { name: '舞台', exact: true }).click(); await stage.waitFor() }
  const before = warmable.requests.length
  await open()
  await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'Welcome back' }).waitFor()
  const warm = await until(warmable.requests, item => item.path === '/v1/warm', 'the stage warms the voice')
  assert.deepEqual([warm.authorization, warm.model, warm.body], [null, 'model-a', { reference_id: 'ref-nora' }])
  result.stage = { warm, ...(await heard('the stage reads the line')) }
  assert.equal(warmable.requests.slice(before).filter(item => item.path === '/v1/tts').length, 0, 'the same line comes from the cache')
  await page.screenshot({ path: join(output, 'voice-stage-1920.png') })
  await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' })
  await quiet()

  // 4. A service without /v1/info: no model list, synthesis without a model header, and the stage never warms.
  await speechPage()
  await form.getByRole('textbox', { name: '服务地址', exact: true }).fill(plain.url)
  await form.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('已保存，使用「Fish 协议」配音').waitFor()
  await until(plain.requests, item => item.path === '/v1/info', 'the 配音 page asks the new address')
  assert.equal(await form.locator('#dsh-tavern-speech-models').count(), 0, 'no list without /v1/info')
  await page.goto(chatUrl)
  await row.getByRole('button', { name: '朗读这句', exact: true }).click()
  const plainTts = await until(plain.requests, item => item.path === '/v1/tts', 'the line reaches the second service')
  assert.deepEqual([plainTts.authorization, plainTts.model, plainTts.body.reference_id], [null, null, 'ref-nora'])
  result.plain = { request: plainTts, ...(await heard('the second service\'s line is heard')) }
  await quiet()
  await open(); await stage.locator('.dsh-tavern-stage-text').first().waitFor(); await page.waitForTimeout(2000)
  assert.equal(plain.requests.some(item => item.path === '/v1/warm'), false, 'no warm without prepareVoice')
  await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' })

  // 5. 配音 off: no speak button, and opening the stage and turning pages asks neither service anything.
  await speechPage()
  await page.getByRole('switch', { name: '开启配音', exact: true }).click()
  await page.getByText('已保存，配音已关闭').waitFor()
  await page.goto(chatUrl)
  await page.locator('.dsh-tavern-cast-line').filter({ visible: true }).first().waitFor()
  const asked = [warmable.requests.length, plain.requests.length], played = await page.evaluate(() => window.voiceTap.played.length)
  assert.equal(await page.getByRole('button', { name: '朗读这句', exact: true }).count(), 0)
  await open(); await stage.locator('.dsh-tavern-stage-text').first().waitFor()
  await stage.getByRole('button', { name: '下一句', exact: true }).click(); await page.waitForTimeout(2500)
  assert.deepEqual([warmable.requests.length, plain.requests.length], asked, 'voice off: no request')
  assert.equal(await page.evaluate(() => window.voiceTap.played.length), played, 'voice off: nothing plays')
  await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' })
  result.off = { requests: asked, played }
  result.servers = { warmable: warmable.requests.map(item => [item.method, item.path, item.authorization, item.model]), plain: plain.requests.map(item => [item.method, item.path, item.authorization, item.model]) }
  await writeFile(join(output, 'stage-voice.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ voice: true, output }))
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages())[0]
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText().catch(() => ''))
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally { await browser.close(); warmable.server.close(); plain.server.close() }
