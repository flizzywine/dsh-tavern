// 随卡参考音频 (cast-presentation.md 22/N): a character's own reference clips over the real host and a stand-in service.
// In 舞台素材 a character's 配音来源 is one choice among the configured channels, Fish's clone of its clips being one
// option. The clone chosen without clips gives a visible, fixable error and synthesizes nothing; with clips (audio + what
// it says) its line goes to /v1/tts in MessagePack with the clips inline and no reference_id; the stage warms nothing for it
// and reads the line from the cache; Fish's voice ID says the line with the ID; a channel that is not Fish (GPT-SoVITS) says
// it with the voice set there; the clone again reads the cache; removing a clip makes a new synthesis; the card exported as
// CHARX carries the clips and the choice and imports them again; removing the last clip switches nothing back.
// Fresh disposable profile only, no model calls. Nothing reaches a speaker: played <audio> runs into an analyser and a zero gain.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { readZipEntries, writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
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
// A MessagePack reader for what a Fish service accepts (fix/8/16/32 str, bin, array, map; ints; nil/bool).
function unpack(bytes) {
  let at = 0
  const take = size => { const slice = bytes.subarray(at, at + size); at += size; return slice }
  const uint = width => { const value = width === 1 ? bytes[at] : width === 2 ? bytes.readUInt16BE(at) : bytes.readUInt32BE(at); at += width; return value }
  const list = size => Array.from({ length: size }, next)
  const map = size => Object.fromEntries(Array.from({ length: size }, () => [next(), next()]))
  function next() {
    const tag = bytes[at++]
    if (tag <= 0x7f) return tag
    if (tag >= 0xa0 && tag <= 0xbf) return take(tag & 0x1f).toString('utf8')
    if (tag >= 0x90 && tag <= 0x9f) return list(tag & 0x0f)
    if (tag >= 0x80 && tag <= 0x8f) return map(tag & 0x0f)
    if (tag === 0xc0) return null
    if (tag === 0xc2 || tag === 0xc3) return tag === 0xc3
    if (tag === 0xd9 || tag === 0xda || tag === 0xdb) return take(uint({ 0xd9: 1, 0xda: 2, 0xdb: 4 }[tag])).toString('utf8')
    if (tag === 0xc4 || tag === 0xc5 || tag === 0xc6) return Buffer.from(take(uint({ 0xc4: 1, 0xc5: 2, 0xc6: 4 }[tag])))
    if (tag === 0xdc || tag === 0xdd) return list(uint(tag === 0xdc ? 2 : 4))
    if (tag === 0xde || tag === 0xdf) return map(uint(tag === 0xde ? 2 : 4))
    if (tag === 0xcc || tag === 0xcd || tag === 0xce) return uint({ 0xcc: 1, 0xcd: 2, 0xce: 4 }[tag])
    throw Error('MessagePack tag 0x' + tag.toString(16) + ' at ' + (at - 1))
  }
  const value = next()
  if (at !== bytes.length) throw Error('MessagePack trailing bytes')
  return value
}
// A stand-in Fish-compatible service that declares prepareVoice; /v1/tts reads JSON or MessagePack and answers a sine,
// as does the GPT-SoVITS /tts at the same address.
async function fishServer() {
  const requests = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => { chunks.push(chunk) })
    req.on('end', () => {
      const raw = Buffer.concat(chunks), type = req.headers['content-type'] || null
      requests.push({ method: req.method, path: req.url, type, authorization: req.headers.authorization ?? null, model: req.headers.model ?? null, bytes: raw.length,
        body: !raw.length ? null : type === 'application/msgpack' ? unpack(raw) : JSON.parse(raw.toString('utf8')) })
      if (req.url === '/v1/info') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ models: [{ id: 'model-a' }], capabilities: { prepareVoice: true } })); return }
      if ((req.url === '/v1/tts' || req.url === '/tts') && req.method === 'POST') { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(tone(HZ, 2.5)); return }
      if (req.url === '/v1/warm' && req.method === 'POST') { res.writeHead(200); res.end(); return }
      res.writeHead(404); res.end('not found')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, requests, url: 'http://127.0.0.1:' + server.address().port }
}
// What the evidence keeps of a request: clip audio as its length, never its bytes.
const brief = request => ({ ...request, body: request.body && { ...request.body, ...(request.body.references ? { references: request.body.references.map(clip => ({ audioBytes: clip.audio.length, text: clip.text })) } : {}) } })

