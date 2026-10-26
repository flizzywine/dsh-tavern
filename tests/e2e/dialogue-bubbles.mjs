// 对白格式 (cast-presentation.md 30/N): a reply the story model wrote with dialogue bubbles, over the real host. With
// 对话气泡 on, each bubble is its speaker's row in the chat (name, emotion label, the line; a thought in brackets) and its
// speaker's page on the stage; a line that does not parse and the raw markup never show. With 对话气泡 off the same
// reply reads as name：“line”. 32/N: a reply still streaming shows each bubble as its speaker's row as soon as its text
// starts, never an unfinished line's markup, and nothing above moves when it finishes. Fresh disposable profile only;
// the streaming reply comes from an uploaded fixture model, no paid model calls.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP, modulePath = process.env.TAVERN_E2E_LLM_MODULE
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || !modulePath || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, the runtime LLM module, --isolated and --artifacts DIR; never use a live browser')

const reply = [
  '店主擦着杯子，抬头看见了你。',
  '@bubble:shopkeeper|店主|开心|[欢迎回来，这是你的奖励。]',
  '*@bubble:lin_yue|林月|紧张|[*他还记得我吗？*]*',
  '@bubble:passer_by|路人｜惊讶｜你也来了？',
  '@bubble:broken',
  '门外传来脚步声。'
].join('\n')

await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
    const result = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
    if (result.ok === false) throw Error(method + ': ' + JSON.stringify(result))
    return result
  }, [method, args])

  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const run = Date.now(), name = 'Bubbles ' + run % 100000
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: '酒馆的门开着。', extensions: {} } }
  const imported = (await call('importCard', { payload: { kind: 'charx', name: 'bubbles-' + run + '.charx', fileB64: writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }]).toString('base64') } })).card
  await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true } } })
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: '酒馆的门开着。' },
    { name: 'Reader', is_user: true, mes: '领取任务奖励' }, { name, is_user: false, mes: reply }].map(JSON.stringify).join('\n')
  const game = await call('importChatHistoryText', { cardPath: imported.path, text: history, fileName: 'bubbles.jsonl' })
  const sessionId = game.sessionId, title = 'Bubble verification ' + run
  await call('renameConversation', { sessionId, title })
  await call('castSetCharacter', { sessionId, name: '林月' })
  const result = {}

  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  const chatUrl = page.url()
  const assistant = page.locator('[data-chat-flow-kind="assistant-step"]').filter({ visible: true }).last()

  // 1. 对话气泡 on: one speaker row per bubble, narration around them, no markup anywhere.
  const rows = page.locator('.dsh-tavern-cast-line').filter({ visible: true })
  await rows.nth(2).waitFor()
  result.rows = await rows.evaluateAll(items => items.map(item => [item.querySelector('.dsh-tavern-cast-name')?.textContent,
    item.querySelector('.dsh-tavern-cast-emotion')?.textContent || '', item.querySelector('.dsh-tavern-cast-avatar')?.textContent || 'img',
    item.querySelector('.dsh-tavern-cast-body > :last-child')?.textContent.trim()]))
  assert.deepEqual(result.rows, [['店主', '开心', '店', '欢迎回来，这是你的奖励。'], ['林月', '紧张', '林', '（他还记得我吗？）'], ['路人', '惊讶', '路', '你也来了？']])
  result.text = await assistant.innerText()
  assert.ok(result.text.includes('店主擦着杯子，抬头看见了你。') && result.text.includes('门外传来脚步声。'), result.text)
  assert.ok(!/@bubble|shopkeeper|\|/.test(result.text), 'no raw markup: ' + result.text)
  assert.deepEqual((await call('castForTurns', { sessionId, turns: [2] })).turns[2].map(line => [line.speaker, line.emotion, line.quote]),
    [['店主', 'joy', '欢迎回来，这是你的奖励。'], ['林月', 'nervousness', '他还记得我吗？'], ['路人', 'surprise', '你也来了？']], 'the lines come from the text, no settlement')
  await page.screenshot({ path: join(output, 'bubbles-chat-1920.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  await rows.first().scrollIntoViewIfNeeded()
  result.narrow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  assert.ok(result.narrow, 'no horizontal overflow at 375')
  await page.screenshot({ path: join(output, 'bubbles-chat-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })

  // 2. The stage: a bubble is its speaker's page, a thought keeps its brackets; the broken line is not a page.
  const stage = page.locator('.dsh-tavern-stage-overlay')
  await page.getByRole('button', { name: '舞台', exact: true }).click()
  await stage.waitFor()
  await stage.locator('.dsh-tavern-stage-progress').filter({ hasText: /\/ 5$/ }).waitFor()
  result.stage = []
  for (let index = 0; index < 5; index++) {
    if (index) await page.keyboard.press('ArrowRight')
    await stage.locator('.dsh-tavern-stage-progress').filter({ hasText: new RegExp('^' + (index + 1) + ' / 5$') }).waitFor()
    await stage.locator('.dsh-tavern-stage-type[data-typed]').waitFor()
    const box = stage.locator('.dsh-tavern-stage-textbox').first(), nameplate = box.locator('.dsh-tavern-stage-name')
    result.stage.push([await nameplate.count() ? (await nameplate.textContent()).trim() : '', (await box.locator('.dsh-tavern-stage-text').textContent()).trim()])
    if (index === 2) await page.screenshot({ path: join(output, 'bubbles-stage-1920.png') })
  }
  assert.deepEqual(result.stage.map(([speaker]) => speaker), ['', '店主开心', '林月紧张', '路人惊讶', ''])
  assert.ok(result.stage[2][1].includes('（他还记得我吗？）') && !result.stage.some(([, text]) => /@bubble/.test(text)), JSON.stringify(result.stage))
  await page.keyboard.press('Escape')
  await stage.waitFor({ state: 'detached' })

  // 3. 对话气泡 off: the same reply reads as name：“line”, still without markup.
  await call('updateTavernSettings', { patch: { castPresentation: false } })
  await page.goto(chatUrl)
  await page.getByText('店主：“欢迎回来，这是你的奖励。”', { exact: false }).filter({ visible: true }).first().waitFor()
  result.off = await assistant.innerText()
  assert.equal(await page.locator('.dsh-tavern-cast-line').filter({ visible: true }).count(), 0)
  assert.ok(result.off.includes('林月：（他还记得我吗？）') && !/@bubble/.test(result.off), result.off)
  await page.screenshot({ path: join(output, 'bubbles-off-1920.png') })

  // 4. Streaming (32/N): a fixture model writes the reply in three held pieces.
  result.stream = await streamingChecks({ page, call, sessionId, chatUrl, run })
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages()).find(page => /^(https?:|dsh-app:)/.test(page.url()))
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText().catch(() => '')).catch(() => {})
  }
  throw error
} finally {
  await browser.close().catch(() => {})
}

async function until(check, label) { const end = Date.now() + 40000; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)) } throw Error('Timed out: ' + label) }

