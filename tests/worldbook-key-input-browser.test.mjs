import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'

// #425: the 触发词 field takes 中文 and English commas typed at its end and keeps going to the next word. On the book page the
// field is the shared chips field: what is typed splits on , ， 、 when it is left, and the entry saves its new words.
test('世界书触发词输入框能在末尾输入中英文逗号并继续添加下一个词（#425）', async t => {
  const host = spawn(process.execPath, ['tests/fixtures/worldbook-editor-ui.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  t.after(() => host.kill())
  const [chunk] = await once(host.stdout, 'data')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  page.on('pageerror', error => { throw error })
  await page.goto(String(chunk).trim())
  await page.locator('button.dsh-wbd-entry-main[title="Alice"]').click()
  const entry = page.locator('.dsh-wbd-entry[data-open]').filter({ has: page.locator('button[title="Alice"]') })
  const input = entry.getByRole('textbox', { name: '添加触发词', exact: true })
  await entry.locator('.fork-inline-chip-add[title="添加触发词"]').click()
  const updates = []
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/updateWorldBook')) updates.push(request.postDataJSON().update.operations) })
  await input.pressSequentially('码头，灯塔')
  await input.blur()
  await page.waitForFunction(() => document.querySelectorAll('.dsh-wbd-entry[data-open] .fork-inline-chip').length === 3)
  assert.deepEqual(await entry.locator('.fork-inline-chip').allInnerTexts(), ['Alice', '码头', '灯塔'])
  await page.waitForTimeout(300)
  assert.deepEqual(updates.at(-1).map(operation => operation.patch), [{ primaryKeys: ['Alice', '码头', '灯塔'] }])
  await entry.locator('.fork-inline-chip-add[title="添加触发词"]').click()
  await page.keyboard.insertText('甲,乙,')
  await input.blur()
  await page.waitForFunction(() => document.querySelectorAll('.dsh-wbd-entry[data-open] .fork-inline-chip').length === 5)
  assert.deepEqual(await entry.locator('.fork-inline-chip').allInnerTexts(), ['Alice', '码头', '灯塔', '甲', '乙'])
})
