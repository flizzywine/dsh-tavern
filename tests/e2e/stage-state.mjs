import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { buildGameSave, readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { computeSceneTarget } from '../../tavern-plugin/lib/domain/scene-illustration.js'
import { CAST_DATA_OWNER } from '../../tavern-plugin/lib/domain/cast-annotation.js'
import { stageDirectorFixture, runDirectorFixture } from '../helpers/stage-director-fixture.mjs'
import { STAGE_DATA_OWNER } from '../../tavern-plugin/lib/domain/stage-director.js'

function png(r, g, b) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header.set([8, 6], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, r, g, b, 255]))), chunk('IEND', Buffer.alloc(0))])
}

// A fixture invokes the real tool/transaction; its accepted record travels through
// native save import. No model calls or test-only production RPC are needed.
// `items`: { name, bytes } pictures added to the card's pack as 物品 entries (props) and offered to the director.
export async function stageStateChecks({ page, output, demo = false, bodyText = '"Ready."', performances, items = [], inspect }) {
  // The stage's BGM is Web Audio: route every context into a zero gain and count the sources it starts.
  await page.addInitScript(() => {
    const Base = window.AudioContext
    window.stageTestAudio = { contexts: [], sources: 0 }
    window.AudioContext = class extends Base {
      constructor(...args) { super(...args); const silence = super.createGain(); silence.gain.value = 0; silence.connect(super.destination); this.stageTestSilence = silence; window.stageTestAudio.contexts.push(this) }
      get destination() { return this.stageTestSilence }
      createBufferSource() { window.stageTestAudio.sources++; return super.createBufferSource() }
    }
  })
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
    const result = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
    if (result.ok === false) throw Error(method + ': ' + JSON.stringify(result))
    return result
  }, [method, args])
  const run = Date.now()
  const name = 'Stage ' + run
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {}, assets: [
    { type: 'emotion', name: 'joy', uri: 'embeded://assets/emotion/joy.png', ext: 'png' },
    { type: 'emotion', name: 'sadness', uri: 'embeded://assets/emotion/sadness.png', ext: 'png' },
    { type: 'background', name: 'main', uri: 'embeded://assets/background/room.png', ext: 'png' },
    { type: 'background', name: 'hall', uri: 'embeded://assets/background/hall.png', ext: 'png' },
    { type: 'music', name: 'theme', uri: 'embeded://assets/music/theme.wav', ext: 'wav' }
  ] } }
  const wav = Buffer.alloc(16044)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40)
  const archive = writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }, { path: 'assets/emotion/joy.png', content: png(210, 90, 40) },
    { path: 'assets/emotion/sadness.png', content: png(40, 80, 200) }, { path: 'assets/background/room.png', content: png(30, 70, 90) },
    { path: 'assets/background/hall.png', content: png(90, 70, 30) }, { path: 'assets/music/theme.wav', content: wav }])
  const imported = (await call('importCard', { payload: { kind: 'charx', name: 'stage-' + run + '.charx', fileB64: archive.toString('base64') } })).card
  if (items.length) {
    const [packId] = (await call('getCardAssetPacks', { path: imported.path })).boundPackIds
    const files = await page.evaluate(rows => Promise.all(rows.map(async ({ name, bytes }) => {
      const reply = await (await fetch('/api/dsh-tavern/card-upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Uint8Array.from(atob(bytes), c => c.charCodeAt(0)) })).json()
      if (!reply.ok) throw Error('upload: ' + JSON.stringify(reply))
      return { uploadId: reply.uploadId, name }
    })), items.map(item => ({ name: item.name, bytes: item.bytes.toString('base64') })))
    const added = await call('addAssetPackFiles', { packId, kind: 'props', files })
    assert.deepEqual(added.added.length, items.length, JSON.stringify(added.rejected))
  }
  await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true } } })
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' }, { name: 'Reader', is_user: true, mes: 'Begin.' }, { name, is_user: false, mes: bodyText }].map(JSON.stringify).join('\n')
  const game = await call('importChatHistoryText', { cardPath: imported.path, text: history, fileName: 'stage.jsonl' })
  assert.ok(game.sessionId, JSON.stringify(game))
  const exported = await call('exportGameSave', { sessionId: game.sessionId, images: false })
  const save = readGameSave(Buffer.from(exported.base64, 'base64'))
  const turn = Math.max(...save.chat.messages.filter(m => m.role === 'assistant').map(m => m.turn || 1))
  const annotation = { version: 1, lines: [{ n: 1, quote: 'Ready.', speaker: name, emotion: 'joy' }] }
  save.plugins = { data: { version: 1, owners: { [CAST_DATA_OWNER]: { game: null, turns: [{ turn, key: computeSceneTarget(save.chat, turn).key, data: annotation, bytes: JSON.stringify(annotation).length, updatedAt: 1 }] } } }, media: null, attachments: [] }
  const fixtureAssets = { player: 'Reader', cast: [{ name }], background: [{ name: 'main' }, { name: 'hall' }], music: [{ name: 'theme' }], ...(items.length ? { items: items.map(item => ({ name: item.name })) } : {}) }
  const fixture = await stageDirectorFixture(save.chat, fixtureAssets)
  const submitted = { figures: [{ speaker: name, emotion: 'sadness' }], background: 'hall', music: 'theme', ...(performances ? { performances: performances(name) } : {}) }
  const directorRun = await runDirectorFixture(fixture, [{...submitted, music: 'Missing'}, submitted])
  assert.equal(directorRun.receipts[0].retryable, true)
  const accepted = directorRun.receipts.at(-1)
  assert.deepEqual(accepted, { ok: true })
  Object.assign(save.plugins.data.owners, (await fixture.data.snapshot(save.chat.id)).owners)
  const restored = await call('importGameSave', { fileB64: buildGameSave({ ...save, tavernVersion: save.manifest.tavernVersion, exportedAt: Date.now() }).toString('base64') })
  await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true } } })
  await call('castSetImage', { sessionId: restored.sessionId, name, slot: 'joy', data: png(210, 90, 40).toString('base64') })
  const title = 'Stage continuity restored ' + Date.now()
  await call('renameConversation', { sessionId: restored.sessionId, title })
  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor()
  if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  const stage = page.locator('.dsh-tavern-stage-overlay')
  const open = async () => { if (!await stage.isVisible()) await page.getByRole('button', { name: '舞台', exact: true }).click() }
  await open()
  await stage.waitFor()
  await stage.locator('.dsh-tavern-stage-name').filter({ hasText: name }).waitFor()
  const snapshot = async label => {
    const rpc = await call('castStage', { sessionId: restored.sessionId, count: 1 })
    const figures = await stage.locator('.dsh-tavern-stage-figure').evaluateAll(nodes => nodes.map(node => ({ name: node.dataset.speaker, image: node.querySelector('img')?.getAttribute('src') || '' })))
    const background = await stage.locator('.dsh-tavern-stage-backdrop').getAttribute('style')
    await page.screenshot({ path: join(output, label + '.png') })
    return { figures, background, turn: rpc.turns.at(-1)?.turn, cast: rpc.cast, stage: rpc.stage, music: rpc.music }
  }
  const before = await snapshot('stage-before')
  assert.equal(before.figures.length, 1)
  assert.ok(before.figures[0].image, 'The fixture must show a real imported sprite')
  assert.equal(before.figures[0].image, before.cast.find(item => item.name === name).sprites[demo ? 'joy' : 'sadness'])
  if (!demo) {
    assert.equal(before.stage.background, 'hall')
    assert.equal(before.music.name, 'theme')
    await page.waitForFunction(() => window.stageTestAudio.sources > 0 && window.stageTestAudio.contexts.some(context => context.state === 'running' && context.currentTime > 0))
  } else assert.equal(before.stage, undefined, 'The demo ignores accepted director records')
  const performance = inspect ? await inspect({ page, stage, call, sessionId: restored.sessionId, name }) : null
  await call('appendStoryRounds', { sessionId: restored.sessionId, rounds: [{ user: 'Wait.', assistant: 'A quiet moment passes.' }] })
  await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'A quiet moment passes.' }).waitFor()
  const next = await snapshot('stage-next-turn')
  await page.reload()
  await open(); await stage.waitFor()
  await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'A quiet moment passes.' }).waitFor()
  const reloaded = await snapshot('stage-reloaded')
  const result = { demo, performance, submitted, accepted, directorRun, before, next, reloaded, carriesTurn: next.figures[0]?.name === name, carriesReload: reloaded.figures[0]?.name === name,
    backgroundPreserved: before.background === next.background && before.background === reloaded.background }
  await writeFile(join(output, 'stage-state.json'), JSON.stringify(result, null, 2))
  assert.ok(result.carriesTurn, 'A narration-only next turn must retain the preceding figure')
  assert.ok(result.carriesReload, 'Reload must rebuild the same figure')
  assert.ok(result.backgroundPreserved)
  await call('appendStoryRounds', { sessionId: restored.sessionId, rounds: Array.from({ length: 6 }, (_, i) => ({ user: 'Wait.', assistant: 'Quiet interval ' + i + '.' })) })
  await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'Quiet interval 5.' }).waitFor()
  result.longSilence = await snapshot('stage-long-silence')
  assert.deepEqual(result.longSilence.figures, before.figures, 'The cast must not depend on the recent-turn window')
  if (!demo) assert.deepEqual(result.longSilence.stage, before.stage, 'count=1 still receives the full historical state')
  await open()
  const fullscreen = page.locator('.dsh-tavern-stage-overlay')
  await fullscreen.locator('.dsh-tavern-stage-figure img').waitFor()
  assert.equal(await fullscreen.locator('.dsh-tavern-stage-figure').getAttribute('data-speaker'), name)
  await page.screenshot({ path: join(output, 'stage-fullscreen.png') })
  await page.keyboard.press('Escape')
  result.fullscreen = true
  if (!demo) {
    const finalSave = readGameSave(Buffer.from((await call('exportGameSave', { sessionId: restored.sessionId, images: false })).base64, 'base64'))
    const clearFixture = await stageDirectorFixture(finalSave.chat, fixtureAssets)
    const clearRun = await runDirectorFixture(clearFixture, [{ figures: null, background: null, music: null }])
    assert.deepEqual(clearRun.receipts, [{ ok: true }])
    const owner = STAGE_DATA_OWNER
    finalSave.plugins.data.owners[owner].turns.push(...(await clearFixture.data.snapshot(finalSave.chat.id)).owners[owner].turns)
    const cleared = await call('importGameSave', { fileB64: buildGameSave({ ...finalSave, tavernVersion: finalSave.manifest.tavernVersion, exportedAt: Date.now() }).toString('base64') })
    const clearTitle = 'Explicit stage clear ' + Date.now()
    await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true } } })
    await call('renameConversation', { sessionId: cleared.sessionId, title: clearTitle })
    await page.reload()
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await page.getByText(clearTitle, { exact: true }).first().click()
    await open(); await stage.waitFor()
    await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'Quiet interval 5.' }).waitFor()
    const clearedState = await call('castStage', { sessionId: cleared.sessionId, count: 1 })
    assert.deepEqual(clearedState.stage, { figures: [], background: null, music: null })
    assert.equal(await stage.locator('.dsh-tavern-stage-figure').count(), 0)
    assert.equal(await stage.locator('.dsh-tavern-stage-backdrop.is-scene').count(), 0)
    assert.equal(clearedState.music, null)
    assert.equal(await stage.getByRole('button', { name: /关闭音乐|打开音乐/ }).count(), 0)
    result.explicitClear = true
    await page.screenshot({ path: join(output, 'stage-explicit-clear.png') })
  }
  await writeFile(join(output, 'stage-state.json'), JSON.stringify(result, null, 2))
  return result
}

