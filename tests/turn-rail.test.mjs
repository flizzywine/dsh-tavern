// 楼层跳转（modules/turn-rail.js）：照页面上的故事楼层画刻度，点哪根滚哪层。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const source = readFileSync(new URL('../tavern-plugin/src/client/modules/turn-rail.js', import.meta.url), 'utf8')
// 刻度那条 rail 的样式：窄屏收起靠 hidden，落脚点在右边居中（不定位时也不会掉到页面末尾）。
const railCss = readFileSync(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  .split('/* ---------- 楼层跳转')[1].split('/* ── 导出与导入')[0]

// 页面结构：会话滚动区 → 宿主那列 turn 刻度 + 故事楼层行（每层带 data-floor）。
function page(floors, options = {}) {
  const marks = (options.marks || [1, 2, 3]).map(turn => `<button class="_9dNBWq_mark" aria-label="跳转到第 ${turn} 轮"></button>`).join('')
  const rows = floors.map(([floor, top]) => `<article data-story-row data-floor="${floor}" data-role="assistant" data-row="${floor}">第 ${floor} 楼正文</article>`).join('')
  const dom = new JSDOM(`<body><style>${railCss}</style><div data-conversation-scroll><nav aria-label="轮次导航">${marks}</nav><div class="dsh-tavern-story-older"><button type="button">加载更早</button></div>${rows}</div></body>`, { pretendToBeVisual: true })
  const scope = dom.window.document.querySelector('[data-conversation-scroll]')
  const box = { left: 20, right: options.narrow ? 700 : 1200, top: 40, bottom: 640, width: options.narrow ? 680 : 1180, height: 600 }
  scope.getBoundingClientRect = () => box
  for (const [floor, top] of floors) {
    const row = scope.querySelector('[data-floor="' + floor + '"]')
    let topNow = top
    row.getBoundingClientRect = () => ({ height: 100, width: 400, top: topNow, bottom: topNow + 100, left: 0, right: 400 })
    row.scrollIntoView = () => { scope.dataset.scrolledTo = String(floor) }
    row.moveTo = function (next) { topNow = next }
  }
  const context = vm.createContext({ window: dom.window, document: dom.window.document })
  vm.runInContext(source, context)
  return { dom, document: dom.window.document, scope, create: context.createStoryFloorRail }
}

const tickFloors = document => [...document.querySelectorAll('.dsh-tavern-turn-rail [data-floor]')].map(node => Number(node.getAttribute('data-floor')))
const activeFloors = document => [...document.querySelectorAll('.dsh-tavern-turn-rail [data-active]')].map(node => Number(node.getAttribute('data-floor')))

test('一层一根刻度，点哪根就滚到哪一层的开头', t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140], [3, 240]])
  t.after(() => dom.window.close())
  const rail = create(scope)
  rail.apply()
  assert.deepEqual(tickFloors(document), [1, 2, 3], '每层一根')
  const tick = document.querySelector('.dsh-tavern-turn-rail [data-floor="2"]')
  assert.equal(tick.getAttribute('aria-label'), '跳到第 2 楼')
  tick.click()
  assert.equal(scope.dataset.scrolledTo, '2', '直接滚到第 2 层')
  rail.dispose()
})

test('当前楼层跟着滚动走：滚过顶部的那一层亮起来', t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140], [3, 240]])
  t.after(() => dom.window.close())
  const rail = create(scope)
  rail.apply()
  assert.deepEqual(activeFloors(document), [1], '没滚动时第一层是当前层')
  scope.querySelector('[data-floor="2"]').moveTo(-40)
  rail.sync()
  assert.deepEqual(activeFloors(document), [2], '滚过顶部后当前层跟着走')
  rail.dispose()
})

test('脚本还没定位时也落在右边居中，不会掉到页面末尾', t => {
  const dom = new JSDOM(`<body><style>${railCss}</style><nav class="dsh-tavern-turn-rail"></nav></body>`, { pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const style = dom.window.getComputedStyle(dom.window.document.querySelector('.dsh-tavern-turn-rail'))
  assert.equal(style.right, '12px', '默认贴着右边')
  assert.equal(style.top, '50%', '默认竖向居中')
})

test('楼层重画时刻度跟着重建，不是故事行的元素不算楼层', t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140]])
  t.after(() => dom.window.close())
  const rail = create(scope)
  rail.apply()
  assert.deepEqual(tickFloors(document), [1, 2])
  const extra = document.createElement('article')
  extra.setAttribute('data-story-row', '')
  extra.setAttribute('data-floor', '3')
  scope.appendChild(extra)
  rail.sync()
  assert.deepEqual(tickFloors(document), [1, 2, 3], '新楼层出现后加一根刻度')
  const notFloor = document.createElement('div')
  notFloor.setAttribute('data-turn', '9')
  scope.appendChild(notFloor)
  rail.sync()
  assert.deepEqual(tickFloors(document), [1, 2, 3], '没有 data-floor 的行不算楼层')
  rail.dispose()
})