async function streamingChecks({ page, call, sessionId, chatUrl, run }) {
  // A plugin replaced in place loads only after a restart, so each run brings its own and removes it afterwards.
  const fixture = 'bubble-stream-' + run, modelName = 'Bubble stream ' + run
  const pieces = ['店主擦着杯子，抬头看见了你。\n@bubble:shopkeeper|店主|开心|[欢迎回来，', '这是你的奖励。]\n她把钱袋推过柜台。\n@bubble:lin_yue|林月|紧张|',
    '[*他还记得我吗？*]\n门外传来脚步声。']
  // Only the model output is substituted; the reply, its commit and the chat are real. `release` lets the next piece out.
  const source = `import { LlmAdapter } from ${JSON.stringify(pathToFileURL(modulePath).href)}
export const name = ${JSON.stringify(fixture)}, inject = ['llm', 'tavern']
export function apply(ctx) {
  const pieces = ${JSON.stringify(pieces)}, sent = [], gates = []
  let released = 0
  ctx.tavern.handle(${JSON.stringify(fixture + '/control')}, ({ action } = {}) => { if (action === 'release') { released++; gates.splice(0).forEach(open => open()) } return { sent, released } })
  const wait = (count, signal) => new Promise(resolve => { const check = () => released >= count || signal?.aborted ? resolve() : gates.push(check); check() })
  class Model extends LlmAdapter {
    async listModels(provider) { return [await this.resolveModel(provider, 'fixed')] }
    async resolveModel(provider, id) { return { provider, id, name: ${JSON.stringify(modelName)}, context: { contextWindow: 64000 } } }
    async *stream(input) {
      const tools = (input.tools || []).map(tool => tool.name)
      if (!tools.includes('candidate_submit_choices') && JSON.stringify(input.messages).includes('BUBBLE_STREAM') && !sent.length) {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        for (const [index, piece] of pieces.entries()) {
          if (index) await wait(index, input.signal)
          sent.push(Date.now())
          yield { type: 'text-delta', index: 0, text: piece }
        }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: pieces.join('') } }
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
  const { plugin } = await call('installUserPluginUpload', { uploadId: upload.uploadId, name: fixture + '.zip' })
  try { return await streamed() } finally { await call('removeUserPlugin', { folder: plugin.folder }) }
  async function streamed() {
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
    // With several model rows the picker opens Model › first.
    const more = page.getByRole('menuitem', { name: /^Model/ })
    await until(async () => await item.isVisible() || await more.isVisible(), 'model menu')
    if (!await item.isVisible()) await more.click()
    await until(async () => await item.isVisible() || (await selector.innerText()).includes(modelName), 'model list')
    if (await item.isVisible()) await item.click()
  }
  await until(async () => (await selector.innerText()).includes(modelName), 'fixture model selected')
  // The chat column alone, so the narrow screenshot shows it.
  const side = page.getByRole('button', { name: 'Collapse right sidebar', exact: true })
  if (await side.isVisible()) await side.click()
  const rows = page.locator('.dsh-tavern-cast-line').filter({ visible: true })
  await rows.nth(2).waitFor()
  const before = await rows.count()
  const floor = page.locator('[data-chat-flow-kind="assistant-step"]').filter({ visible: true }).last()
  const box = page.getByRole('textbox', { name: /发消息|Message/ })
  await box.fill('BUBBLE_STREAM')
  // Sample the row count every 50 ms from just before Enter, as the reference measurement did.
  await page.evaluate(count => {
    window.bubbleStream = { sent: Date.now(), first: 0 }
    const timer = setInterval(() => {
      const shown = [...document.querySelectorAll('.dsh-tavern-cast-line')].filter(row => row.checkVisibility()).length
      if (shown > count) { window.bubbleStream.first = Date.now(); clearInterval(timer) }
    }, 50)
  }, before)
  await box.press('Enter')
  const sample = async () => {
    const streaming = page.locator('.dsh-tavern-assistant[data-streaming]').filter({ visible: true }).last()
    return { streaming: await streaming.count() > 0, text: await floor.innerText(), rows: (await rows.evaluateAll(items => items.map(item => [item.querySelector('.dsh-tavern-cast-name')?.textContent,
      item.querySelector('.dsh-tavern-cast-emotion')?.textContent || '', item.querySelector('.dsh-tavern-cast-body > :last-child')?.textContent.trim(), Boolean(item.querySelector('.dsh-tavern-speak'))]))).slice(before) }
  }
  const noMarkup = text => assert.ok(!/@|shopkeeper|lin_yue|\|/.test(text), 'no raw markup while streaming: ' + text)
  const stream = {}

  // a. First piece: narration, then the first words of the shopkeeper's line, already its row.
  await rows.nth(before).waitFor()
  stream.first = await sample()
  const timing = await page.evaluate(() => window.bubbleStream), sent = (await control()).sent
  stream.firstRowMs = timing.first - timing.sent
  stream.firstRowAfterPieceMs = timing.first - sent[0]
  assert.equal(sent.length, 1, 'the model is still holding the rest of the reply')
  assert.ok(stream.first.streaming, 'the reply is still streaming')
  assert.deepEqual(stream.first.rows, [['店主', '开心', '欢迎回来，', false]])
  assert.ok(stream.first.text.includes('店主擦着杯子，抬头看见了你。'))
  noMarkup(stream.first.text)
  await page.screenshot({ path: join(output, 'stream-first-row-1920.png') })

  // b. Second piece: the line closes; the next bubble's head has arrived without its text, so nothing of it shows.
  await control('release')
  await floor.getByText('她把钱袋推过柜台。').waitFor()
  stream.second = await sample()
  assert.ok(stream.second.streaming)
  assert.deepEqual(stream.second.rows, [['店主', '开心', '欢迎回来，这是你的奖励。', false]])
  assert.ok(!stream.second.text.includes('林月'), 'an unfinished head is held: ' + stream.second.text)
  noMarkup(stream.second.text)
  const place = () => floor.evaluate(node => {
    const top = node.getBoundingClientRect().top
    return [...node.querySelectorAll('.dsh-tavern-cast-line, .dsh-tavern-colored-markdown')].filter(item => !item.closest('.dsh-tavern-cast-line') || item.matches('.dsh-tavern-cast-line'))
      .map(item => [item.className.includes('cast-line') ? 'row' : 'text', Math.round(item.getBoundingClientRect().top - top), Math.round(item.getBoundingClientRect().height), item.textContent.slice(0, 12)])
  })
  stream.placeStreaming = await place()
  await page.setViewportSize({ width: 375, height: 812 })
  await floor.locator('.dsh-tavern-cast-line').first().scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow at 375 while streaming')
  await page.screenshot({ path: join(output, 'stream-held-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })

  // c. Last piece: the thought is its row; when the reply is committed nothing above it moves.
  await control('release')
  await until(async () => (await page.locator('.dsh-tavern-assistant[data-streaming]').count()) === 0, 'reply committed')
  await until(async () => ((await call('castForTurns', { sessionId, turns: [3] })).turns[3] || []).length === 2, 'the turn\'s lines')
  await page.waitForTimeout(800)
  stream.final = await sample()
  assert.deepEqual(stream.final.rows.map(row => row.slice(0, 3)), [['店主', '开心', '欢迎回来，这是你的奖励。'], ['林月', '紧张', '（他还记得我吗？）']])
  noMarkup(stream.final.text)
  stream.placeFinal = await place()
  assert.deepEqual(stream.placeFinal.slice(0, stream.placeStreaming.length), stream.placeStreaming, 'the committed reply keeps the streamed layout')
  await page.screenshot({ path: join(output, 'stream-final-1920.png') })
  return stream
  }
}
