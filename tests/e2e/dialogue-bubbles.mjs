// 对白格式 (cast-presentation.md 30/N): a reply the story model wrote with dialogue bubbles, over the real host. With
// 对话气泡 on, each bubble is its speaker's row in the chat (name, emotion label, the line; a thought in brackets) and its
// speaker's page on the stage; a line that does not parse and the raw markup never show. With 对话气泡 off the same
// reply reads as name：“line”. Fresh disposable profile only, no model calls.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

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
  console.log(JSON.stringify(result))
} finally {
  await browser.close().catch(() => {})
}
