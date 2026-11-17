// 画廊 UI 的浏览器回归：四个视图平级、卡片画廊的图块和游玩画廊完全一致。
// 运行：node tests/browser/bundled-image-gallery-views-browser-smoke.mjs
//
// 这里验的是「渲染出来的东西」而不是源码里写了什么：
//   - 一级只有 游玩画廊 / 卡片画廊 / 收藏 / 回收站，没有「全部图片」，卡片画廊里没有「清空全部」；
//   - 刷新 / 浏览全部 / 批量选择 在标题行右侧，和卡片画廊原来那排按钮同一个位置；
//   - 卡片画廊的图块带右上角回收按钮、说明行右侧收藏、底部提示词 / 负面 / 图生图；
//   - 收藏和回收站两个视图同时列出来源不同的图，点一下真的发到对应的宿主接口。
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {chromium} from 'playwright'
import {browserReactScript} from '../fixtures/browser-react.mjs'
import {DEFAULT_MODULAR_TEMPLATE} from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'
import {listTemplateModules} from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/template-modules.js'

const source = await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-image-bundled/client.js', import.meta.url), 'utf8')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==', 'base64')
const clone = value => JSON.parse(JSON.stringify(value))

const state = {
  config: {
    promptSystem: 'worldbook', imageEnabled: true, imageBackend: 'openai', activeImageChannel: 'test',
    imageDisplayPosition: 'inline', imageDisplayWidth: 0, promptDefaultEditable: true,
    promptWorkbench: true, promptWorkbenchDraw: true, promptDefault: clone(DEFAULT_MODULAR_TEMPLATE),
    promptPresets: [], promptPresetLibrary: [], promptEntries: [], promptEntryLimit: 1000, promptPresetLimit: 200,
    promptRevision: '1', promptModuleTypes: listTemplateModules(),
    imageChannels: [{id: 'test', provider: 'openai', name: '本地验证', model: 'test', options: {}}],
  },
  definitions: {revision: '1', characters: [], outfits: []},
  outfits: [], workflows: [], tasks: [],
  imageProviders: [{id: 'openai', label: 'OpenAI 兼容'}],
  worldbookFormat: 'natural', worldbookBooks: [],
}

const playJobs = [
  {id: 'play-a', state: 'done', source: 'play', hasImage: true, label: '历史图片', size: '832x1216', favorite: false, trashedAt: null, gameId: 'g1', completedAt: 1700000000000, prompt: 'play positive', negative: 'play negative'},
  {id: 'play-b', state: 'done', source: 'play', hasImage: true, label: '收藏的图', size: '1024x1024', favorite: true, trashedAt: null, gameId: 'g1', completedAt: 1700000100000, prompt: 'fav positive', negative: ''},
  {id: 'play-c', state: 'done', source: 'play', hasImage: true, label: '删掉的图', size: '512x768', favorite: false, trashedAt: 1700000200000, gameId: 'g2', completedAt: 1700000200000, prompt: 'trashed positive', negative: ''},
]
const cardItems = [
  {id: 'card-a', file: 'a.png', at: 1700000300000, session: 's1', prompt: 'card positive', negative: 'card negative', preset: '默认画风', channel: 'openai', size: '832x1216', seed: 7, favorite: false, trashedAt: null, url: '/dsh-tavern-gen/img/a.png'},
  {id: 'card-b', file: 'b.png', at: 1700000400000, session: 's1', prompt: 'favorite card', negative: '', preset: '伪3D', channel: 'openai', size: '1024x1024', seed: 8, favorite: true, trashedAt: null, url: '/dsh-tavern-gen/img/b.png'},
  {id: 'card-c', file: 'c.png', at: 1700000500000, session: 's2', prompt: 'trashed card', negative: '', preset: '默认画风', channel: 'openai', size: '512x768', seed: 9, favorite: false, trashedAt: 1700000600000, url: '/dsh-tavern-gen/img/c.png'},
]
const cardWrites = [], playWrites = []
const playVisible = mode => item => mode === 'trash' ? Boolean(item.trashedAt) : !item.trashedAt && (mode !== 'favorite' || item.favorite === true)
const applyOperation = (item, operation) => {
  if (operation === 'favorite') item.favorite = true
  else if (operation === 'unfavorite') item.favorite = false
  else if (operation === 'trash') item.trashedAt = Date.now()
  else item.trashedAt = null
  return item
}

