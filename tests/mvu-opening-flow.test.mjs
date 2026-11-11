import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))

test('official MVU initializes a greeting or no-greeting start before its first turn and settles the setup', { timeout: 120000 }, async t => {
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
  const modes = process.env.MVU_SMOKE_CARD_PATH ? ['opening-card-flow']
    : ['opening', 'opening-setup', 'opening-flow-greeting', 'opening-flow', 'opening-authored', 'opening-authored-helper']
  let greetingVariables
  for (const mode of modes) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => errors.push(message.text()))
    page.on('requestfailed', request => errors.push(request.url() + ': ' + request.failure()?.errorText))
    await page.route('**/jquery-ui/jquery-ui.min.js', route => route.abort())
    await page.goto(url + '/?mode=' + mode)
    await page.waitForFunction(() => {
      try { return JSON.parse(document.querySelector('#result').textContent).ready === true } catch { return false }
    }, null, { timeout: 45000 }).catch(async error => {
      throw new Error(mode + ': ' + await page.locator('#result').textContent() + '\n' + JSON.stringify(await page.evaluate(() => rpc('diagnostics'))) + '\n' + errors.join('\n') + '\n' + stderr, { cause: error })
    })
    if (mode.startsWith('opening-authored')) {
      assert.deepEqual(await page.evaluate(() => rpc('run-authored-settlement')), { pass: true })
      await page.close()
      continue
    }
    if (mode.includes('-flow')) {
      const flow = await page.evaluate(() => window.openingFlow)
      if (process.env.MVU_SMOKE_REPORT) await writeFile(process.env.MVU_SMOKE_REPORT, JSON.stringify(flow, null, 2) + '\n')
      assert.ok(Object.keys(flow.before.stat_data || {}).length, JSON.stringify(flow))
      assert.ok(Object.keys(flow.before.schema?.properties || {}).length, JSON.stringify(flow))
      assert.doesNotMatch(flow.prompt, /【变量结构】\s*\{\s*\}|【当前变量快照】\s*\{\s*\}/)
      assert.deepEqual(flow.foregroundVariables.stat_data, flow.before.stat_data)
      if (mode.includes('greeting')) greetingVariables = flow.before.stat_data
      else {
        assert.equal(flow.opening.role, 'system')
        assert.equal(flow.opening.greeting, undefined)
        assert.doesNotMatch(flow.opening.text, /<initvar>|Greeting/)
        if (greetingVariables) assert.deepEqual(flow.before.stat_data, greetingVariables, 'skipping prose preserves greeting defaults')
      }
      assert.equal(flow.receipt.status, 'updated', JSON.stringify(flow))
      assert.equal(flow.feedback.ok, true, JSON.stringify(flow.feedback))
      assert.equal(flow.calls, 1)
      if (!process.env.MVU_SMOKE_CARD_PATH) {
        assert.equal(flow.before.stat_data.affection, 5)
        assert.equal(flow.after.stat_data.affection, 25)
        assert.equal(flow.after.stat_data.stage, 'friends')
      }
      await page.close()
      continue
    }
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
