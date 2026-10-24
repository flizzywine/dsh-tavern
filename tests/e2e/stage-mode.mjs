import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

// 舞台设置 › 舞台模式 › against a real host: 判断模型, 可用演出 and 每轮上限. Run only against an owned, hidden, muted fresh profile.
// Nothing here makes a sound or calls a model: the fullscreen stage is never opened, and 测试连接 reaches a local fake\n// Decisions endpoint only.
const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')
await mkdir(output, { recursive: true })

const browser = await chromium.connectOverCDP(endpoint)
const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
const page = pages[0]
page.setDefaultTimeout(20000)
const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
  const value = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
  if (value.ok === false) throw Error(method + ': ' + JSON.stringify(value))
  return value
}, [method, args])
const settingsOf = async () => (await call('getTavernSettings')).settings
const result = {}
try {
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  await page.setViewportSize({ width: 1920, height: 1080 })
  const name = 'Nora ' + Date.now() % 100000
  const cardZip = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {} } }) }])
  const card = (await call('importCard', { payload: { kind: 'charx', name: 'mode-nora.charx', fileB64: cardZip.toString('base64') } })).card
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' }].map(JSON.stringify).join('\n')
  const { sessionId } = await call('importChatHistoryText', { cardPath: card.path, text: history, fileName: 'mode-nora.jsonl' })
  await call('renameConversation', { sessionId, title: 'Stage mode verification' })
  await call('updateTavernSettings', { patch: { castPresentation: true } })
  assert.deepEqual([(await settingsOf()).stageDimensions, (await settingsOf()).stageActionCaps], [{ scene: true, cast: true, acts: true, screenEffects: true }, { beat: 6 }], 'fresh defaults')
  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText('Stage mode verification', { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()

  async function openSettings() {
    await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
    const others = page.locator('.dsh-tavern-start section[aria-label="其他"]').filter({ visible: true })
    await others.locator('.dsh-tavern-start-card').filter({ hasText: /^舞台设置$/ }).first().click()
  }
  await openSettings()
  const settings = page.locator('aside[aria-label="舞台设置"]')
  const jump = settings.getByRole('button', { name: '舞台模式设置', exact: true })
  await jump.click()
  const mode = page.locator('aside[aria-label="舞台模式"]')
  await mode.getByRole('heading', { name: '可用演出' }).waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.firstChild?.textContent), '舞台模式', 'the title takes the focus')
  assert.deepEqual(await mode.locator('h3').allInnerTexts(), ['判断模型', '可用演出', '每轮上限'])
  assert.equal((await settingsOf()).stageJudge.provider, 'unset', 'no judge by default')
  assert.equal(await mode.locator('.dsh-tavern-mode-meta').innerText(), '4 / 4')
  assert.deepEqual(await mode.locator('.dsh-tavern-mode-group-name').allInnerTexts(), ['场景与转场', '人物', '效果'])
  await page.screenshot({ path: join(output, 'mode-1920.png') })
  result.page = true

  // A group unfolds to its chips; a chip saves at once and the group reads 部分.
  const people = mode.locator('.dsh-tavern-mode-group-toggle').filter({ hasText: '人物' })
  await people.click()
  assert.equal(await people.getAttribute('aria-expanded'), 'true')
  const acts = mode.getByRole('checkbox', { name: '动作', exact: true })
  await acts.click()
  await page.waitForFunction(() => document.querySelector('aside[aria-label="舞台模式"] [role="checkbox"][aria-checked="false"]'))
  assert.deepEqual((await settingsOf()).stageDimensions, { scene: true, cast: true, acts: false, screenEffects: true })
  assert.equal(await people.locator('.dsh-tavern-mode-group-state').innerText(), '部分 1/2')
  assert.equal(await mode.locator('.dsh-tavern-mode-meta').innerText(), '3 / 4')
  await page.screenshot({ path: join(output, 'mode-commands-1920.png') })
  result.commands = true

  // 每轮上限 is a draft: a bad value shows its reason, Esc keeps a changed draft, 保存 writes it.
  const cap = mode.getByRole('textbox', { name: '画面效果 每轮上限', exact: true })
  const save = mode.getByRole('button', { name: '保存', exact: true })
  assert.equal(await save.isDisabled(), true)
  await cap.fill('0')
  await cap.press('Tab')
  await mode.getByText('请填写 1–256 的整数').waitFor()
  await cap.fill('3')
  await mode.getByText('有未保存的修改').waitFor()
  assert.equal(await save.isDisabled(), false)
  await page.screenshot({ path: join(output, 'mode-draft-1920.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  assert.equal(await mode.count(), 1, 'Esc does not drop an unsaved draft')
  await save.click()
  await page.waitForFunction(() => !document.querySelector('aside[aria-label="舞台模式"] .dsh-tavern-mode-foot[data-dirty]'))
  assert.deepEqual((await settingsOf()).stageActionCaps, { beat: 3 })
  result.caps = true

  // 判断模型: OpenAI 兼容 needs its URL before 保存; the API Key saves at once into the host credential store and never
  // comes back; 测试连接 sends it to the saved endpoint.
  const seen = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      seen.push({ path: request.url, key: request.headers.authorization === 'Bearer fake-e2e-judge-key', model: JSON.parse(body || '{}').model })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ answers: [{ type: 'predicate', name: 'test', probability: 0.9 }] }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1'
  try {
    await mode.getByRole('button', { name: /^提供方：/ }).click()
    await page.getByRole('menuitemradio', { name: 'OpenAI 兼容', exact: true }).click()
    await mode.locator('.dsh-tavern-mode-save-state').getByText('请填写接口地址').waitFor()
    assert.equal(await save.isDisabled(), true, 'a draft problem blocks 保存')
    assert.equal(await mode.getByRole('textbox', { name: '模型', exact: true }).inputValue(), 'gpt-6-luna', 'the provider fills its model')
    await mode.getByRole('textbox', { name: '接口地址', exact: true }).fill(baseUrl)
    await mode.getByRole('textbox', { name: '模型', exact: true }).fill('fake-judge')
    await mode.getByText('有未保存的修改').waitFor()
    await page.screenshot({ path: join(output, 'judge-draft-1920.png') })
    await save.click()
    await page.waitForFunction(() => !document.querySelector('aside[aria-label="舞台模式"] .dsh-tavern-mode-foot[data-dirty]'))
    const saved = (await settingsOf()).stageJudge
    assert.deepEqual([saved.provider, saved.baseUrl, saved.model, saved.keyName, saved.enabled], ['openai-compatible', baseUrl, 'fake-judge', 'OPENAI_API_KEY', true])
    // A machine variable of that name would show as 「已配置 · 环境变量」: replace it with a pasted key.
    const change = mode.getByRole('button', { name: '更换', exact: true })
    if (await change.isVisible().catch(() => false)) await change.click()
    const key = mode.locator('#dsh-tavern-judge-key')
    await key.fill('fake-e2e-judge-key')
    await key.press('Enter')
    await mode.locator('.dsh-tavern-mode-key').getByText('已配置', { exact: true }).waitFor()
    assert.ok(!JSON.stringify(await call('getTavernSettings')).includes('fake-e2e-judge-key'), 'the key is not a setting and never comes back')
    await mode.getByRole('button', { name: '测试连接', exact: true }).click()
    await mode.getByText(/连接成功 · \d+ 毫秒/).waitFor()
    assert.deepEqual(seen, [{ path: '/v1/decisions', key: true, model: 'fake-judge' }])
    await page.screenshot({ path: join(output, 'judge-1920.png') })
    await mode.getByRole('button', { name: '清除', exact: true }).click()
    await key.waitFor()
    await mode.locator('.dsh-tavern-mode').focus()
    result.judge = true
  } finally { server.close() }

  // Saved: the focus stays on the page, Esc now leaves and the focus comes back to 「舞台模式 ›」.
  await page.keyboard.press('Escape')
  await jump.waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '舞台模式设置')
  result.escBack = true

  // Narrow: one column, the chips under their group. The values survive a reload.
  await page.setViewportSize({ width: 375, height: 812 })
  await page.reload()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  // The sidebar comes back with 舞台设置 open.
  await page.waitForTimeout(1000)
  if (!await settings.isVisible()) await openSettings()
  await settings.getByRole('button', { name: '舞台模式设置', exact: true }).click()
  await mode.getByRole('heading', { name: '可用演出' }).waitFor()
  await mode.locator('.dsh-tavern-mode-group-toggle').filter({ hasText: '人物' }).click()
  assert.equal(await mode.getByRole('checkbox', { name: '动作', exact: true }).getAttribute('aria-checked'), 'false')
  assert.equal(await mode.getByRole('textbox', { name: '画面效果 每轮上限', exact: true }).inputValue(), '3')
  const overflow = await mode.evaluate(node => node.scrollWidth > node.clientWidth + 1)
  assert.equal(overflow, false, 'nothing overflows at 375')
  await page.screenshot({ path: join(output, 'mode-375.png') })
  await mode.getByRole('button', { name: '返回舞台设置', exact: true }).click()
  await jump.waitFor()
  await page.screenshot({ path: join(output, 'settings-375.png') })
  result.narrow = result.persisted = true
  await writeFile(join(output, 'stage-mode.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
  await page.screenshot({ path: join(output, 'failure.png') })
  throw error
} finally { await browser.close() }