test('宿主那列 turn 刻度收起来，免得两列并排', t => {
  const { dom, document, scope, create } = page([[1, 40]])
  t.after(() => dom.window.close())
  const rail = create(scope)
  rail.apply()
  assert.ok(document.querySelector('nav[aria-label="轮次导航"]').hasAttribute('data-dsh-tavern-rail-hidden'), '宿主刻度被收起')
  rail.dispose()
  assert.equal(document.querySelector('nav[aria-label="轮次导航"]').hasAttribute('data-dsh-tavern-rail-hidden'), false, '卸下后还原')
})

test('窄屏画紧凑刻度：贴右边，不落在页面末尾', t => {
  const narrow = page([[1, 40], [2, 140], [3, 240]], { narrow: true })
  t.after(() => narrow.dom.window.close())
  const rail = narrow.create(narrow.scope)
  rail.apply()
  const box = narrow.document.querySelector('.dsh-tavern-turn-rail')
  const style = narrow.dom.window.getComputedStyle(box)
  assert.equal(box.hidden, false, '窄屏也看得见')
  assert.notEqual(style.display, 'none', 'display:flex 不该把刻度藏起来')
  assert.equal(box.hasAttribute('data-compact'), true, '窄屏用紧凑版')
  assert.deepEqual(tickFloors(narrow.document), [1, 2, 3], '每层一根照旧')
  // 位置由 place() 写成行内样式：贴右边（不是 body 末尾的静态位置），竖向居中。
  assert.equal(box.style.right, (narrow.dom.window.innerWidth - 700) + 10 + 'px', '窄屏离右边 10px，避开系统边缘手势')
  assert.equal(box.style.top, 340 + 'px', '在滚动区里居中')
  rail.dispose()

  const wide = page([[1, 40]])
  t.after(() => wide.dom.window.close())
  const roomy = wide.create(wide.scope)
  roomy.apply()
  const wideBox = wide.document.querySelector('.dsh-tavern-turn-rail')
  assert.equal(wideBox.hasAttribute('data-compact'), false, '宽屏还是原来那列')
  assert.equal(wideBox.style.right, Math.max(0, wide.dom.window.innerWidth - 1200) + 12 + 'px', '宽屏离右边 12px')
  roomy.dispose()
})

test('紧凑版最多 14 根：层数多了隔层取样，首末层总在', t => {
  const tall = page(Array.from({ length: 30 }, (_, index) => [index + 1, index * 120]), { narrow: true })
  t.after(() => tall.dom.window.close())
  const rail = tall.create(tall.scope)
  rail.apply()
  const floors = tickFloors(tall.document)
  assert.ok(floors.length <= 14, '整列不长到需要自己滚：' + floors.length)
  assert.equal(floors[0], 1, '第一层在')
  assert.equal(floors[floors.length - 1], 30, '最后一层在')
  assert.deepEqual([...floors].sort((a, b) => a - b), floors, '仍按楼层递增')
  rail.dispose()
})

test('手指滑过不算点：按下后移动超过 8px 的那次点击不跳转', t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140], [3, 240]])
  t.after(() => dom.window.close())
  const rail = create(scope)
  rail.apply()
  const tick = document.querySelector('.dsh-tavern-turn-rail [data-floor="2"]')
  const pointer = (type, clientY) => tick.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientY }))
  pointer('pointerdown', 300)
  pointer('pointermove', 340)
  tick.click()
  assert.equal(scope.dataset.scrolledTo, undefined, '滑过时不跳')

  pointer('pointerdown', 300)
  tick.click()
  assert.equal(scope.dataset.scrolledTo, '2', '按稳了才跳')
  rail.dispose()
})

test('跳完能撤回：目标层闪一下，点「回到刚才」回到原处', t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140], [3, 240]])
  t.after(() => dom.window.close())
  scope.scrollTo = null // jsdom 没有元素滚动实现，走 scrollTop 分支
  const rail = create(scope)
  rail.apply()
  scope.scrollTop = 480
  document.querySelector('.dsh-tavern-turn-rail [data-floor="3"]').click()
  assert.ok(document.querySelector('[data-floor="3"]').hasAttribute('data-floor-flash'), '目标层闪一下')
  const undo = document.querySelector('.dsh-tavern-turn-rail-undo')
  assert.ok(undo, '给了「回到刚才」')
  scope.scrollTop = 900
  undo.click()
  assert.equal(scope.scrollTop, 480, '回到跳之前的 scrollTop')
  assert.equal(document.querySelector('.dsh-tavern-turn-rail-undo'), null, '撤回后自己收起')
  rail.dispose()
})

test('没有楼层时不画刻度', t => {
  const empty = page([], {})
  t.after(() => empty.dom.window.close())
  const rail = empty.create(empty.scope)
  rail.apply()
  assert.equal(empty.document.querySelector('.dsh-tavern-turn-rail'), null, '没有楼层就没有刻度')
  rail.dispose()
})
