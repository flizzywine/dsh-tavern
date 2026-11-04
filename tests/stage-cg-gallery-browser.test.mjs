// 回想: the grid opens a CG in the 「四角」 viewer; ←→ / swipe change CG, mini pictures change 差分, 🗑 deletes at once and gives way to the neighbour.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { galleryItems, mountGallery } from './helpers/stage-gallery-browser.mjs'

async function open(t, items, options = {}) {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close())
  const context = await browser.newContext(options.phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 } })
  const page = await context.newPage(); page.setDefaultTimeout(5000)
  const errors = []; page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []))
  await mountGallery(page, { items })
  return page
}
const title = page => page.locator('.fork-cg-viewer-top h2').textContent()

test('the grid opens a CG; arrows change CG and 差分, Esc returns to its cell', async t => {
  const page = await open(t, galleryItems(3, { variants: 2 }))
  assert.equal(await page.locator('.fork-cg-gallery-cell').count(), 3)
  await page.locator('.fork-cg-gallery-cell').nth(1).click()
  assert.equal(await title(page), '第 2 张 CG')
  assert.equal(await page.locator('.fork-cg-variant').count(), 2)
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.locator('.fork-cg-variant[aria-pressed="true"]').getAttribute('aria-label'), '差分 2')
  await page.locator('.fork-cg-variant').first().click()
  assert.equal(await page.locator('.fork-cg-variant[aria-pressed="true"]').getAttribute('aria-label'), '差分 1', 'a mini picture switches 差分')
  assert.equal(await page.locator('.fork-cg-variant .fork-cg-gallery-picture').count(), 2, 'each 差分 shows its picture')
  await page.keyboard.press('ArrowRight')
  assert.equal(await title(page), '第 3 张 CG')
  assert.equal(await page.locator('[data-k="next"]').count(), 0, 'no 下一张 on the last CG')
  await page.locator('[data-k="prev"]').click()
  assert.equal(await title(page), '第 2 张 CG')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.fork-cg-viewer').count(), 0)
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '第 2 张 CG')
})

test('✎ 🗑 ✕ sit at equal spacing; a single-variant CG without focus shows no 差分 strip or 构图', async t => {
  const page = await open(t, galleryItems(2))
  await page.locator('.fork-cg-gallery-cell').first().click()
  const boxes = await page.locator('.fork-cg-viewer-acts > button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()).map(r => ({ left: r.left, right: r.right })))
  assert.equal(boxes.length, 3)
  assert.equal(boxes[1].left - boxes[0].right, boxes[2].left - boxes[1].right)
  assert.equal(await page.locator('.fork-cg-variants, .fork-cg-crop').count(), 0)
})

test('🗑 deletes at once, then shows the next CG, the previous after the last, and the grid when none are left', async t => {
  const page = await open(t, galleryItems(3))
  await page.locator('.fork-cg-gallery-cell').nth(1).click()
  await page.locator('[data-k="remove"]').click()
  await page.waitForFunction(() => document.querySelector('.fork-cg-viewer-top h2')?.textContent === '第 3 张 CG')
  assert.equal(await page.locator('[role="alertdialog"], [role="alert"]').count(), 0, 'no confirmation')
  await page.locator('[data-k="remove"]').click()
  await page.waitForFunction(() => document.querySelector('.fork-cg-viewer-top h2')?.textContent === '第 1 张 CG')
  await page.locator('[data-k="remove"]').click()
  await page.waitForSelector('.fork-empty')
  assert.equal(await page.locator('.fork-cg-viewer').count(), 0)
  assert.deepEqual(await page.evaluate(() => galleryState.calls.filter(call => call.method === 'removeSceneCg').map(call => call.args.ref.assetId)), ['cg-2', 'cg-3', 'cg-1'])
})

test('a failed delete keeps the CG and says so; the next CG clears it', async t => {
  const page = await open(t, galleryItems(2))
  await page.locator('.fork-cg-gallery-cell').first().click()
  await page.evaluate(() => { galleryState.fail = true })
  await page.locator('[data-k="remove"]').click()
  await page.waitForSelector('.fork-cg-remove-error[role="alert"]')
  assert.equal(await title(page), '第 1 张 CG')
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('.fork-cg-remove-error').count(), 0)
})

test('phones: a horizontal swipe changes CG, a tap folds the controls', async t => {
  const page = await open(t, galleryItems(3), { phone: true })
  await page.locator('.fork-cg-gallery-cell').first().tap()
  const swipe = (from, to) => page.evaluate(([from, to]) => {
    const target = document.querySelector('.fork-cg-viewer'), base = { bubbles: true, pointerType: 'touch', pointerId: 7, clientY: 400 }
    target.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: from }))
    target.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: to }))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: to, clientY: 400 }))
  }, [from, to])
  await swipe(300, 120)
  assert.equal(await title(page), '第 2 张 CG')
  await swipe(100, 300)
  assert.equal(await title(page), '第 1 张 CG')
  assert.equal(await page.locator('.fork-cg-viewer').getAttribute('data-ui'), 'on', 'a swipe is not a tap')
  await page.locator('.fork-cg-viewer').tap({ position: { x: 195, y: 420 } })
  assert.equal(await page.locator('.fork-cg-viewer').getAttribute('data-ui'), 'off')
})

test('构图 shows only with focus areas, as a labelled 完整 | 特写 pair; several areas open a menu under 特写', async t => {
  const items = galleryItems(2, { focus: true })
  items[1].focusHints.push({ key: 'hands', label: '手', x: 0.6, y: 0.7, zoom: 2.5 })
  const page = await open(t, items)
  await page.locator('.fork-cg-gallery-cell').first().click()
  const modes = page.locator('.fork-cg-crop[role="group"][aria-label="构图"] > button')
  assert.deepEqual(await modes.allTextContents(), ['完整', '特写'], 'each mode names itself')
  assert.equal(await page.locator('.fork-cg-crop svg').count(), 2, 'with an icon each')
  assert.equal(await modes.first().getAttribute('aria-pressed'), 'true')
  await modes.nth(1).click()
  assert.equal(await modes.nth(1).getAttribute('aria-pressed'), 'true', 'one focus area: 特写 applies it at once')
  assert.equal(await page.locator('.fork-cg-crop-menu').count(), 0)
  await modes.first().click()
  assert.equal(await modes.first().getAttribute('aria-pressed'), 'true')
  await page.keyboard.press('ArrowRight')
  await modes.nth(1).click()
  assert.deepEqual(await page.locator('.fork-cg-crop-menu [role="menuitemradio"]').allTextContents(), ['特写', '手'])
  await page.locator('.fork-cg-crop-menu [role="menuitemradio"]').nth(1).click()
  assert.equal(await modes.nth(1).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.fork-cg-crop-menu').count(), 0)
})