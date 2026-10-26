// 回合末选项 (cast-presentation.md 34/N) on the real stage against a real host: the round's last card ends on the menu. Without
// candidates it offers 生成选项; the click runs the chat's candidate task (the wait takes the text box), a failure offers 重试,
// the candidates come in as ribbons with 自由输入 last. ✎ opens a ribbon in place and Esc reverts it; a choice picked from the
// keyboard is sent as the next input (the reply's wait in the box), 自由输入 sends what was typed. A synthetic skin's art.choices
// draws the bars (the box steps aside) and its transitions.choices moves them; 1920 and 375. Only model output is substituted
// (an uploaded fixture plugin); turns, candidate tasks and storage are real. Fresh disposable profile only, no paid calls.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP, modulePath = process.env.TAVERN_E2E_LLM_MODULE
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !process.argv.includes('--artifacts') || !modulePath || !endpoint || new URL(endpoint).port === '9333') throw Error('Requires an owned hidden muted fresh-profile slot, runtime LLM module and artifacts directory')
await mkdir(output, { recursive: true })
// An RGBA PNG drawn by paint(x, y) -> [r, g, b, a].
function png(width, height, paint) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header.set([8, 6], 8)
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set(paint(x, y), y * (width * 4 + 1) + 1 + x * 4)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
const edge = (x, y, w, h, d) => x < d || y < d || x >= w - d || y >= h - d
// An original skin: a dark lantern box, the menu as amber-rimmed bars (a lit bar under focus), centred on the stage.
const images = {
  'art/box.png': png(1800, 300, (x, y) => y < 40 ? [0, 0, 0, 0] : edge(x, y - 40, 1800, 260, 4) ? [214, 160, 74, 255] : [22, 18, 30, 236]),
  'art/bar.png': png(900, 80, (x, y) => edge(x, y, 900, 80, 3) ? [214, 160, 74, 255] : x < 60 || x >= 840 ? [60, 44, 26, 255] : [30, 24, 38, 245]),
  'art/bar-off.png': png(900, 80, (x, y) => edge(x, y, 900, 80, 3) ? [110, 104, 116, 255] : [40, 38, 44, 230]),
  'art/bar-on.png': png(900, 80, (x, y) => edge(x, y, 900, 80, 3) ? [255, 226, 160, 255] : [238, 196, 112, 255])
}
const lantern = { schema: 'dsh.skin/1', id: 'lantern-bars', label: '灯·条', font: {}, textFx: { reveal: 'type' },
  textbox: { paint: { bg: '#16121e', fg: '#f6ead2', fgMuted: '#c9bca4', accent: '#f0c070', onAccent: '#16121e', border: '#d6a04a' }, shape: { radius: 4 } },
  nameplate: { shape: 'plain', paint: { bg: '#16121e', fg: '#f6ead2' } },
  waitLines: ['灯芯正在点亮', '纸页正在翻动'],
  art: { screen: 1080, screenWidth: 1920, textbox: { images: { plain: 'art/box.png' }, body: [0, 40, 1800, 260], bottom: 20, text: [80, 1720, 170], font: 40, lines: 3 },
    choices: { images: { plain: 'art/bar.png', off: 'art/bar-off.png' }, slice: [16, 60, 16, 60], text: [70, 830, 40], font: 30, pitch: 42, gap: 14, anchor: 'stage',
      ink: '#f6ead2', tilt: [-1.5, 1.5], focus: { image: 'art/bar-on.png', ink: '#1a1208' } } } }
// The same bars, coming in by the skin's own entrance (a fade from the left, staggered).
const lanternMoves = { ...lantern, id: 'lantern-moves', label: '灯·动', transitions: { choices: { enter: { ms: 300, stagger: 60, pose: { dx: -12 }, fade: true }, leave: { ms: 200, fade: true } } } }