await mkdir(output, { recursive: true })
const fish = await fishServer()
const clips = [{ audio: tone(330, 1), text: 'The rain will stop by evening.' }, { audio: tone(550, 0.8), text: 'Follow me, quietly.' }]
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
    return await page.evaluate(hz => window.voiceLevel(hz), HZ)
  }
  const quiet = () => page.waitForFunction(hz => window.voiceLevel(hz) < -80, HZ, { timeout: 12000, polling: 100 })
  const until = async (match, label, from = 0) => {
    for (let i = 0; i < 100; i++) { const found = fish.requests.slice(from).find(match); if (found) return found; await page.waitForTimeout(100) }
    throw Error(label + ': ' + JSON.stringify(fish.requests.map(brief)))
  }

  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const run = Date.now(), name = 'Clips ' + run % 100000
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {} } }
  const imported = (await call('importCard', { payload: { kind: 'charx', name: 'clips-' + run + '.charx', fileB64: writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }]).toString('base64') } })).card
  await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true } } })
  // Turn 2: Nora's line as the story model writes it (a dialogue bubble naming her).
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' },
    { name: 'Reader', is_user: true, mes: 'Hello?' }, { name, is_user: false, mes: '@bubble:nora|Nora|开心|[Welcome back, traveller.]\nThe hall is quiet.' }].map(JSON.stringify).join('\n')
  const game = await call('importChatHistoryText', { cardPath: imported.path, text: history, fileName: 'clips.jsonl' })
  const sessionId = game.sessionId, title = 'Clip verification ' + run
  await call('renameConversation', { sessionId, title })
  await call('castSetCharacter', { sessionId, name: 'Nora' })
  await call('castSetVoice', { sessionId, name: 'Nora', provider: 'fish', voice: 'ref-nora' })
  // A second channel set up before Fish (GPT-SoVITS at the same stand-in), so Nora can pick a channel that is not Fish.
  await call('updateSpeechSettings', { enabled: false, provider: 'gpt-sovits', config: { baseUrl: fish.url, voice: '/data/default.wav' } })
  const result = {}

  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  const chatUrl = page.url()

  // 1. 配音 › Fish 协议 at the stand-in service, keyless, a default voice ID; Nora has her own ID ref-nora.
  const form = page.locator('.dsh-tavern-speech-settings').filter({ visible: true })
  await openStagePanel(page, '配音')
  await form.waitFor()
  await form.getByRole('combobox', { name: '配音渠道', exact: true }).selectOption('fish')
  await form.getByRole('textbox', { name: '服务地址', exact: true }).fill(fish.url)
  await form.getByLabel('默认声音', { exact: true }).fill('ref-default')
  const toggle = form.getByRole('switch', { name: '开启配音', exact: true })
  if (await toggle.isChecked()) await form.getByRole('button', { name: '保存', exact: true }).click()
  else await toggle.click()
  await page.getByText('已保存，使用「Fish 协议」配音').waitFor()

  // 2. 舞台素材: Nora's 配音来源 is one choice among the configured channels, Fish's clone being one of them; nothing chosen
  // means the channel in use. No clip block until the clone is chosen.
  await openStagePanel(page, '舞台素材')
  const row = page.locator('.dsh-tavern-cast-manager-row').filter({ visible: true }).filter({ hasText: 'Nora' }).first()
  await row.waitFor()
  const source = row.getByLabel('Nora 的配音来源', { exact: true }), voice = row.getByLabel('Nora 的声音', { exact: true })
  const refs = row.locator('.dsh-tavern-cast-refs')
  const missing = refs.locator('small.is-missing')
  const choose = async value => {
    await source.selectOption(value)
    await page.getByText('已保存 Nora 的配音来源', { exact: true }).waitFor()
    await page.waitForFunction(([value]) => [...document.querySelectorAll('select[aria-label="Nora 的配音来源"]')].some(item => item.value === value), [value])
  }
  result.options = await source.locator('option').allTextContents()
  assert.deepEqual(result.options, ['默认（Fish 协议）', '浏览器朗读', 'GPT-SoVITS', 'Fish 协议 · 声音 ID', 'Fish 协议 · 声音克隆（参考音频）'])
  assert.deepEqual([await source.inputValue(), await voice.inputValue(), await refs.count()], ['', 'ref-nora', 0])
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(output, 'materials-1920.png') })

  // 3. Fish's clone chosen with no clip yet: it is not greyed out, the block says what is missing, and a line gives a clear,
  // fixable error instead of being voiced (no request, nothing switched).
  await choose('fish#clone')
  await missing.waitFor()
  assert.equal(await voice.count(), 0, 'a clone has no voice ID to fill')
  const errorText = '「Nora」的配音来源是「Fish 协议 · 声音克隆（参考音频）」，还没有参考音频：请在「舞台素材」里为它上传参考音频，或换一个配音来源'
  const errorShown = page.locator('.dsh-tavern-error-message').filter({ hasText: errorText })
  let mark = fish.requests.length
  await row.getByRole('button', { name: '朗读这句', exact: true }).click()
  await errorShown.waitFor()
  result.noClipError = { message: await errorShown.innerText(), requests: fish.requests.slice(mark).map(item => item.path) }
  assert.deepEqual(result.noClipError.requests, [], 'nothing is synthesized without clips')
  assert.equal(await source.inputValue(), 'fish#clone', 'the choice stays')
  await page.screenshot({ path: join(output, 'materials-clone-empty-1920.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(400)
  await row.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'materials-clone-empty-375.png'), fullPage: true })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.locator('.dsh-tavern-error-center').getByRole('button', { name: '清除', exact: true }).click()

  // 4. Two clips (the words first, then the file); the choice is not touched by uploading.
  const upload = refs.getByRole('button', { name: '上传参考音频', exact: true })
  assert.equal(await upload.isDisabled(), true, 'no file before its words')
  for (const [index, clip] of clips.entries()) {
    await refs.getByRole('textbox', { name: 'Nora 的参考原文', exact: true }).fill(clip.text)
    const chooser = page.waitForEvent('filechooser')
    await upload.click()
    await (await chooser).setFiles({ name: 'nora-' + (index + 1) + '.wav', mimeType: 'audio/wav', buffer: clip.audio })
    await refs.locator('li').nth(index).getByText(clip.text, { exact: true }).waitFor()
  }
  await page.getByText('已为 Nora 加上参考音频', { exact: true }).waitFor()
  await refs.getByText('合成时把这 2 段录音和原话一起发给「Fish 协议」，照着它们的声音说每一句。', { exact: true }).waitFor()
  assert.deepEqual([await source.inputValue(), await missing.count()], ['fish#clone', 0])
  await page.screenshot({ path: join(output, 'materials-clips-1920.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(400)
  await row.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'materials-clips-375.png'), fullPage: true })
  await page.setViewportSize({ width: 1920, height: 1080 })

  // 5. The chat's voiced line: MessagePack with both clips inline (audio bytes as uploaded, their words), no reference_id,
  // although Nora also has her own ID (the chosen source is used).
  await page.goto(chatUrl)
  const line = page.locator('.dsh-tavern-cast-line').filter({ visible: true }).filter({ hasText: 'Welcome back' }).first()
  await line.getByRole('button', { name: '朗读这句', exact: true }).click()
  const tts = await until(item => item.path === '/v1/tts', 'the line reaches /v1/tts')
  assert.deepEqual([tts.type, tts.authorization, tts.model], ['application/msgpack', null, 'model-a'])
  assert.deepEqual(Object.keys(tts.body).sort(), ['format', 'references', 'text'])
  assert.deepEqual([tts.body.text, tts.body.format], ['Welcome back, traveller.', 'wav'])
  assert.deepEqual(tts.body.references.map(clip => clip.text), clips.map(clip => clip.text))
  tts.body.references.forEach((clip, index) => assert.ok(clip.audio.equals(clips[index].audio), 'clip ' + (index + 1) + ' arrives byte for byte'))
  result.bubble = { request: brief(tts), level: await heard('the chat line is heard') }
  await quiet()

  // 6. The stage: nothing to warm for a character voiced by its clips; the page's line comes from the cache.
  const stage = page.locator('.dsh-tavern-stage-overlay')
  const before = fish.requests.length
  await page.getByRole('button', { name: '舞台', exact: true }).click(); await stage.waitFor()
  await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'Welcome back' }).waitFor()
  result.stage = { level: await heard('the stage reads the line') }
  await page.waitForTimeout(1500)
  assert.deepEqual(fish.requests.slice(before).map(item => item.path), [], 'no warm and no new synthesis')
  await page.screenshot({ path: join(output, 'clips-stage-1920.png') })
  await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' })
  await quiet()

  // 7. Fish's voice ID chosen: the same line is said with Nora's ID (JSON, reference_id ref-nora); the clone again reads the cache.
  await openStagePanel(page, '舞台素材')
  await choose('fish')
  assert.deepEqual([await voice.inputValue(), await refs.count()], ['ref-nora', 0])
  await page.goto(chatUrl)
  mark = fish.requests.length
  await line.getByRole('button', { name: '朗读这句', exact: true }).click()
  const byId = await until(item => item.path === '/v1/tts', 'the line is said with the ID', mark)
  assert.deepEqual([byId.type, byId.body], ['application/json', { text: 'Welcome back, traveller.', reference_id: 'ref-nora', format: 'wav' }])
  result.library = { request: brief(byId), level: await heard('the line with the ID is heard') }
  await quiet()

  // 8. A channel that is not Fish: GPT-SoVITS with Nora's own voice there; the line goes to its /tts, nothing to Fish.
  await openStagePanel(page, '舞台素材')
  await choose('gpt-sovits')
  assert.equal(await voice.getAttribute('placeholder'), '/data/default.wav')
  await voice.fill('/data/nora.wav|Hello there.')
  await voice.press('Enter')
  await page.getByText('已保存 Nora 的声音', { exact: true }).waitFor()
  await page.goto(chatUrl)
  mark = fish.requests.length
  await line.getByRole('button', { name: '朗读这句', exact: true }).click()
  const sovits = await until(item => item.path === '/tts', 'the line reaches the chosen channel', mark)
  assert.deepEqual([sovits.type, sovits.body.text, sovits.body.ref_audio_path, sovits.body.prompt_text], ['application/json', 'Welcome back, traveller.', '/data/nora.wav', 'Hello there.'])
  result.otherChannel = { request: brief(sovits), level: await heard('the line on the other channel is heard') }
  await page.waitForTimeout(500)
  assert.deepEqual(fish.requests.slice(mark).map(item => item.path), ['/tts'], 'nothing reaches Fish')
  await quiet()
  await openStagePanel(page, '舞台素材')
  await choose('fish#clone')
  await page.goto(chatUrl)
  mark = fish.requests.length
  await line.getByRole('button', { name: '朗读这句', exact: true }).click()
  result.cloneAgain = { level: await heard('the clip-voiced line is heard again') }
  await page.waitForTimeout(800)
  assert.deepEqual(fish.requests.slice(mark).map(item => item.path), [], 'the clone again: the same clips read the cache')
  await quiet()

  // 9. Removing a clip changes the voice: the same line is synthesized again with the one clip left.
  await openStagePanel(page, '舞台素材')
  await refs.getByRole('button', { name: '删除第 2 段参考音频', exact: true }).click()
  await page.getByText('已删除 Nora 的一段参考音频').waitFor()
  // The list follows the saved cast once 舞台素材 has read it again; wait for that, not only the notice.
  await refs.locator('li').nth(1).waitFor({ state: 'detached' })
  assert.equal(await refs.locator('li').count(), 1)
  await page.goto(chatUrl)
  const from = fish.requests.length
  await line.getByRole('button', { name: '朗读这句', exact: true }).click()
  const again = await until(item => item.path === '/v1/tts', 'the line is said again', from)
  assert.deepEqual(again.body.references.map(clip => clip.text), [clips[0].text])
  result.afterRemove = { request: brief(again), level: await heard('the line with one clip is heard') }
  await quiet()

  // 10. The card exported as CHARX carries Nora's clip (audio and words) and her 配音来源; importing that file brings it back.
  const exported = await page.evaluate(async path => {
    const response = await fetch('/api/dsh-tavern/card-export?path=' + encodeURIComponent(path))
    const bytes = new Uint8Array(await response.arrayBuffer())
    let text = ''
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { status: response.status, base64: btoa(text) }
  }, imported.path)
  assert.equal(exported.status, 200)
  const entries = readZipEntries(Buffer.from(exported.base64, 'base64'))
  const nora = JSON.parse(entries.get('card.json').toString('utf8')).data.extensions.dsh_tavern.cast.characters.find(item => item.name === 'Nora')
  assert.equal(nora.voiceReferences.length, 1)
  assert.equal(nora.voiceReferences[0].text, clips[0].text)
  assert.deepEqual(nora.voiceSource, { provider: 'fish', clone: true })
  assert.ok(entries.get(nora.voiceReferences[0].audio.replace('embeded://', '')).equals(clips[0].audio), 'the exported clip is the uploaded audio')
  const reimported = await call('importCard', { payload: { kind: 'charx', name: 'clips-again-' + run + '.charx', fileB64: exported.base64 } })
  assert.equal(reimported.card.assets.references, 1, JSON.stringify(reimported.card.assets))
  result.card = { exported: { path: nora.voiceReferences[0].audio, text: nora.voiceReferences[0].text, voiceSource: nora.voiceSource }, reimported: reimported.card.assets }

  // 11. Removing the last clip switches nothing back: the clone stays chosen, says what is missing, and a line errors visibly.
  await openStagePanel(page, '舞台素材')
  await refs.getByRole('button', { name: '删除第 1 段参考音频', exact: true }).click()
  await page.getByText('已删除 Nora 的一段参考音频').waitFor()
  await page.waitForFunction(() => !document.querySelector('.dsh-tavern-cast-refs li'))
  await missing.waitFor()
  assert.equal(await source.inputValue(), 'fish#clone', 'the last clip removed: still the clone')
  await page.goto(chatUrl)
  mark = fish.requests.length
  await line.getByRole('button', { name: '朗读这句', exact: true }).click()
  await errorShown.waitFor()
  await page.waitForTimeout(500)
  assert.deepEqual(fish.requests.slice(mark).map(item => item.path), [], 'no silent fallback to the ID')
  result.lastRemoved = { source: 'fish#clone', error: await errorShown.innerText() }
  result.servers = fish.requests.map(item => [item.method, item.path, item.type, item.authorization, item.model, item.bytes])
  assert.equal(fish.requests.some(item => item.path === '/v1/warm'), false, 'a clip-voiced character is never warmed')
  await writeFile(join(output, 'stage-voice-references.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ voiceReferences: true, output }))
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages())[0]
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText().catch(() => ''))
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally { await browser.close(); fish.server.close() }
