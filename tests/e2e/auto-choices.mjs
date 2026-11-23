import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

// 设置 › DSH Tavern › 剧情 「自动生成候选项」 against a real host. Run only against an owned, hidden, muted fresh profile.
// Only model output is substituted (an uploaded fixture plugin); turns, candidate tasks and storage are real.
const endpoint = process.env.TAVERN_STAGE_TEST_CDP, modulePath = process.env.TAVERN_E2E_LLM_MODULE
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !process.argv.includes('--artifacts') || !modulePath || !endpoint || new URL(endpoint).port === '9333') throw Error('Requires an owned hidden muted fresh-profile slot, runtime LLM module and artifacts directory')
await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
const page = pages[0]
page.setDefaultTimeout(20000)
async function until(check, label) { const end = Date.now() + 40000; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 150)) } throw Error('Timed out: ' + label) }
const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
  const value = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
  if (value.ok === false) throw Error(method + ': ' + JSON.stringify(value))
  return value
}, [method, args])
const steps = []
try {
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  // Needs a fresh profile: it checks the default, and an installed fixture plugin is not reloaded.
  const run = Date.now() % 100000, fixture = 'auto-choices-fixture', modelName = 'Auto choices fixture'
  const cardName = 'Lina ' + run, title = 'Auto choices verification ' + run
  // Foreground replies name the round they answer. Background tasks share one agent and its tools, so
  // a candidate request is told apart by its latest request text; it submits four actions and a scene.
  const source = `import { LlmAdapter } from ${JSON.stringify(pathToFileURL(modulePath).href)}
export const name = ${JSON.stringify(fixture)}, inject = ['llm', 'tavern']
export function apply(ctx) {
  const requests = { rounds: [], candidates: 0, background: [] }
  ctx.tavern.handle(${JSON.stringify(fixture + '/requests')}, () => requests)
  const text = message => (message?.content || []).map(block => block.text || '').join(' ')
  class Model extends LlmAdapter {
    async listModels(provider) { return [await this.resolveModel(provider, 'fixed')] }
    async resolveModel(provider, id) { return { provider, id, name: ${JSON.stringify(modelName)}, context: { contextWindow: 64000 } } }
    async *stream(input) {
      const names = (input.tools || []).map(tool => tool.name)
      const all = JSON.stringify(input.messages)
      let block = { type: 'text', text: 'Done.' }
      if (names.includes('candidate_submit_choices')) {
        const answered = (input.messages.at(-1)?.content || []).some(block => block.type === 'tool-result')
        // The latest request: the user messages after the agent's last reply (reminders may follow it).
        const tail = input.messages.slice(input.messages.findLastIndex(message => message.role !== 'user') + 1)
        const request = tail.map(text).join(' ')
        requests.background.push(request.slice(0, 80))
        if (!answered && request.includes('生成候选项')) {
          requests.candidates += 1
          block = { type: 'tool-call', id: 'choices-' + requests.candidates, name: 'candidate_submit_choices', arguments: JSON.stringify({ actions: ['Wave back', 'Ask about the map', 'Open the door', 'Check the lantern'], scene: 'Rain begins outside' }) }
        }
      } else {
        const round = ['ROUND_OFF', 'ROUND_ON'].map(marker => [all.lastIndexOf(marker), marker]).sort((a, b) => b[0] - a[0])[0]
        if (round[0] >= 0) { requests.rounds.push(round[1]); block = { type: 'text', text: 'Reply to ' + round[1] + '.' } }
      }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter([${JSON.stringify(fixture)}], new Model())
}`
  const zip = writeZipEntries([{ path: 'package.json', content: JSON.stringify({ name: fixture, type: 'module', main: 'index.mjs' }) }, { path: 'index.mjs', content: source }])
  const upload = await page.evaluate(async base64 => (await fetch('/api/dsh-tavern/card-upload', { method: 'POST', body: Uint8Array.from(atob(base64), c => c.charCodeAt(0)), headers: { 'content-type': 'application/octet-stream' } })).json(), zip.toString('base64'))
  await call('installUserPluginUpload', { uploadId: upload.uploadId, name: fixture + '.zip' })
  const requests = async () => (await call('callPluginHandler', { name: fixture + '/requests', args: {} })).result
  await until(() => requests().catch(() => null), 'fixture plugin')
  const model = { provider: fixture, model: 'fixed' }
  await call('updateTavernSettings', { patch: { defaultForegroundModel: model, defaultBackgroundModel: model } })
  const cardZip = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: cardName, description: 'Original synthetic fixture.', first_mes: 'The lamp is lit.', extensions: {} } }) }])
  const card = (await call('importCard', { payload: { kind: 'charx', name: 'auto-choices-' + run + '.charx', fileB64: cardZip.toString('base64') } })).card
  const text = [{ user_name: 'Reader', character_name: cardName }, { name: cardName, is_user: false, mes: 'The lamp is lit.' }, { name: 'Reader', is_user: true, mes: 'Begin.' }, { name: cardName, is_user: false, mes: 'Ready.' }].map(JSON.stringify).join('\n')
  const { sessionId } = await call('importChatHistoryText', { cardPath: card.path, text, fileName: 'auto-choices-' + run + '.jsonl' })
  await call('setConversationBackgroundModel', { sessionId, backgroundModel: model, backgroundTasks: { variables: false, posture: false, characterDesign: false, ledger: false, styleReference: false }, webSearchEnabled: false })
  await call('renameConversation', { sessionId, title })
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
  const chatUrl = page.url()

  async function openStorySettings() {
    // The sidebar footer 设置 opens a menu whose first item is Settings.
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).filter({ visible: true }).first().click()
    await page.getByText('Settings', { exact: true }).filter({ visible: true }).first().click()
    await page.getByText('DSH Tavern', { exact: true }).first().click()
    const section = page.getByRole('region', { name: '剧情', exact: true })
    const toggle = section.getByRole('switch', { name: '自动生成候选项', exact: true })
    await toggle.waitFor()
    await until(() => toggle.isEnabled(), 'switch loaded')
    return { section, toggle }
  }
  async function playRound(marker) {
    await page.goto(chatUrl)
    const box = page.getByRole('textbox', { name: /下一步行动|Next action|发消息|Message/ })
    await box.fill(marker); await box.press('Enter')
    await page.getByText('Reply to ' + marker + '.', { exact: true }).first().waitFor()
  }
  // The candidate panel 接下来的行动 may open folded; unfold it to read the actions.
  async function candidatesShown() {
    const panel = page.getByText('接下来的行动', { exact: true }).first()
    await panel.waitFor()
    const action = page.getByText('Ask about the map', { exact: true }).first()
    if (!await action.isVisible()) await panel.click()
    await action.waitFor()
  }
  const candidateTask = async () => (await call('syncSession', { sessionId, kind: 'candidate' })).sync.task

  // 1. The switch sits in 剧情 next to context compaction, and is off in a fresh profile.
  {
    const { section, toggle } = await openStorySettings()
    assert.equal(await toggle.isChecked(), false, 'off by default')
    await section.getByRole('heading', { name: '上下文压缩', exact: true }).waitFor()
    assert.equal((await call('getTavernSettings')).settings.candidateAutoGenerate, false)
    await section.screenshot({ path: join(output, 'settings-off.png') })
    steps.push('setting shows under 剧情, off by default')
  }

  // 2. Off: a completed round leaves candidates to the button.
  await playRound('ROUND_OFF')
  await page.waitForTimeout(3000)
  assert.equal((await requests()).candidates, 0, 'no candidate request while off')
  assert.equal(await candidateTask(), null, 'no candidate task while off')
  steps.push('off: a round completes without a candidate request')

  // 3. Turned on in 剧情; saved globally.
  {
    const { section, toggle } = await openStorySettings()
    await toggle.click()
    await section.getByText('已保存，所有游戏下一轮生效', { exact: true }).waitFor()
    assert.equal(await toggle.isChecked(), true)
    assert.equal((await call('getTavernSettings')).settings.candidateAutoGenerate, true)
    await section.screenshot({ path: join(output, 'settings-on.png') })
    steps.push('switch turns on and saves')
  }

  // 4. On: the next completed round generates candidates once, through the same candidate task as the button.
  await playRound('ROUND_ON')
  const task = await until(async () => { const value = await candidateTask(); return value?.status === 'succeeded' && value }, 'automatic candidate task')
  assert.match(task.requestId, /^auto-choices-[a-f0-9]{64}$/)
  await candidatesShown()
  await page.waitForTimeout(2000)
  const audit = await requests()
  assert.deepEqual([...new Set(audit.rounds)], ['ROUND_OFF', 'ROUND_ON'])
  assert.equal(audit.candidates, 1, 'exactly one automatic candidate request')
  await page.screenshot({ path: join(output, 'auto-choices.png') })
  steps.push('on: the next round generates candidates once and they show in the chat')

  // 5. Refresh shows the saved candidates without generating again.
  await page.reload()
  await candidatesShown()
  await page.waitForTimeout(1500)
  assert.equal((await requests()).candidates, 1, 'refresh does not generate')
  steps.push('refresh keeps the candidates and does not generate again')
  await writeFile(join(output, 'auto-choices.json'), JSON.stringify({ sessionId, steps, task, audit }, null, 2))
  console.log(JSON.stringify({ ok: true, steps }))
} catch (error) {
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + steps.join('\n') + '\n' + await page.locator('body').innerText().catch(() => ''))
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally { await browser.close() }
