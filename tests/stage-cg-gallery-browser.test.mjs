// 回想: the grid opens a CG in the 「四角」 viewer; ←→ / swipe change CG, mini pictures change 差分, 🗑 deletes at once and gives way to the neighbour.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { galleryItems, mountGallery } from './helpers/stage-gallery-browser.mjs'

async function open(t, items, options = {}) {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close())
  const context = await browser.newContext(options.phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: options.viewport || { width: 1280, height: 720 } })
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
  await page.waitForSelector('.fork-cg-viewer[data-ui="off"]')
})

// 手势缩放: real touches (CDP) on a phone; the drawn picture is measured on screen.
async function touchPage(t, items) {
  const page = await open(t, items, { phone: true })
  await page.locator('.fork-cg-gallery-cell').first().tap()
  await page.waitForFunction(() => document.querySelectorAll('.fork-cg-viewer .fork-cg-stage > img')[1]?.style.transform)
  const cdp = await page.context().newCDPSession(page)
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) })
  // each finger moves from its start to its end in steps.
  const gesture = async (...fingers) => {
    await send('touchStart', fingers.map(f => f[0]))
    for (let step = 1; step <= 8; step++) await send('touchMove', fingers.map(([a, b]) => [a[0] + (b[0] - a[0]) * step / 8, a[1] + (b[1] - a[1]) * step / 8]))
    await send('touchEnd', [])
  }
  const tap = async point => { await send('touchStart', [point]); await send('touchEnd', []) }
  const drawn = () => page.evaluate(() => {
    const frame = document.querySelector('.fork-cg-viewer .fork-cg-stage'), image = frame.querySelectorAll('img')[1], f = frame.getBoundingClientRect(), r = image.getBoundingClientRect()
    const k = Math.min(r.width / image.naturalWidth, r.height / image.naturalHeight), w = image.naturalWidth * k, h = image.naturalHeight * k
    const left = r.left + (r.width - w) / 2, top = r.top + (r.height - h) / 2
    return { scale: image.style.scale || '1', picture: { left, top, right: left + w, bottom: top + h }, frame: { left: f.left, top: f.top, right: f.right, bottom: f.bottom } }
  })
  return { page, gesture, tap, drawn }
}
const covers = ({ picture, frame }) => picture.left <= frame.left + 0.5 && picture.right >= frame.right - 0.5 && picture.top <= frame.top + 0.5 && picture.bottom >= frame.bottom - 0.5

test('phones: a pinch zooms up to 4× covering the frame, one finger then pans to its edge, not a swipe', async t => {
  const { page, gesture, tap, drawn } = await touchPage(t, galleryItems(2))
  await gesture([[175, 420], [60, 380]], [[215, 420], [330, 460]])
  let now = await drawn()
  assert.equal(now.scale, '4', 'clamped at 4×')
  assert.ok(covers(now), 'zoomed, the picture covers its frame')
  assert.equal(await page.locator('.fork-cg-viewer').getAttribute('data-ui'), 'on', 'a pinch is not a tap')
  for (let i = 0; i < 3; i++) await gesture([[100, 420], [380, 420]])
  now = await drawn()
  assert.equal(await title(page), '第 1 张 CG', 'zoomed, a drag pans instead of turning the page')
  assert.ok(Math.abs(now.picture.left - now.frame.left) < 0.5, 'the pan stops at the picture\'s edge ')
  assert.ok(covers(now))
  await gesture([[300, 300], [300, 700]])
  assert.ok(covers(await drawn()), 'still covered after a vertical pan')
  await tap([195, 420]); await tap([195, 420])
  await page.waitForTimeout(400)
  assert.equal((await drawn()).scale, '1', 'after a pan, a double tap returns to 1×')
  assert.equal(await page.locator('.fork-cg-viewer').getAttribute('data-ui'), 'on')
  await gesture([[175, 420], [60, 420]], [[215, 420], [330, 420]])
  await page.locator('[data-k="next"]').tap()
  assert.equal((await drawn()).scale, '1', 'another CG starts at 1×')
})