const browser = await chromium.connectOverCDP(endpoint)
const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
const page = pages[0]
page.setDefaultTimeout(20000)
async function until(check, label, ms = 40000) { const end = Date.now() + ms; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 150)) } throw Error('Timed out: ' + label) }
const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
  const value = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
  if (value.ok === false) throw Error(method + ': ' + JSON.stringify(value))
  return value
}, [method, args])
const upload = bytes => page.evaluate(async base64 => (await (await fetch('/api/dsh-tavern/card-upload', { method: 'POST', body: Uint8Array.from(atob(base64), c => c.charCodeAt(0)), headers: { 'content-type': 'application/octet-stream' } })).json()).uploadId, Buffer.from(bytes).toString('base64'))
const steps = [], result = { steps }
try {
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const run = Date.now() % 100000, fixture = 'stage-choices-fixture', modelName = 'Stage choices fixture'
  const cardName = 'Mira ' + run, title = 'Stage choices ' + run
  // Foreground replies name the input they answer (after a short pause, so the reply's wait shows). A candidate request submits
  // four actions and a scene after a pause, or fails while the mode says so.
  const source = `import { LlmAdapter } from ${JSON.stringify(pathToFileURL(modulePath).href)}
export const name = ${JSON.stringify(fixture)}, inject = ['llm', 'tavern']
export function apply(ctx) {
  const state = { mode: 'ok', candidates: 0, failures: 0, rounds: [] }
  ctx.tavern.handle(${JSON.stringify(fixture + '/state')}, args => { if (args && args.mode) state.mode = args.mode; return state })
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const text = message => (message?.content || []).map(block => block.text || '').join(' ')
  class Model extends LlmAdapter {
    async listModels(provider) { return [await this.resolveModel(provider, 'fixed')] }
    async resolveModel(provider, id) { return { provider, id, name: ${JSON.stringify(modelName)}, context: { contextWindow: 64000 } } }
    async *stream(input) {
      const names = (input.tools || []).map(tool => tool.name), all = JSON.stringify(input.messages)
      let block = { type: 'text', text: 'Done.' }
      if (names.includes('candidate_submit_choices')) {
        // Background tasks share one agent and its tools: a candidate request is told apart by its latest request text.
        const answered = (input.messages.at(-1)?.content || []).some(block => block.type === 'tool-result')
        const request = input.messages.slice(input.messages.findLastIndex(message => message.role !== 'user') + 1).map(text).join(' ')
        if (!answered && request.includes('生成候选项')) {
          await sleep(2500)
          if (state.mode === 'fail') { state.failures += 1; throw new Error('fixture: no candidates this time') }
          state.candidates += 1
          block = { type: 'tool-call', id: 'choices-' + state.candidates, name: 'candidate_submit_choices', arguments: JSON.stringify({ actions: ['Wave back', 'Ask about the map', 'Open the door', 'Check the lantern'], scene: 'Rain begins outside' }) }
        }
      } else {
        const marker = ['Ask about the map', 'FREE_WORDS_7'].map(text => [all.lastIndexOf(text), text]).sort((a, b) => b[0] - a[0])[0]
        if (marker[0] >= 0) { await sleep(1500); state.rounds.push(marker[1]); block = { type: 'text', text: 'Reply to ' + marker[1] + '.' } }
      }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter([${JSON.stringify(fixture)}], new Model())
}`
  const zip = writeZipEntries([{ path: 'package.json', content: JSON.stringify({ name: fixture, type: 'module', main: 'index.mjs' }) }, { path: 'index.mjs', content: source }])
  await call('installUserPluginUpload', { uploadId: await upload(zip), name: fixture + '.zip' })
  const fixtureState = async mode => (await call('callPluginHandler', { name: fixture + '/state', args: mode ? { mode } : {} })).result
  await until(() => fixtureState().catch(() => null), 'fixture plugin')
  const model = { provider: fixture, model: 'fixed' }
  await call('updateTavernSettings', { patch: { defaultForegroundModel: model, defaultBackgroundModel: model, castPresentation: true, stageToggles: { stage: true } } })
  const cardZip = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: cardName, description: 'Original synthetic fixture.', first_mes: 'The lamp is lit.', extensions: {} } }) }])
  const card = (await call('importCard', { payload: { kind: 'charx', name: 'stage-choices-' + run + '.charx', fileB64: cardZip.toString('base64') } })).card
  const text = [{ user_name: 'Reader', character_name: cardName }, { name: cardName, is_user: false, mes: 'The lamp is lit.' }, { name: 'Reader', is_user: true, mes: 'Begin.' },
    { name: cardName, is_user: false, mes: 'Rain taps the window.\nShe sets the lantern down by the map.' }].map(JSON.stringify).join('\n')
  const { sessionId } = await call('importChatHistoryText', { cardPath: card.path, text, fileName: 'stage-choices-' + run + '.jsonl' })
  await call('setConversationBackgroundModel', { sessionId, backgroundModel: model, backgroundTasks: { variables: false, posture: false, characterDesign: false, ledger: false, styleReference: false }, webSearchEnabled: false })
  await call('renameConversation', { sessionId, title })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: cardName })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  const selector = page.getByRole('button', { name: /Select model/ })
  if (!(await selector.innerText()).includes(modelName)) {
    await selector.click()
    const item = page.getByRole('menuitemradio', { name: modelName, exact: true })
    await until(async () => await item.isVisible() || (await selector.innerText()).includes(modelName), 'model menu')
    if (await item.isVisible()) await item.click()
  }
  await until(async () => (await selector.innerText()).includes(modelName), 'fixture model selected')

  const stage = page.locator('.dsh-tavern-stage-overlay'), menu = stage.locator('.dsh-tavern-stage-choices')
  const item = name => stage.getByRole('menuitem', { name, exact: true })
  await page.getByRole('button', { name: '舞台', exact: true }).click()
  await stage.waitFor()
  // The menu shows on the round's last card only.
  assert.equal(await menu.count(), 0, 'not before the last card')
  await until(async () => { if (await item('自由输入').count()) return true; await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200); return false }, 'the last card')
  const look = () => page.evaluate(() => {
    const root = document.querySelector('.dsh-tavern-stage-overlay'), list = root.querySelector('.dsh-tavern-stage-choices'), box = root.querySelector('.dsh-tavern-stage-textbox')
    const rect = node => { const r = node.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } }
    const rows = list ? [...list.querySelectorAll(':scope > .dsh-tavern-stage-choice')] : []
    return { state: list?.dataset.state || '', list: list ? rect(list) : null, box: rect(box), boxShown: getComputedStyle(box).visibility,
      rows: rows.map(row => ({ text: row.innerText.trim(), rect: rect(row), image: getComputedStyle(row).borderImageSource, animation: getComputedStyle(row).animationName })),
      wait: root.querySelector('.dsh-tavern-stage-wait')?.getAttribute('aria-label') || '', waitLine: root.querySelector('.dsh-tavern-stage-wait-line')?.textContent || '',
      pick: list ? getComputedStyle(list).getPropertyValue('--stage-choice-pick-ms').trim() : '', tx: root.dataset.fkTx || '', skin: root.dataset.fkSkin }
  })
  // 1. No candidates yet: 生成选项 over 自由输入, docked above the box.
  let seen = await look()
  assert.deepEqual(seen.rows.map(row => row.text), ['生成选项', '自由输入'])
  assert.ok(seen.list.bottom <= seen.box.top, 'the menu stands above the box: ' + JSON.stringify([seen.list, seen.box]))
  assert.ok(Math.abs((seen.list.left + seen.list.right) / 2 - 960) <= 1, 'centred on the stage')
  await page.screenshot({ path: join(output, 'off-1920.png') })
  steps.push('the last card offers 生成选项 and 自由输入 above the box')
  // 2. A failing task: the wait takes the box, then 选项生成失败 · 重试.
  await fixtureState('fail')
  await item('生成选项').click()
  await stage.locator('.dsh-tavern-stage-wait').waitFor()
  seen = await look()
  assert.equal(seen.wait, '正在生成选项')
  assert.ok(seen.waitLine.length > 0, 'a wait line shows')
  assert.equal(await item('自由输入').count(), 0, '自由输入 steps aside while the choices generate')
  await page.screenshot({ path: join(output, 'generating-1920.png') })
  await stage.getByText('选项生成失败', { exact: true }).waitFor({ timeout: 60000 })
  await page.screenshot({ path: join(output, 'failed-1920.png') })
  steps.push('generating shows the wait in the box; a failed task offers 重试')
  // 3. 重试 succeeds: four actions and the scene change (no tag), then 自由输入.
  await fixtureState('ok')
  await item('重试').click()
  await item('Ask about the map').waitFor({ timeout: 60000 })
  seen = await look()
  assert.deepEqual(seen.rows.map(row => row.text), ['Wave back', 'Ask about the map', 'Open the door', 'Check the lantern', 'Rain begins outside', '自由输入'])
  assert.ok(seen.list.bottom <= seen.box.top && seen.list.top >= 0, 'the list fits above the box')
  assert.equal(seen.pick, '0', 'the ribbons send at once')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(output, 'ready-1920.png') })
  // The same candidate panel as the chat's: the task the stage ran is the chat's candidate task.
  assert.equal((await call('syncSession', { sessionId, kind: 'candidate' })).sync.task.status, 'succeeded')
  steps.push('重试 brings the candidates in as ribbons, 自由输入 last')
  // 4. Phone: the ribbons span the stage, above the box.
  await page.setViewportSize({ width: 375, height: 812 }); await page.waitForTimeout(400)
  seen = await look()
  assert.ok(seen.list.left >= -1 && seen.list.right <= 376 && seen.list.bottom <= seen.box.top, 'phone: ' + JSON.stringify([seen.list, seen.box]))
  await page.screenshot({ path: join(output, 'ready-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.waitForTimeout(300)
  steps.push('375: the menu spans the stage above the box')
  // 5. ✎ opens the ribbon in place, its words in the field; Esc reverts it and hands the keyboard back.
  await stage.locator('.dsh-tavern-stage-choice[data-index="2"]').hover()
  await stage.locator('.dsh-tavern-stage-choice[data-index="2"] .dsh-tavern-stage-choice-edit').click()
  const edit = stage.getByRole('textbox', { name: '修改选项' })
  assert.equal(await edit.inputValue(), 'Open the door')
  await page.screenshot({ path: join(output, 'editing-1920.png') })
  await edit.press('Escape')
  await item('Open the door').waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Open the door', 'focus back on the ribbon')
  steps.push('✎ opens a field in place; Esc reverts it')
  // 6. A choice picked from the keyboard is the next input; the reply's wait takes the box until it arrives.
  await item('Ask about the map').focus()
  await page.keyboard.press('Enter')
  await stage.locator('.dsh-tavern-stage-wait[aria-label="正在生成下一轮"]').waitFor()
  await page.screenshot({ path: join(output, 'reply-wait-1920.png') })
  await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'Reply to Ask about the map.' }).waitFor({ timeout: 60000 })
  await item('生成选项').waitFor()
  steps.push('Enter on a choice sends it; the reply waits in the box, then the next round ends on the menu')
  // 7. 自由输入: the field in place, Enter sends what was typed.
  await item('自由输入').click()
  const free = stage.getByRole('textbox', { name: '自由输入下一步' })
  await free.fill('FREE_WORDS_7')
  await page.screenshot({ path: join(output, 'free-1920.png') })
  await free.press('Enter')
  await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'Reply to FREE_WORDS_7.' }).waitFor({ timeout: 60000 })
  result.fixture = await fixtureState()
  assert.deepEqual([...new Set(result.fixture.rounds)], ['Ask about the map', 'FREE_WORDS_7'])
  assert.equal(result.fixture.candidates, 1, 'one candidate request, from the click')
  steps.push('自由输入 sends what was typed')

  // 8. The skin's art.choices: the same menu as its bars, centred on the stage; the box steps aside.
  const { pack } = await call('createAssetPack', { name: '灯 ' + run })
  await call('setAssetPackState', { path: card.path, packId: pack.manifest.id, state: 'card' })
  const wear = async document => {
    const files = []
    for (const [path, bytes] of Object.entries(images)) files.push({ path, uploadId: await upload(bytes) })
    await call('addAssetPackSkin', { packId: pack.manifest.id, document: await upload(Buffer.from(JSON.stringify(document))), files })
    const revision = (await call('getAssetPack', { packId: pack.manifest.id })).pack.revision
    await call('setAssetPackStageSkin', { packId: pack.manifest.id, expectedRevision: revision, skin: document.id })
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
    await page.locator('.dsh-tavern-stage-overlay[data-fk-skin="' + document.id + '"][data-fk-skin-choices]').waitFor({ timeout: 30000 })
  }
  await fixtureState('ok')
  await wear(lantern)
  await item('生成选项').click()
  await until(async () => (await look()).waitLine === '灯芯正在点亮' || (await look()).waitLine === '纸页正在翻动', 'the skin\'s wait lines')
  await item('Ask about the map').waitFor({ timeout: 60000 })
  await page.mouse.move(4, 4)
  await page.waitForTimeout(500)
  seen = await look()
  assert.ok(seen.rows.slice(0, 5).every(row => /\/bar\.png/.test(row.image)), 'every suggestion is the skin\'s bar: ' + seen.rows.map(row => row.image.split('/').at(-1)))
  assert.equal(seen.boxShown, 'hidden', 'the box steps aside while the bars offer')
  assert.ok(Math.abs((seen.list.top + seen.list.bottom) / 2 - 540) <= 24, 'anchor stage: centred on the stage height: ' + JSON.stringify(seen.list))
  assert.equal(seen.pick, '233')
  assert.equal(seen.rows[0].animation, 'dsh-tavern-stage-art-choice-in-r')
  await page.screenshot({ path: join(output, 'art-1920.png') })
  await item('Wave back').hover(); await page.waitForTimeout(150)
  assert.ok((await look()).rows[0].image.includes('bar-on.png'), 'the focus bar under the pointer')
  await page.screenshot({ path: join(output, 'art-focus-1920.png') })
  await page.setViewportSize({ width: 375, height: 812 }); await page.waitForTimeout(400)
  seen = await look()
  assert.ok(seen.list.left >= -1 && seen.list.right <= 376 && seen.list.bottom <= seen.box.top, 'art on a phone: ' + JSON.stringify([seen.list, seen.box]))
  await page.screenshot({ path: join(output, 'art-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.waitForTimeout(300)
  steps.push('art.choices draws the bars centred on the stage, the box aside; the focus bar; 375')
  // 9. transitions.choices: the skin's own entrance (and its leave holds the pick).
  await wear(lanternMoves)
  await item('Ask about the map').waitFor()
  seen = await look()
  assert.equal(seen.tx, 'choices-enter choices-leave')
  assert.equal(seen.pick, '200')
  await page.screenshot({ path: join(output, 'art-moves-1920.png') })
  // (a menu shown again for the same reply comes in at once; the entrance itself plays on the next reply's menu)
  result.enterRule = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules] } catch (_) { return [] } }).some(rule => String(rule.selectorText || '').includes('[data-fk-tx~="choices-enter"]')))
  assert.ok(result.enterRule, 'the skin entrance rule is loaded')
  steps.push('transitions.choices: the stage carries the skin\'s entrance and pick time')
  await writeFile(join(output, 'stage-choices.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ok: true, steps }))
} catch (error) {
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + steps.join('\n') + '\n' + await page.locator('body').innerText().catch(() => ''))
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally { await browser.close() }
