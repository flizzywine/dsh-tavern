import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const root = new URL('../docs/', import.meta.url)
const html = await readFile(new URL('product.html', root), 'utf8')

test('产品页可作为静态目录发布，所有本地图片、样式、脚本和锚点存在', async () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
  assert.equal(new Set(ids).size, ids.length, 'HTML ids are unique')
  for (const [, value] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (value.startsWith('https://')) continue
    assert.ok(!value.startsWith('/'), 'assets must work beneath a GitHub Pages project path')
    if (value.startsWith('#')) { if (value.length > 1) assert.ok(ids.includes(value.slice(1)), value); continue }
    await access(new URL(value, root))
  }
  for (const [, attrs] of html.matchAll(/<img\b([^>]+)>/g)) assert.match(attrs, /alt="[^"]+"/)
})

test('完整功能在 HTML 中，无需脚本；预设不再标为实验性，不暴露兼容模式入口', () => {
  assert.equal((html.match(/<details id="catalog-/g) || []).length, 10)
  for (const term of ['PNG / JSON', '历史正文', 'MVU', '长期偏好', '造型参考', '纯对话 TXT', '系统提示词', '联网搜索', 'API 密钥']) assert.ok(html.includes(term), term)
  assert.doesNotMatch(html, /预设库（实验性）|开启兼容模式|绝对不会掉格式|保证永不失忆/)
  assert.match(html, /这里是产品介绍页/)
  assert.match(html, /截图.*|演示截图/)
  assert.match(html, /og:image.*flizzywine\.github\.io\/dsh-tavern\/assets\/social\.png/)
})

test('高级功能分别介绍后台人物设计和互联网搜索，不与改卡及历史回忆混同', () => {
  assert.match(html, /<h4>后台人物设计<\/h4>/)
  assert.match(html, /不是手动改卡或用户画像/)
  assert.match(html, /需要匹配人物卡的变量结构/)
  assert.match(html, /<h4>互联网搜索<\/h4>/)
  assert.match(html, /酒馆设置 → 开启联网搜索/)
  assert.match(html, /与找回本局前文的历史回忆不同/)
  assert.match(html, /修改设置不改变已有游戏/)
})

test('目录链接及直接访问锚点会展开对应功能', async () => {
  const detail = { tagName: 'DETAILS', open: false }
  const events = {}
  const linkEvents = {}
  const link = { hash: '#catalog-images', addEventListener: (event, fn) => { linkEvents[event] = fn } }
  const context = { document: { querySelectorAll: () => [link], getElementById: id => id === 'catalog-images' ? detail : null }, window: { location: { hash: '#catalog-images' }, addEventListener: (event, fn) => { events[event] = fn } } }
  vm.runInNewContext(await readFile(new URL('assets/product.js', root), 'utf8'), context)
  assert.equal(detail.open, true)
  detail.open = false; linkEvents.click(); assert.equal(detail.open, true)
  detail.open = false; events.hashchange(); assert.equal(detail.open, true)
  context.window.location.hash = '#missing'; assert.doesNotThrow(events.hashchange)
})
