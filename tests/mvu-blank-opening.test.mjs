import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

test('prepared blank opening keeps its initialized MVU state without adding a floor', async () => {
  const h = initializationFixture()
  // A card whose only greeting is blank starts with no floor; a blank choice among
  // several keeps its anchor floor and initializes on message 0 as before.
  h.card.first_mes = ''
  h.card.alternate_greetings = []
  h.state.extensions.mvuResources = [{ enabled: true }]
  const variables = { stat_data: { affection: 5, stage: 'early' }, schema: { type: 'object', properties: {} } }
  const chat = await h.make().start({ ...h.input, preparation: {
    messageVariables: variables, variables: { unrelated: 'preserved' }
  } })
  assert.deepEqual(chat.messages, [])
  assert.deepEqual(chat.variables, { unrelated: 'preserved', ...variables })
  assert.equal(chat.mvu.openingInitialization.status, 'complete')
})

test('official MVU initializes a zero-message chat before its first scripted turn; normal opening stays intact', { timeout: 120000 }, async t => {
  const server = spawn(process.execPath, [fileURLToPath(new URL('./browser/mvu-initialization-browser-smoke.mjs', import.meta.url))], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MVU_SMOKE_POLL_SIGNALS: '1' }
  })
  let stderr = ''
  server.stderr.on('data', chunk => { stderr += chunk })
  t.after(() => server.kill())
  const url = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Smoke server startup timed out: ' + stderr)), 15000)
    server.once('error', reject)
    server.once('exit', code => { clearTimeout(timer); reject(new Error('Smoke server exited ' + code + ': ' + stderr)) })
    server.stdout.on('data', chunk => {
      output += chunk
      const match = /MVU_INITIALIZATION_SMOKE_URL=(http:\/\/[^\s]+)/.exec(output)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  t.after(() => browser.close())
  for (const mode of ['opening-blank', 'opening-blank-template', 'opening']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => errors.push(message.text()))
    page.on('requestfailed', request => errors.push(request.url() + ': ' + request.failure()?.errorText))
    await page.goto(url + '/?mode=' + mode)
    await page.waitForFunction(() => {
      try { return JSON.parse(document.querySelector('#result').textContent).ready === true } catch { return false }
    }, null, { timeout: 45000 }).catch(async error => {
      throw new Error(mode + ': ' + await page.locator('#result').textContent() + '\n' + JSON.stringify(await page.evaluate(() => rpc('diagnostics'))) + '\n' + errors.join('\n') + '\n' + stderr, { cause: error })
    })
    const status = await page.locator('#result').textContent()
    assert.equal(JSON.parse(status).hp, 10)
    const result = await page.evaluate(async () => {
      const response = await fetch('/rpc', { method: 'POST', body: JSON.stringify({ method: 'run', sessionId: id }) })
      return { ok: response.ok, value: await response.json() }
    })
    assert.equal(result.ok, true, mode + ': ' + JSON.stringify(result.value))
    assert.equal(result.value.pass, true)
    assert.equal(result.value.calls, 1)
    assert.equal(result.value.receipt.status, 'updated')
    await page.close()
  }
})