test('phones: double tap toggles 1× and 2.5× at the tap point; at 1× a swipe turns the page', async t => {
  const { page, gesture, tap, drawn } = await touchPage(t, galleryItems(3, { variants: 2 }))
  const before = await drawn(), at = [100, 400]
  const u = (at[0] - before.picture.left) / (before.picture.right - before.picture.left), v = (at[1] - before.picture.top) / (before.picture.bottom - before.picture.top)
  await tap(at); await tap(at)
  await page.waitForTimeout(400)
  let now = await drawn()
  assert.equal(now.scale, '2.5')
  const under = [now.picture.left + u * (now.picture.right - now.picture.left), now.picture.top + v * (now.picture.bottom - now.picture.top)]
  assert.ok(Math.abs(under[0] - at[0]) < 1, 'the tapped point stays under the finger')
  assert.equal(await page.locator('.fork-cg-viewer').getAttribute('data-ui'), 'on', 'a double tap does not fold the controls')
  await page.locator('.fork-cg-variant').nth(1).tap()
  assert.equal((await drawn()).scale, '1', 'another 差分 starts at 1×')
  await tap(at); await tap(at)
  await page.waitForTimeout(400)
  assert.equal((await drawn()).scale, '2.5')
  await tap(at); await tap(at)
  await page.waitForTimeout(400)
  assert.equal((await drawn()).scale, '1', 'a second double tap returns to 1×')
  await gesture([[320, 420], [80, 430]])
  assert.equal(await title(page), '第 2 张 CG', 'at 1× a swipe changes CG')
})

test('phones: 特写 then a pinch zooms from the close-up; 完整 returns to the whole picture', async t => {
  const { page, gesture, drawn } = await touchPage(t, galleryItems(2, { focus: true }))
  await page.locator('.fork-cg-compose-mode[data-k="zoom"]').tap()
  await page.waitForFunction(() => /scale\(2\)/.test(document.querySelectorAll('.fork-cg-viewer .fork-cg-stage > img')[1].style.transform))
  const close = await drawn()
  await gesture([[175, 420], [135, 420]], [[215, 420], [255, 420]])
  const now = await drawn()
  assert.ok(Number(now.scale) > 2, 'the pinch scales the close-up ')
  assert.ok(now.picture.right - now.picture.left > 2 * (close.picture.right - close.picture.left))
  await page.locator('.fork-cg-compose-mode[data-k="full"]').tap()
  assert.equal((await drawn()).scale, '1')
})