// Run only against a disposable browser/profile that you started for this test.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const endpoint = process.env.TAVERN_STAGE_TEST_CDP
  const directory = process.argv[process.argv.indexOf('--artifacts') + 1]
  if (!process.argv.includes('--isolated') || !endpoint || !process.argv.includes('--artifacts') || !directory) {
    throw Error('Requires --isolated --artifacts DIR and TAVERN_STAGE_TEST_CDP for an owned disposable browser; never use a personal profile')
  }
  const { chromium } = await import('playwright')
  await mkdir(directory, { recursive: true })
  const browser = await chromium.connectOverCDP(endpoint)
  try {
    const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
    assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
    pages[0].setDefaultTimeout(20000)
    try {
      const result = await stageStateChecks({ page: pages[0], output: directory, demo: process.argv.includes('--demo') })
      console.log(JSON.stringify({ carriesTurn: result.carriesTurn, carriesReload: result.carriesReload, backgroundPreserved: result.backgroundPreserved, fullscreen: result.fullscreen, explicitClear: result.explicitClear }))
    } catch (error) {
      await writeFile(join(directory, 'failure.txt'), error.message + '\n' + await pages[0].locator('body').innerText())
      await pages[0].screenshot({ path: join(directory, 'failure.png') })
      throw error
    }
  } finally { await browser.close() }
}
