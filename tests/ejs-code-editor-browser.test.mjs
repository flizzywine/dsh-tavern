import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

test('世界书直接编辑并保存 EJS 文本，不显示代码编辑入口或执行模板', { skip: !process.env.TAVERN_BROWSER_TESTS || !process.env.DSH_ROOT }, async t => {
  const host = spawn(process.execPath, ['tests/fixtures/worldbook-editor-ui.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  t.after(() => host.kill())
  const [chunk] = await once(host.stdout, 'data')
  const url = String(chunk).trim()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  await page.goto(url)
  await page.locator('button.dsh-wbd-entry-main[title="Alice"]').click()
  const entry = page.locator('.dsh-wbd-entry[data-open]').filter({ has: page.locator('button[title="Alice"]') })
  assert.equal(await entry.getByRole('button', { name: 'EJS 代码编辑', exact: true }).count(), 0)
  // 内容 reads as text until ✎ turns it into the field; leaving the field saves the entry.
  assert.equal(await entry.locator('.dsh-wbd-text-body').innerText(), 'Alice 在钟楼值班。')
  await entry.getByRole('button', { name: '编辑内容', exact: true }).click()
  const input = entry.locator('.dsh-wbd-text textarea')
  assert.equal(await input.inputValue(), 'Alice 在钟楼值班。')
  const text = '<% window.templateWasExecuted = true; %>\nAlice 的新模板'
  await input.fill(text)
  assert.equal(await input.inputValue(), text)
  const saved = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/updateWorldBook'))
  await input.blur()
  const record = await (await saved).json()
  assert.equal(record.view.entries.find(item => item.comment === 'Alice').content, text)
  assert.equal(record.view.entries.find(item => item.comment === '角色库开头').content, '<角色库>')
  assert.equal(await page.evaluate(() => window.templateWasExecuted), undefined)
})