test('desktop: the wheel zooms about the pointer and a drag pans', async t => {
  const page = await open(t, galleryItems(2))
  await page.locator('.fork-cg-gallery-cell').first().click()
  await page.waitForFunction(() => document.querySelectorAll('.fork-cg-viewer .fork-cg-stage > img')[1]?.style.transform)
  await page.mouse.move(400, 300)
  await page.mouse.wheel(0, -400)
  const scale = () => page.evaluate(() => document.querySelectorAll('.fork-cg-viewer .fork-cg-stage > img')[1].style.scale || '1')
  await page.waitForFunction(() => Number(document.querySelectorAll('.fork-cg-viewer .fork-cg-stage > img')[1].style.scale) > 1.5)
  const translate = () => page.evaluate(() => document.querySelectorAll('.fork-cg-viewer .fork-cg-stage > img')[1].style.translate)
  const from = await translate()
  await page.mouse.down(); await page.mouse.move(500, 350, { steps: 5 }); await page.mouse.up()
  assert.notEqual(await translate(), from, 'the drag moved the view')
  assert.ok(Number(await scale()) > 1.5)
  assert.equal(await page.locator('.fork-cg-viewer').count(), 1)
  await page.keyboard.press('ArrowRight')
  assert.equal(await scale(), '1')
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
// The four fits (wide or phone screen × landscape or portrait CG): each control group is one line, no control covers another,
// and where the fitted picture leaves bands (a portrait CG on a wide screen, any CG on a phone) none covers the picture.
async function layout(page) {
  await page.waitForFunction(() => {
    const viewer = document.querySelector('.fork-cg-viewer'), image = viewer?.querySelectorAll(':scope > .fork-cg-gallery-picture > .fork-cg-stage > img')[1]
    return viewer?.style.getPropertyValue('--cg-ar') && image?.naturalWidth > 0 && image.style.transform
  })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate(() => {
    const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
    const viewer = document.querySelector('.fork-cg-viewer'), title = document.createRange()
    title.selectNodeContents(viewer.querySelector('.fork-cg-viewer-top h2'))
    const parts = { title: box(title), ...Object.fromEntries([...viewer.querySelectorAll('.fork-cg-round, .fork-cg-variants, .fork-cg-crop')].map(node => [node.dataset.k || node.classList[0], box(node)])) }
    const frame = viewer.querySelector(':scope > .fork-cg-gallery-picture > .fork-cg-stage'), image = frame.querySelectorAll('img')[1]
    const drawn = box(image), clip = box(frame), scale = Math.min((drawn.right - drawn.left) / image.naturalWidth, (drawn.bottom - drawn.top) / image.naturalHeight)
    const cx = (drawn.left + drawn.right) / 2, cy = (drawn.top + drawn.bottom) / 2, w = image.naturalWidth * scale / 2, h = image.naturalHeight * scale / 2
    const picture = { left: Math.max(clip.left, cx - w), right: Math.min(clip.right, cx + w), top: Math.max(clip.top, cy - h), bottom: Math.min(clip.bottom, cy + h) }
    const lines = [...viewer.querySelectorAll('.fork-cg-viewer-acts, .fork-cg-variants, .fork-cg-crop')].map(group => new Set([...group.children].filter(node => node.tagName === 'BUTTON').map(node => Math.round(node.getBoundingClientRect().top))).size)
    const strip = viewer.querySelector('.fork-cg-variants')
    return { parts, picture, lines, fit: viewer.dataset.fit, stripFits: strip.scrollWidth <= strip.clientWidth }
  })
}
const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
const middle = r => (r.top + r.bottom) / 2
function assertLaid({ parts, picture, lines }, { bands }) {
  assert.deepEqual(lines, lines.map(() => 1), 'each group is one line')
  const names = Object.keys(parts)
  for (const [i, a] of names.entries()) for (const b of names.slice(i + 1)) assert.ok(!overlap(parts[a], parts[b]), `${a} clear of ${b}`)
  if (bands) for (const name of names) assert.ok(!overlap(parts[name], picture), `${name} clear of the picture`)
  assert.ok(Math.abs(middle(parts['fork-cg-variants']) - middle(parts['fork-cg-crop'])) < 1, '差分 and 构图 share one row')
}
for (const [name, phone, portrait] of [['wide screen, landscape CG', false, false], ['wide screen, portrait CG', false, true], ['phone, landscape CG', true, false], ['phone, portrait CG', true, true]]) {
  test(`${name}: the controls keep their own line${phone || portrait ? ' and stay off the picture' : ''}`, async t => {
    const page = await open(t, galleryItems(3, { variants: 3, focus: true, portrait }), { phone, viewport: phone ? null : { width: 1920, height: 1080 } })
    await page.locator('.fork-cg-gallery-cell').nth(1).click()
    const laid = await layout(page)
    assert.equal(laid.fit, !phone && portrait ? 'side' : 'over')
    assertLaid(laid, { bands: phone || portrait })
    if (phone) {
      const row = ['prev', 'fork-cg-variants', 'fork-cg-crop', 'next'].map(part => middle(laid.parts[part]))
      assert.ok(Math.max(...row) - Math.min(...row) < 1, '‹ 差分 构图 › are one row')
      assert.ok(laid.parts.prev.right < laid.parts['fork-cg-variants'].left && laid.parts['fork-cg-crop'].right < laid.parts.next.left, 'in that order')
      assert.ok(laid.stripFits, 'three 差分 fit the row whole')
    }
    if (phone) {
      await page.locator('.fork-cg-compose-mode[data-k="zoom"]').click()
      await page.waitForFunction(() => /scale\(2\)/.test(document.querySelectorAll('.fork-cg-viewer > .fork-cg-gallery-picture > .fork-cg-stage > img')[1].style.transform))
      assertLaid(await layout(page), { bands: true })
    }
  })
}