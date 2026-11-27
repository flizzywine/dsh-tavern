import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

async function openCardDetail(page, cardPath) {
  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||{});}};` })
  await page.addScriptTag({ content: await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8') })
  await page.evaluate(path => {
    let library, tab = { id: 'cards-tab', meta: { cardPath: path } }
    const scope = { sessionId: 'cards-session' }
    const root = modules['react-dom/client'].createRoot(document.querySelector('main'))
    const render = (key = 'library') => root.render(modules.react.createElement(library, { key, tab, scope, ctx, visible: true }))
    const ctx = {
      effect(run, label) { if (label === 'dsh-tavern: Better Sidebar card library tab') return run() },
      inject() { return { dispose() {} } }, get() {}, provide() {},
      slots: {}, tavernSessionSignals: { subscribe() { return () => {} } },
      betterSidebar: {
        registerTab(spec) { library = spec.component },
        updateTab(id, patch) {
          if (id !== tab.id) throw new Error('Wrong sidebar tab')
          tab = { ...tab, ...patch }
          render()
        },
      },
    }
    window.client.apply(ctx)
    window.reopenCardLibrary = () => render('reopened')
    render()
  }, cardPath)
}

test('重命名人物卡修改详情和列表里的展示名，保留文件路径和角色名称', async t => {
  const fileName = '示例卡文件.json'
  const cardPath = 'cards/' + fileName
  const characterName = '示例角色'
  const newName = '自定展示名'
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  const card = { path: cardPath, name: characterName, tags: [] }
  let displayName
  await page.route('http://tavern.test/**', async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1)
    if (!method) return route.fulfill({ contentType: 'text/html', body: '<main></main>' })
    const args = route.request().postDataJSON()
    requests.push({ method, args })
    if (method === 'getCard') {
      assert.equal(args.path, cardPath)
      return route.fulfill({ json: { ok: true, card } })
    }
    if (method === 'organizeCards') {
      displayName = args.displayName
      return route.fulfill({ json: { ok: true, groups: [] } })
    }
    if (method === 'listCards') return route.fulfill({ json: { ok: true, cards: [{ ...card, displayName }] } })
    return route.fulfill({ json: { ok: true } })
  })
  await openCardDetail(page, cardPath)
  const rename = page.getByRole('button', { name: '重命名', exact: true })
  const title = page.locator('.dsh-card-detail .dsh-card-name')
  const input = page.getByRole('dialog', { name: '重命名人物卡', exact: true }).getByRole('textbox')
  const expectTitle = text => title.filter({ hasText: text }).waitFor()
  await rename.click()
  assert.equal(await input.inputValue(), characterName)
  await input.fill(newName)
  await input.press('Enter')
  await expectTitle(newName)
  const reloaded = page.waitForResponse(response => response.url().endsWith('/getCard'))
  await page.evaluate(() => window.reopenCardLibrary())
  await reloaded
  await expectTitle(newName)
  // the file name is no line under the card name (主人 11-24): the name's tooltip says it.
  assert.equal(await title.getAttribute('title'), fileName)
  // the card's own 角色名称 is untouched: renaming writes only the library's display name (no updateCard, checked below).
  await page.getByRole('button', { name: '返回人物卡库', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索人物卡' }).fill(newName)
  await page.getByRole('button', { name: newName, exact: true }).click()
  await rename.click()
  assert.equal(await input.inputValue(), newName)
  await input.fill('')
  await input.press('Enter')
  await expectTitle(characterName)
  const renames = requests.filter(({ method }) => method === 'organizeCards').map(({ args: { action, paths, displayName } }) => ({ action, paths, displayName }))
  assert.deepEqual(renames, [
    { action: 'cards', paths: [cardPath], displayName: newName },
    { action: 'cards', paths: [cardPath], displayName: '' },
  ])
  assert.ok(!requests.some(({ method }) => method === 'renameResource' || method === 'updateCard'))
  assert.deepEqual(errors, [])
})

test('人物卡详情在宽屏和窄屏放大封面，居中的播放按钮仍能开局', async t => {
  const card = { path: 'cards/example.json', name: '示例角色', hasImage: true, tags: [] }
  const coverImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=', 'base64')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  await page.route('http://tavern.test/**', route => {
    switch (new URL(route.request().url()).pathname.split('/').at(-1)) {
      case '': return route.fulfill({ contentType: 'text/html', body: '<main style="container-type: inline-size"></main>' })
      case 'getCard': return route.fulfill({ json: { ok: true, card } })
      case 'listCards': return route.fulfill({ json: { ok: true, cards: [card] } })
      case 'card-image': return route.fulfill({ contentType: 'image/png', body: coverImage })
      default: return route.fulfill({ json: { ok: true } })
    }
  })
  await openCardDetail(page, card.path)
  const cover = page.getByRole('button', { name: '查看封面', exact: true })
  const play = page.getByRole('button', { name: '开始游玩', exact: true })
  const tags = page.getByRole('button', { name: '添加标签', exact: true })
  await cover.waitFor()
  await play.waitFor()
  await tags.waitFor()
  for (const [width, coverWidth] of [[1100, 192], [520, 120], [320, 120]]) {
    await page.setViewportSize({ width, height: 850 })
    const [coverBox, playBox, tagsBox] = await Promise.all([cover.boundingBox(), play.boundingBox(), tags.boundingBox()])
    assert.equal(coverBox.width, coverWidth, `cover width at ${width}px`)
    assert.equal(coverBox.height, coverWidth * 4 / 3, `cover keeps its aspect ratio at ${width}px`)
    assert.ok(Math.abs(coverBox.x + coverBox.width / 2 - playBox.x - playBox.width / 2) < 1, `play button is horizontally centered at ${width}px`)
    assert.ok(Math.abs(coverBox.y + coverBox.height / 2 - playBox.y - playBox.height / 2) < 1, `play button is vertically centered at ${width}px`)
    assert.ok(tagsBox.x >= coverBox.x + coverBox.width && tagsBox.x + tagsBox.width <= width, `tags fit beside the cover at ${width}px`)
  }
  await cover.click({ position: { x: 12, y: 12 } })
  const viewer = page.getByRole('dialog', { name: '查看大图', exact: true })
  await viewer.waitFor()
  await viewer.getByRole('button', { name: '关闭', exact: true }).click()
  await page.evaluate(() => {
    window.addEventListener('dsh-tavern-play-card', event => { window.startedCardPath = event.detail.path }, { once: true })
  })
  await play.click()
  assert.equal(await page.evaluate(() => window.startedCardPath), card.path)
})