const executablePath = [process.env.DSH_BROWSER_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path)) || chromium.executablePath()
const browser = await chromium.launch({headless: true, executablePath})
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 1200}})
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const reply = (route, value) => route.fulfill({contentType: 'application/json', body: JSON.stringify(value)})
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/plugins/dsh-tavern-image', '')
    const method = route.request().method()
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><div id="root" style="width:1000px;padding:20px"></div>'})
    if (url.pathname.startsWith('/dsh-tavern-gen/img/')) return route.fulfill({contentType: 'image/png', body: png})
    if (path === '/jobs') {
      if (url.searchParams.get('image') === '1') return route.fulfill({contentType: 'image/png', body: png})
      const job = playJobs.find(item => item.id === url.searchParams.get('id'))
      return reply(route, {ok: true, job: job ?? null})
    }
    if (path === '/history') return reply(route, {ok: true, jobs: playJobs.filter(playVisible(url.searchParams.get('gallery') || '')).map(clone)})
    if (path === '/gallery-item' && method === 'POST') {
      const body = route.request().postDataJSON()
      playWrites.push(clone(body))
      const job = playJobs.find(item => item.id === body.id)
      return reply(route, {ok: true, job: clone(applyOperation(job, body.operation))})
    }
    if (url.pathname === '/dsh-tavern-gen/api/gallery') return reply(route, {ok: true, items: cardItems.map(clone)})
    if (url.pathname === '/dsh-tavern-gen/api/gallery-item' && method === 'POST') {
      const body = route.request().postDataJSON()
      cardWrites.push(clone(body))
      const item = cardItems.find(entry => entry.id === body.id)
      return reply(route, {ok: true, item: clone(applyOperation(item, body.operation))})
    }
    if (url.pathname === '/dsh-tavern-gen/api/tools-enabled') return reply(route, {ok: true, enabled: false})
    if (path === '/state') return reply(route, clone(state))
    return reply(route, {ok: true})
  })

  await page.goto('http://image-gallery.test/')
  await page.addScriptTag({content: await browserReactScript()})
  await page.addScriptTag({content: 'window.__ModuleLoader__={load(spec){window.__plugin=spec.factory(name=>modules[name])}};'})
  await page.addScriptTag({content: source})
  await page.evaluate(() => {
    let Settings
    window.__plugin.apply({slots: {inject(name, install) { return install() }, register(spec, component) { if (spec.name === 'settings.section') Settings = component; return () => {} }}, inject() {}})
    const h = modules.react.createElement
    modules['react-dom/client'].createRoot(document.querySelector('#root')).render(h(Settings))
  })
  await page.getByLabel('生图系统模式', {exact: true}).waitFor()
  await page.getByRole('button', {name: '画廊', exact: true}).click()

  // 一级切换：四个视图平级，原来的「全部图片」不再有。
  for (const name of ['游玩画廊', '卡片画廊', '收藏', '回收站']) {
    assert.equal(await page.getByRole('button', {name, exact: true}).count(), 1, `${name} 应当是一级页签`)
  }
  assert.equal(await page.getByRole('button', {name: '全部图片', exact: true}).count(), 0, '「全部图片」按钮已删除')
  assert.equal(await page.getByRole('button', {name: '清空全部', exact: true}).count(), 0, '卡片画廊不再有清空全部')

  // 刷新 / 浏览全部 / 批量选择 与标题同一行，尺寸和位置沿用卡片工作台原来的「刷新 / 清空全部」。
  const title = page.locator('[data-gallery-title]')
  await title.waitFor()
  assert.match(await title.innerText(), /画廊（插件 2 张/, JSON.stringify(await title.innerText()))
  const titleBox = await title.boundingBox()
  const actionBoxes = []
  for (const action of ['refresh', 'preview-all', 'select']) {
    const box = await page.locator(`[data-gallery-action="${action}"]`).boundingBox()
    assert.ok(box, `${action} 按钮应当存在`)
    assert.ok(box.y < titleBox.y + titleBox.height + 6, `${action} 与标题同一行`)
    assert.ok(box.x > titleBox.x + titleBox.width, `${action} 在标题右侧`)
    actionBoxes.push(box)
  }
  assert.ok(actionBoxes.every(box => Math.round(box.height) === Math.round(actionBoxes[0].height)), '三个按钮是同一套尺寸')
  assert.ok(actionBoxes[0].height <= 30, '按钮按卡片工作台的小号样式，不是设置页的大按钮：' + actionBoxes[0].height)
  assert.ok(actionBoxes[0].x - (titleBox.x + titleBox.width) <= 24, '按钮紧跟标题，不能靠撑开空隙推到最右端')

  // 游玩画廊：回收站里的图不出现，说明行右侧有收藏，右上角有回收。
  assert.equal(await page.locator('[data-gallery-key="play:play-a"]').count(), 1)
  assert.equal(await page.locator('[data-gallery-key="play:play-c"]').count(), 0, '回收站里的图不出现在游玩画廊')

  // 卡片画廊：图块结构和游玩画廊一致。
  await page.getByRole('button', {name: '卡片画廊', exact: true}).click()
  await page.locator('[data-gallery-key="card:card-a"]').waitFor()
  assert.equal(await page.locator('[data-gallery-key="card:card-c"]').count(), 0, '回收站里的图不出现在卡片画廊')
  assert.match(await title.innerText(), /卡片画廊（2 张）/)
  // 每行固定三张，不随面板宽度在 3 / 4 之间来回跳。
  const columns = await page.locator('[data-gallery-key]').first().evaluate(el => getComputedStyle(el.parentElement).gridTemplateColumns.split(' ').filter(Boolean).length)
  assert.equal(columns, 3, '图块每行固定三张')
  const tile = page.locator('[data-gallery-key="card:card-a"]')
  const tileBox = await tile.boundingBox()
  const removeBox = await tile.locator('button[aria-label^="回收"]').boundingBox()
  assert.ok(removeBox, '卡片图也要有回收按钮')
  assert.ok(removeBox.x > tileBox.x + tileBox.width * 0.6, '回收按钮在图片右上角')
  assert.ok(removeBox.y < tileBox.y + tileBox.height * 0.3, '回收按钮在图片右上角')
  assert.equal(await tile.locator('button[aria-label^="回收"] svg').count(), 1, '回收按钮用内联 SVG 图标，不靠字体字形')
  const favoriteBox = await tile.locator('button[aria-label^="收藏"]').boundingBox()
  const promptBox = await tile.locator('button[aria-label^="查看提示词"]').boundingBox()
  assert.ok(favoriteBox && promptBox, '卡片图要有收藏和提示词按钮')
  assert.ok(favoriteBox.x > tileBox.x + tileBox.width * 0.5, '收藏在说明行右侧')
  assert.ok(favoriteBox.y < promptBox.y, '收藏在提示词那一行上面')
  for (const label of ['查看负面词', '图生图']) {
    assert.equal(await tile.locator(`[aria-label^="${label}"]`).count(), 1, `卡片图要有${label}按钮`)
  }

  // 收藏 / 回收站发到卡片工作台的接口，并且真的更新记录。
  await tile.locator('button[aria-label^="收藏"]').click()
  await page.waitForFunction(() => !document.querySelector('[data-gallery-key="card:card-a"] button[aria-label^="收藏"]'))
  assert.deepEqual(cardWrites.at(-1), {id: 'card-a', operation: 'favorite'})
  await tile.locator('button[aria-label^="回收"]').click()
  await page.waitForFunction(() => !document.querySelector('[data-gallery-key="card:card-a"]'))
  assert.deepEqual(cardWrites.at(-1), {id: 'card-a', operation: 'trash'})

  // 收藏视图：两个来源的收藏图一起出现。
  await page.getByRole('button', {name: '收藏', exact: true}).click()
  await page.locator('[data-gallery-key="play:play-b"]').waitFor()
  assert.equal(await page.locator('[data-gallery-key="card:card-b"]').count(), 1, '卡片画廊的收藏也要出现在收藏里')
  assert.match(await title.innerText(), /收藏（2 张）/)
  const favoriteGroups = await page.locator('[data-gallery-group]').allInnerTexts()
  assert.ok(favoriteGroups.some(text => text.startsWith('游玩 · ')), JSON.stringify(favoriteGroups))
  assert.ok(favoriteGroups.some(text => text.startsWith('卡片 · ')), JSON.stringify(favoriteGroups))

  // 回收站视图：两个来源的图 + 恢复按钮 + 清空回收站。
  await page.getByRole('button', {name: '回收站', exact: true}).click()
  await page.locator('[data-gallery-key="play:play-c"]').waitFor()
  assert.equal(await page.locator('[data-gallery-key="card:card-c"]').count(), 1, '卡片画廊的回收站也并进来')
  assert.equal(await page.locator('[data-gallery-key="card:card-a"]').count(), 1, '刚移到回收站的卡片图也在里面')
  assert.match(await title.innerText(), /回收站（3 张）/)
  assert.equal(await page.getByRole('button', {name: '清空回收站', exact: true}).count(), 1)
  assert.equal(await page.locator('[data-gallery-key="play:play-c"] button[aria-label^="恢复"]').count(), 1, '回收站里的图块按钮变成恢复')
  assert.equal(await page.locator('[data-gallery-key="play:play-c"] button[aria-label^="恢复"]').innerText(), '↩', '恢复用单色回退箭头，不写字也不带 emoji 色块')

  assert.deepEqual(errors, [], '页面不应该有未捕获的报错')
  console.log('gallery views browser smoke: ok')
} finally {
  await browser.close()
}
