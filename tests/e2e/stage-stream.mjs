import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createPluginData } from '../../tavern-plugin/lib/domain/plugin-data.js'
import { readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { stageNext, stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP, modulePath = process.env.TAVERN_E2E_LLM_MODULE, dataRoot = process.env.TAVERN_STAGE_TEST_DATA
const output = process.argv[process.argv.indexOf('--artifacts') + 1], baseline = process.argv.includes('--baseline')
if (!process.argv.includes('--isolated') || !dataRoot || !modulePath || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned hidden muted fresh-profile slot, isolated flag, runtime LLM module and artifacts directory')
await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
const page = browser.contexts().flatMap(context => context.pages()).find(page => /^(https?:|dsh-app:)/.test(page.url()))
page.setDefaultTimeout(20000)
await page.addInitScript(() => {
  window.stageStreamPlays = []
  const animate = Element.prototype.animate
  Element.prototype.animate = function (frames, options) {
    const result = animate.call(this, frames, options)
    if (options?.id?.startsWith('stage:')) window.stageStreamPlays.push(options.id)
    return result
  }
})
async function until(check) { const end = Date.now() + 40000; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 150)) } throw Error('Scenario condition timed out') }
const rpc = (method, args = {}) => page.evaluate(async ([method, args]) => {
  const value = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
  if (value.ok === false) throw Error(method + ': ' + JSON.stringify(value))
  return value
}, [method, args])
const control = async (action, value) => (await rpc('callPluginHandler', { name: 'stage-stream-fixture/control', args: { action, value } })).result
try {
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const source = (await readFile(new URL('./stage-stream-model.mjs', import.meta.url), 'utf8')).replace("'@deepseek-ai/dsh-llm'", JSON.stringify(pathToFileURL(modulePath).href))
  const zip = writeZipEntries([{ path: 'package.json', content: JSON.stringify({ name: 'stage-stream-fixture', type: 'module', main: 'index.mjs' }) }, { path: 'index.mjs', content: source }])
  const upload = await page.evaluate(async base64 => (await fetch('/api/dsh-tavern/card-upload', { method: 'POST', body: Uint8Array.from(atob(base64), c => c.charCodeAt(0)), headers: { 'content-type': 'application/octet-stream' } })).json(), zip.toString('base64'))
  await rpc('installUserPluginUpload', { uploadId: upload.uploadId, name: 'stage-stream-fixture.zip' })
  await until(() => control().catch(() => null))
  const model = { provider: 'stage-stream-fixture', model: 'fixed' }
  await rpc('updateTavernSettings', { patch: { defaultForegroundModel: model, defaultBackgroundModel: model } })
  await stageStateChecks({ page, output, async inspect({ stage, call, sessionId }) {
    // The model picker lives in the chat composer, below the fullscreen stage.
    await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' })
    const selector = page.getByRole('button', { name: /Select model/ })
    if (!(await selector.innerText()).includes('Synthetic stage stream')) {
      await selector.click()
      const item = page.getByRole('menuitemradio', { name: 'Synthetic stage stream', exact: true })
      await until(async () => await item.isVisible() || (await selector.innerText()).includes('Synthetic stage stream'))
      if (await item.isVisible()) await item.click()
    }
    await until(async () => (await selector.innerText()).includes('Synthetic stage stream'))
    assert.match(await selector.innerText(), /Synthetic stage stream/)
    await call('setConversationBackgroundModel', { sessionId, backgroundModel: model, backgroundTasks: { variables: false, posture: false, characterDesign: false, ledger: false, styleReference: false }, webSearchEnabled: false })
    await page.getByRole('button', { name: '舞台', exact: true }).click(); await stage.waitFor()
    const initial = readGameSave(Buffer.from((await call('exportGameSave', { sessionId, images: false })).base64, 'base64'))
    const store = createChatJournalStore({ dataRoot }), data = createPluginData({ store: { readJson: async path => JSON.parse(await readFile(join(dataRoot, path), 'utf8')) } })
    const saved = async () => ({ chat: await store.read(initial.chat.id), plugins: { data: await data.snapshot(initial.chat.id) } })
    const records = save => save.plugins.data.owners['dsh-tavern.stage'].turns
    const view = () => call('castStage', { sessionId, count: 1 })
    const send = async marker => { await stage.getByRole('button', { name: '跳过', exact: true }).click(); await stage.getByRole('menuitem', { name: '自由输入', exact: true }).click(); await stage.getByRole('textbox', { name: '自由输入下一步' }).fill(marker); await stage.getByRole('menuitem', { name: '发送', exact: true }).click() }
    await control('arm', 'normal')
    await send('C07B_FLOW')
    await until(async () => (await control()).foreground === 1)
    if (!baseline) await until(async () => (await view()).turns.at(-1).performances.length === 1 && (await view()).turns.at(-1).pages.length === 5)
    const first = await view(), beforeSubmit = await saved(), firstAudit = await control()
    assert.equal(firstAudit.requests.length, baseline ? 0 : 1)
    assert.equal(beforeSubmit.chat.messages.some(row => String(row.text).includes('First sealed page.')), false)
    assert.equal(records(beforeSubmit).length, 1, 'first window must not become a durable record')
    if (!baseline) assert.equal(first.turns.at(-1).pages[0].text, 'First sealed page.')
    if (!baseline) await page.waitForFunction(() => window.stageStreamPlays.length === 1)
    await page.screenshot({ path: join(output, 'stream-first-window.png') })
    if (!baseline) await stageNext(stage)
    await control('body')
    const finalSave = await until(async () => {
      const save = await saved(), done = Object.values(save.chat.timeline.operations).some(op => op.userText === 'C07B_FLOW' && op.status === 'completed')
      return done && (baseline ? (await control()).warnings.some(text => text.includes('unknown global tool "stage_update"')) : records(save).length === 2) && save
    })
    const final = await view(), audit = await control()
    assert.deepEqual(final.turns.at(-1).performances.map(event => event.at), baseline ? [] : [1, 6])
    if (!baseline) {
      assert.equal(final.turns.at(-1).key, first.turns.at(-1).key)
      assert.deepEqual(final.turns.at(-1).pages.slice(0, 5).map(page => page.text), first.turns.at(-1).pages.map(page => page.text))
      assert.equal(new Set(audit.requests.map(request => request.sessionId)).size, 1, 'both windows and tool repair share one director session')
      assert.match(JSON.stringify(audit.receipts), /已封口/)
      assert.deepEqual(audit.requests[0].reference, audit.requests[1].reference)
    }
    assert.equal(final.stage.music, 'theme', 'the rejected prefix rewrite must not stop music')
    if (!baseline) {
      await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'Second page.' }).waitFor()
      assert.equal(await page.evaluate(() => window.stageStreamPlays.length), 1, 'finalization preserves the page visit')
    }
    await page.screenshot({ path: join(output, 'sealed-prefix.png') })
    if (!baseline) {
      for (let index = 0; index < 4; index++) await stageNext(stage)
      await stage.getByRole('button', { name: '跳过', exact: true }).click()
      await page.waitForTimeout(1500)
      assert.equal(await page.evaluate(() => window.stageStreamPlays.length), 1, 'skip consumes the second-window effect')
      await stage.getByRole('button', { name: '上一句', exact: true }).click()
      await page.waitForFunction(() => window.stageStreamPlays.length === 2)
    }
    const plays = await page.evaluate(() => window.stageStreamPlays)
    await page.reload(); await page.getByRole('button', { name: '舞台', exact: true }).click(); await stage.waitFor()
    await page.waitForTimeout(1500)
    assert.equal(await page.evaluate(() => window.stageStreamPlays.length), 0, 'refresh never replays')
    const refreshed = await view()
    assert.deepEqual(refreshed, final)
    assert.deepEqual(records(await saved()), records(finalSave))
    await page.screenshot({ path: join(output, 'stream-refresh.png') })
    await control('arm', 'late')
    await send('C07B_CANCEL')
    await until(async () => (await control()).foreground === 2)
    if (!baseline) await until(async () => (await control()).requests.some(item => item.mode === 'late'))
    await page.keyboard.press('Escape')
    await page.locator('button[aria-label*="Stop" i], button[aria-label*="停止"], button[aria-label*="Interrupt" i], button[aria-label*="中断"]').filter({ visible: true }).last().click()
    await control('late')
    if (!baseline) await until(async () => (await control()).late === 1)
    await until(async () => !(await view()).turns.at(-1).key.startsWith('stage-stream:') || (await view()).turns.at(-1).key === final.turns.at(-1).key)
    assert.deepEqual(records(await saved()), records(finalSave), 'cancelled late output cannot overwrite the committed record')
    assert.deepEqual((await view()).stage, final.stage)
    await page.getByRole('button', { name: '舞台', exact: true }).click()
    await page.screenshot({ path: join(output, 'cancelled-late-result.png') })
    const evidence = { baseline, plays, first, beforeSubmitRecords: records(beforeSubmit), final, refreshed, audit, afterCancel: await control(), cancelledRecords: records(await saved()) }
    await writeFile(join(output, 'stream.json'), JSON.stringify(evidence, null, 2))
    return evidence
  } })
} catch (error) {
  await writeFile(join(output, 'failure-audit.json'), JSON.stringify(await control().catch(() => ({})), null, 2))
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
  await page.screenshot({ path: join(output, 'failure.png') })
  throw error
} finally { await browser.close() }
