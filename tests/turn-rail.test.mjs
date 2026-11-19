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

// 一次「点」：pointerdown → pointerup（刻度以 pointerup 为准，不看浏览器合成的 click）。
// pointerType 决定要不要双击：touch / pen 要点两下，mouse 一下就到。
function pointer(win, node, type, { clientY = 100, pointerType = 'touch' } = {}) {
  const event = new win.MouseEvent(type, { bubbles: true, clientY })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  node.dispatchEvent(event)
}
function tap(win, node, options = {}) {
  pointer(win, node, 'pointerdown', options)
  pointer(win, node, 'pointerup', options)
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
  tap(dom.window, tick, { pointerType: 'mouse' })
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
  const fire = (type, clientY) => pointer(dom.window, tick, type, { clientY, pointerType: 'mouse' })
  fire('pointerdown', 300)
  fire('pointermove', 340)
  fire('pointerup', 340)
  assert.equal(scope.dataset.scrolledTo, undefined, '滑过时不跳')

  fire('pointerdown', 300)
  fire('pointerup', 300)
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
  tap(dom.window, document.querySelector('.dsh-tavern-turn-rail [data-floor="3"]'), { pointerType: 'mouse' })
  assert.ok(document.querySelector('[data-floor="3"]').hasAttribute('data-floor-flash'), '目标层闪一下')
  const undo = document.querySelector('.dsh-tavern-turn-rail-undo')
  assert.ok(undo, '给了「回到刚才」')
  scope.scrollTop = 900
  undo.click()
  assert.equal(scope.scrollTop, 480, '回到跳之前的 scrollTop')
  assert.equal(document.querySelector('.dsh-tavern-turn-rail-undo'), null, '撤回后自己收起')
  rail.dispose()
})

test('窄屏要双击：第一下只选定，第二下才跳', async t => {
  const narrow = page([[1, 40], [2, 140], [3, 240]], { narrow: true })
  t.after(() => narrow.dom.window.close())
  const rail = narrow.create(narrow.scope, { armMs: 40 })
  rail.apply()
  const tick = narrow.document.querySelector('.dsh-tavern-turn-rail [data-floor="2"]')
  const doTap = () => tap(narrow.dom.window, tick)
  doTap()
  assert.equal(narrow.scope.dataset.scrolledTo, undefined, '第一下不跳')
  assert.ok(tick.hasAttribute('data-armed'), '刻度进入选定态')
  const hint = narrow.document.querySelector('.dsh-tavern-turn-rail-hint')
  assert.equal(hint.textContent, '再点一下 · 第 2 楼', '边上提示再点一下')
  assert.equal(hint.style.pointerEvents, '', '提示样式由 CSS 管，不吃点击')

  doTap()
  assert.equal(narrow.scope.dataset.scrolledTo, '2', '第二下真的跳')
  assert.equal(tick.hasAttribute('data-armed'), false, '跳完清掉选定')
  assert.equal(narrow.document.querySelector('.dsh-tavern-turn-rail-hint'), null, '提示收起')
  rail.dispose()
})

test('窄屏第一下选定后超时自己取消', async t => {
  const narrow = page([[1, 40], [2, 140]], { narrow: true })
  t.after(() => narrow.dom.window.close())
  const rail = narrow.create(narrow.scope, { armMs: 30 })
  rail.apply()
  const tick = narrow.document.querySelector('.dsh-tavern-turn-rail [data-floor="2"]')
  tap(narrow.dom.window, tick)
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(tick.hasAttribute('data-armed'), false, '过时不亮')
  assert.equal(narrow.document.querySelector('.dsh-tavern-turn-rail-hint'), null, '提示也跟着收')
  assert.equal(narrow.scope.dataset.scrolledTo, undefined, '始终没跳')
  rail.dispose()
})

test('窄屏里键盘按 Enter 不等第二下', t => {
  const narrow = page([[1, 40], [2, 140]], { narrow: true })
  t.after(() => narrow.dom.window.close())
  const rail = narrow.create(narrow.scope)
  rail.apply()
  const tick = narrow.document.querySelector('.dsh-tavern-turn-rail [data-floor="2"]')
  tick.dispatchEvent(new narrow.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
  assert.equal(narrow.scope.dataset.scrolledTo, '2', '键盘一下就跳')
  assert.equal(narrow.document.querySelector('.dsh-tavern-turn-rail-hint'), null, '不弹提示')
  rail.dispose()
})

test('鼠标一下就到，不用双击', t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140]])
  t.after(() => dom.window.close())
  const rail = create(scope)
  rail.apply()
  tap(dom.window, document.querySelector('.dsh-tavern-turn-rail [data-floor="2"]'), { pointerType: 'mouse' })
  assert.equal(scope.dataset.scrolledTo, '2', '鼠标一下就到')
  assert.equal(document.querySelector('.dsh-tavern-turn-rail-hint'), null, '不弹双击提示')
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

// 宿主切会话 / 重挂会话视图时会把 [data-conversation-scroll] 整棵换成新节点。传进来的 root
// 还指着旧节点：旧节点脱离文档后量到的宽高是 0，刻度列会被判成看不见，而且再没有尺寸变化或
// 滚动事件把它叫回来 —— 表现就是「一会有一会没有」。同步时要回到当前那个滚动容器。
test('宿主换掉滚动容器后，刻度列跟着回到新容器', t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140]])
  t.after(() => dom.window.close())
  const rail = create(scope.querySelector('[data-story-row]'))
  rail.apply()
  assert.deepEqual(tickFloors(document), [1, 2], '先照旧容器画刻度')

  const fresh = document.createElement('div')
  fresh.setAttribute('data-conversation-scroll', '')
  fresh.innerHTML = '<article data-story-row data-floor="10" data-role="assistant">第 10 楼</article><article data-story-row data-floor="11" data-role="assistant">第 11 楼</article>'
  fresh.getBoundingClientRect = () => ({ left: 0, right: 1200, top: 0, bottom: 700, width: 1200, height: 700 })
  for (const row of fresh.querySelectorAll('[data-story-row]')) row.getBoundingClientRect = () => ({ height: 100, width: 400, top: 0, bottom: 100, left: 0, right: 400 })
  scope.replaceWith(fresh)

  rail.sync()
  assert.deepEqual(tickFloors(document), [10, 11], '刻度跟着新容器里的楼层重画')
  const nav = document.querySelector('.dsh-tavern-turn-rail')
  assert.notEqual(nav.hasAttribute('hidden'), true, '刻度列没有跟着旧节点一起消失')
  assert.notEqual(nav.style.display, 'none', '也不该被 display:none 藏起来')
  rail.dispose()
})

// 页面一时量到 0 宽（会话列被折叠、窗口暂时藏起来）时先收起；尺寸没变、也没滚动时，
// 自己补一次迟到复查，别让刻度列一直藏着等人滚一下才回来。
test('容器一度量不到尺寸时，刻度列迟一点自己回来', async t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140]])
  t.after(() => dom.window.close())
  const narrowBox = { left: 0, right: 0, top: 0, bottom: 700, width: 0, height: 700 }
  const rail = create(scope)
  rail.apply()
  scope.getBoundingClientRect = () => narrowBox
  rail.sync()
  const nav = document.querySelector('.dsh-tavern-turn-rail')
  assert.equal(nav.hasAttribute('hidden'), true, '量不到宽度时先收起')
  scope.getBoundingClientRect = () => ({ left: 0, right: 1200, top: 0, bottom: 700, width: 1200, height: 700 })
  await new Promise(resolve => dom.window.setTimeout(resolve, 520))
  assert.notEqual(nav.hasAttribute('hidden'), true, '不用滚动也应该自己回来')
  rail.dispose()
})

// 移动端软键盘弹起、切后台或面板遮挡超过 2.4 秒后，recheck() 的 6 次重试会耗尽；
// 之后收起键盘（visualViewport.resize）或切回前台（visibilitychange）时要重置重试并把刻度恢复出来。
test('重试耗尽后，visualViewport 变化或页面恢复可见时刻度列能重新出现', t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140]], { narrow: true })
  t.after(() => dom.window.close())

  const viewport = new dom.window.EventTarget()
  Object.defineProperty(dom.window, 'visualViewport', { value: viewport, configurable: true })

  let nextId = 1
  const timers = new Map()
  dom.window.setTimeout = (fn, delay) => {
    const id = nextId++
    timers.set(id, { fn, delay })
    return id
  }
  dom.window.clearTimeout = id => { timers.delete(id) }
  const flushTimers = () => {
    const batch = Array.from(timers.entries())
    timers.clear()
    for (const [, entry] of batch) entry.fn()
  }

  let rect = { left: 0, right: 390, top: 40, bottom: 640, width: 390, height: 600 }
  scope.getBoundingClientRect = () => rect

  const rail = create(scope)
  rail.apply()
  const nav = document.querySelector('.dsh-tavern-turn-rail')
  assert.equal(nav.hasAttribute('hidden'), false, '初始窄屏应显示刻度列')

  // 模拟软键盘长期遮挡（height <= 96）超过 6 轮 400ms 复查，使 retries 达到上限
  rect = { left: 0, right: 390, top: 0, bottom: 64, width: 390, height: 64 }
  rail.sync()
  for (let i = 0; i < 8; i++) flushTimers()
  assert.equal(nav.hasAttribute('hidden'), true, '高度不足时收起')
  assert.equal(timers.size, 0, '超过 6 次后停止无止境轮询')

  // 收起软键盘只触发 visualViewport.resize，即使不触发 window.resize 也要能唤醒并恢复
  rect = { left: 0, right: 390, top: 40, bottom: 640, width: 390, height: 600 }
  viewport.dispatchEvent(new dom.window.Event('resize'))
  flushTimers()
  assert.equal(nav.hasAttribute('hidden'), false, 'visualViewport 恢复后刻度列重新显示')
  assert.equal(nav.style.display, '', '清除 display:none')

  // 再次耗尽重试后，通过 visibilitychange 回到前台也应恢复
  rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }
  rail.sync()
  for (let i = 0; i < 8; i++) flushTimers()
  assert.equal(nav.hasAttribute('hidden'), true)
  rect = { left: 0, right: 390, top: 40, bottom: 640, width: 390, height: 600 }
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  document.dispatchEvent(new dom.window.Event('visibilitychange'))
  flushTimers()
  assert.equal(nav.hasAttribute('hidden'), false, '页面重新可见后刻度列重新显示')
  rail.dispose()
})

// StoryFloorRailHost 先于滚动容器挂载、或宿主稍后替换 [data-conversation-scroll] 时，
// 不需要额外滚动或手动调用 sync()，刻度列自己接上新容器并显示。
test('滚动容器晚到挂载以及无感知整棵替换时，刻度列自动恢复', async t => {
  const dom = new JSDOM('<body><div id="host"></div></body>', { pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const { document } = dom.window
  const context = vm.createContext({ window: dom.window, document })
  vm.runInContext(source, context)

  const rail = context.createStoryFloorRail(null)
  rail.apply()
  assert.equal(document.querySelector('.dsh-tavern-turn-rail'), null, '尚未挂载容器时不画空刻度')

  const makeScope = floors => {
    const el = document.createElement('div')
    el.setAttribute('data-conversation-scroll', '')
    el.getBoundingClientRect = () => ({ left: 0, right: 390, top: 40, bottom: 640, width: 390, height: 600 })
    el.innerHTML = floors.map(f => `<article data-story-row data-floor="${f}" data-role="assistant">第 ${f} 楼</article>`).join('')
    for (const row of el.querySelectorAll('[data-story-row]')) {
      row.getBoundingClientRect = () => ({ height: 100, width: 360, top: 40, bottom: 140, left: 0, right: 360 })
    }
    return el
  }

  const hostEl = document.getElementById('host')
  const first = makeScope([1, 2])
  hostEl.appendChild(first)
  await new Promise(resolve => dom.window.setTimeout(resolve, 180))
  assert.deepEqual(tickFloors(document), [1, 2], '容器延迟挂载后自动画出刻度')
  assert.equal(document.querySelector('.dsh-tavern-turn-rail').hasAttribute('hidden'), false)

  const second = makeScope([10, 11, 12])
  first.replaceWith(second)
  await new Promise(resolve => dom.window.setTimeout(resolve, 180))
  assert.deepEqual(tickFloors(document), [10, 11, 12], '容器被替换后不靠滚动也自动切换到新楼层')
  assert.equal(document.querySelector('.dsh-tavern-turn-rail').hasAttribute('hidden'), false)
  rail.dispose()
})

// 页面中同时存在隐藏的 0×0 滚动容器和真正可见的滚动容器时，优先选中可见容器而非藏死。
test('存在隐藏的 0×0 滚动容器时，优先选中可见的滚动容器', t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140]], { narrow: true })
  t.after(() => dom.window.close())

  const ghost = document.createElement('div')
  ghost.setAttribute('data-conversation-scroll', '')
  ghost.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })
  document.body.insertBefore(ghost, scope)

  const rail = create(ghost)
  rail.apply()
  assert.deepEqual(tickFloors(document), [1, 2], '绕开 0×0 隐藏容器，从可见容器读取楼层')
  const nav = document.querySelector('.dsh-tavern-turn-rail')
  assert.equal(nav.hasAttribute('hidden'), false, '刻度列可见')
  rail.dispose()
})

// 常驻 [data-conversation-scroll] 来回切换会话（A -> B -> A），且 React 原地复用 <article> 修改 data-floor、
// 或 header 与故事流同时持有 acquireStoryFloorRail 租约时：刻度列不重影、不错绑旧会话、切回后不消失。
test('常驻滚动容器来回切换会话与原地复用楼层节点时，刻度列始终保留且归属正确', async t => {
  const dom = new JSDOM(
    `<body><style>${railCss}</style>` +
    '<div data-conversation-content="" data-conversation-session="session-a">' +
    '<div data-conversation-scroll=""><nav aria-label="轮次导航"><button class="_9dNBWq_mark" aria-label="跳转到第 1 轮"></button></nav>' +
    '<article data-story-row data-floor="1" data-role="assistant">A1</article>' +
    '<article data-story-row data-floor="2" data-role="assistant">A2</article>' +
    '<article data-story-row data-floor="3" data-role="assistant">A3</article>' +
    '</div></div></body>',
    { pretendToBeVisual: true }
  )
  t.after(() => dom.window.close())
  const { document } = dom.window
  const content = document.querySelector('[data-conversation-content]')
  const scope = document.querySelector('[data-conversation-scroll]')
  scope.getBoundingClientRect = () => ({ left: 0, right: 390, top: 40, bottom: 640, width: 390, height: 600 })
  const wireRowRects = () => {
    let idx = 0
    for (const row of scope.querySelectorAll('[data-story-row]')) {
      const top = 40 + (idx++) * 120
      row.getBoundingClientRect = () => ({ left: 0, right: 360, top, bottom: top + 100, width: 360, height: 100 })
      row.scrollIntoView = () => { scope.dataset.scrolledTo = row.getAttribute('data-floor') || '' }
    }
  }
  wireRowRects()
  const context = vm.createContext({ window: dom.window, document })
  vm.runInContext(source, context)

  // header 插槽与故事列表同时申请同一会话租约：只创建一条刻度列。
  const headerLeaseA = context.acquireStoryFloorRail('session-a')
  const flowLeaseA = context.acquireStoryFloorRail('session-a')
  assert.equal(document.querySelectorAll('.dsh-tavern-turn-rail').length, 1, '同一会话多租约不产生重复刻度列')
  assert.deepEqual(tickFloors(document), [1, 2, 3])
  assert.equal(document.querySelector('nav[aria-label="轮次导航"]').hasAttribute('data-dsh-tavern-rail-hidden'), true)

  // 切去 session-b：常驻容器只改 data-conversation-session 属性，且假设旧会话 A 的第二个租约稍晚释放。
  content.setAttribute('data-conversation-session', 'session-b')
  const articles = [...scope.querySelectorAll('[data-story-row]')]
  articles[0].setAttribute('data-floor', '1')
  articles[1].removeAttribute('data-floor') // 原地复用了节点（变成用户行）
  articles[2].setAttribute('data-floor', '2')
  headerLeaseA.release()
  const flowLeaseB = context.acquireStoryFloorRail('session-b')
  await new Promise(resolve => dom.window.setTimeout(resolve, 160))
  flowLeaseA.release()

  assert.equal(document.querySelectorAll('.dsh-tavern-turn-rail').length, 1, '旧会话退场不留残余也不误删新会话刻度列')
  assert.deepEqual(tickFloors(document), [1, 2], '原地改 data-floor 属性也能重算新会话楼层')
  assert.equal(document.querySelector('nav[aria-label="轮次导航"]').hasAttribute('data-dsh-tavern-rail-hidden'), true, '旧会话释放不把新会话的宿主导航还原出来')

  // 再切回 session-a（模拟缓存命中原地恢复 data-floor + 派发故事渲染事件，且无滚动事件）。
  content.setAttribute('data-conversation-session', 'session-a')
  articles[0].setAttribute('data-floor', '1')
  articles[1].setAttribute('data-floor', '2')
  articles[2].setAttribute('data-floor', '3')
  flowLeaseB.release()
  const backLeaseA = context.acquireStoryFloorRail('session-a')
  dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-tavern-story-floors-rendered', { detail: { sessionId: 'session-a', floorCount: 3 } }))
  await new Promise(resolve => dom.window.setTimeout(resolve, 160))

  const nav = document.querySelector('.dsh-tavern-turn-rail')
  assert.ok(nav, '来回切回会话 A 后刻度列仍在')
  assert.equal(nav.hasAttribute('hidden'), false, '刻度列保持可见，不随机消失')
  assert.deepEqual(tickFloors(document), [1, 2, 3])
  backLeaseA.release()
})

// 移动端抽屉/遮罩长时间覆盖超过 6 次重试后，关闭抽屉时 MutationObserver 在容器已恢复尺寸之后才回调：
// 过去 hasScopeChange 因 scopeVisible 已为 true 而漏掉唤醒，现在看 railHidden 状态能立即恢复显示。
test('抽屉遮挡耗尽重试后，关闭抽屉触发 DOM/属性变更时刻度列无需滚动立即恢复', async t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140]], { narrow: true })
  t.after(() => dom.window.close())

  let rect = { left: 0, right: 390, top: 40, bottom: 640, width: 390, height: 600 }
  scope.getBoundingClientRect = () => rect
  const backdrop = document.createElement('div')
  backdrop.className = 'mobile-drawer-backdrop'
  document.body.appendChild(backdrop)

  const rail = create(scope)
  rail.apply()
  const nav = document.querySelector('.dsh-tavern-turn-rail')
  assert.equal(nav.hasAttribute('hidden'), false)

  // 遮挡期间耗尽全部 6 次 400ms 复查（这里缩短用假时钟排空）
  const realSetTimeout = dom.window.setTimeout.bind(dom.window)
  const realClearTimeout = dom.window.clearTimeout.bind(dom.window)
  let nextId = 1
  const timers = new Map()
  dom.window.setTimeout = (fn, delay) => { const id = nextId++; timers.set(id, fn); return id }
  dom.window.clearTimeout = id => { timers.delete(id) }
  const flush = () => { const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn() }

  rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }
  rail.sync()
  for (let i = 0; i < 8; i++) flush()
  assert.equal(nav.hasAttribute('hidden'), true, '重试耗尽后处于隐藏态')
  assert.equal(timers.size, 0)

  dom.window.setTimeout = realSetTimeout
  dom.window.clearTimeout = realClearTimeout

  // 关闭抽屉：浏览器先恢复容器布局尺寸，再投递遮罩节点移除的 MutationObserver 回调（无 scroll / resize）。
  rect = { left: 0, right: 390, top: 40, bottom: 640, width: 390, height: 600 }
  backdrop.remove()
  await new Promise(resolve => realSetTimeout(resolve, 180))
  assert.equal(nav.hasAttribute('hidden'), false, '关闭抽屉后无需手动滑动即可恢复显示')
  assert.equal(nav.style.display, '')
  rail.dispose()
})

// 页面其他地方（舞台每帧改 style/class）的变更不该每批都量一次滚动容器：getBoundingClientRect 会强制排版，
// 手机上把主线程占满。变更落在滚动容器里时一次都不量；在容器外时，有 ResizeObserver（浏览器里都有）也不量，
// 容器尺寸变化交给它；没有时一批至多量一次。
for (const observer of [false, true]) test('页面别处频繁改样式时，不为每批变更量一次滚动容器' + (observer ? '（有 ResizeObserver）' : ''), async t => {
  const { dom, document, scope, create } = page([[1, 40], [2, 140]])
  t.after(() => dom.window.close())
  if (observer) dom.window.ResizeObserver = class { observe() {} disconnect() {} }
  const rail = create(scope)
  rail.apply()
  let measured = 0
  const box = scope.getBoundingClientRect()
  scope.getBoundingClientRect = () => { measured++; return box }
  const row = scope.querySelector('[data-floor="1"]')
  for (let i = 0; i < 20; i++) { row.className = 'typing-' + i; await new Promise(resolve => dom.window.setTimeout(resolve, 0)) }
  assert.equal(measured, 0, '滚动容器里的样式变更不量')
  const stage = document.createElement('div')
  document.body.appendChild(stage)
  await new Promise(resolve => dom.window.setTimeout(resolve, 200))
  measured = 0
  for (let i = 0; i < 20; i++) stage.style.opacity = String(i / 20)
  await new Promise(resolve => dom.window.setTimeout(resolve, 0))
  if (observer) assert.equal(measured, 0, '容器外的变更交给 ResizeObserver')
  else assert.ok(measured <= 1, '一批变更至多量一次：' + measured)
  rail.dispose()
})

// 移动端首次未手动滑动对话时点击楼层跳转：
// 1) 默认双击确认窗口（1500ms）容纳正常人类阅读提示再点的间隔（如 600ms）；
// 2) 第二指微抖触发 pointercancel 时由 touchend 兜底，不吞点击；
// 3) 主动向滚动容器派发 beforematch + scroll/scrollend 中断宿主 followingTail 跟尾锁，直接落位 scrollTop，
//    并在按需展开楼层撑高上方内容后自动二次对齐目标楼层。
test('移动端未手动滑动对话时点击楼层跳转：中断跟尾锁、容忍微抖 pointercancel 并精准落位目标楼层', async t => {
  const { dom, document, scope, create } = page([[1, 0], [2, 600], [3, 1800], [4, 3400]], { narrow: true })
  t.after(() => dom.window.close())

  Object.defineProperty(scope, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(scope, 'clientHeight', { configurable: true, value: 600 })
  let scrollHeight = 4000
  let currentScrollTop = 3400
  Object.defineProperty(scope, 'scrollTop', {
    configurable: true,
    get: () => currentScrollTop,
    set: value => { currentScrollTop = value }
  })

  // 各楼层文档纵向偏移：第 1 层展开后会从 200px 涨到 900px，推动第 2 层从 200 下移到 900。
  const offsets = new Map([[1, 0], [2, 200], [3, 1800], [4, 3400]])
  for (const floor of [1, 2, 3, 4]) {
    const row = scope.querySelector(`[data-floor="${floor}"]`)
    row.getBoundingClientRect = () => {
      const top = 40 + offsets.get(floor) - currentScrollTop
      return { left: 0, right: 360, top, bottom: top + 120, width: 360, height: 120 }
    }
    // 模拟移动端 smooth scrollIntoView 被按需挂载打断或未滚动外层容器。
    row.scrollIntoView = () => {}
  }

  // 模拟宿主跟尾锁：未收到 READING_INTENTS (beforematch) 与 scrollend 前，布局变化会把 scrollTop 拉回底部。
  let followingTail = true
  let sawIntent = false
  scope.addEventListener('beforematch', () => { sawIntent = true })
  scope.addEventListener('scrollend', () => {
    if (currentScrollTop < scrollHeight - 600 - 25) followingTail = false
  })
  const hostOnResize = () => {
    if (followingTail) currentScrollTop = scrollHeight - 600
  }

  const rafQueue = []
  dom.window.requestAnimationFrame = fn => { rafQueue.push(fn); return rafQueue.length }
  dom.window.cancelAnimationFrame = () => {}

  const rail = create(scope)
  rail.apply()
  const tick2 = document.querySelector('.dsh-tavern-turn-rail [data-floor="2"]')

  // 第一下触摸点击：进入选定态，经过 600ms 仍未过期（旧版 350ms 已失效导致怎么点都只闪不跳）。
  tap(dom.window, tick2, { pointerType: 'touch', clientY: 220 })
  assert.equal(tick2.hasAttribute('data-armed'), true, '第一下进入选定态')
  await new Promise(resolve => dom.window.setTimeout(resolve, 600))
  assert.equal(tick2.hasAttribute('data-armed'), true, '600ms 后选定态仍在，够读完提示再点第二下')

  // 第二下触摸：手指微移 4px（<= 8px tapSlop）但内核抢发了 pointercancel，松手触发 touchend。
  pointer(dom.window, tick2, 'pointerdown', { pointerType: 'touch', clientY: 220 })
  const touchStart = new dom.window.Event('touchstart', { bubbles: true })
  Object.defineProperty(touchStart, 'touches', { value: [{ clientY: 220 }] })
  tick2.dispatchEvent(touchStart)
  pointer(dom.window, tick2, 'pointermove', { pointerType: 'touch', clientY: 224 })
  pointer(dom.window, tick2, 'pointercancel', { pointerType: 'touch', clientY: 224 })
  tick2.dispatchEvent(new dom.window.Event('touchend', { bubbles: true }))

  assert.equal(sawIntent, true, '主动通知宿主中断跟尾动画')
  assert.equal(followingTail, false, '未手动滑动对话也已解除宿主跟尾锁')
  assert.equal(currentScrollTop, 200, '首次点击确认后直接落到第 2 楼开头')

  // 模拟第 1 楼按需挂载展开（+700px）并触发宿主 ResizeObserver：既不被拉回底部，也会二次对齐到新的第 2 楼顶部。
  offsets.set(2, 900)
  scrollHeight = 4700
  hostOnResize()
  while (rafQueue.length) rafQueue.shift()()
  assert.equal(currentScrollTop, 900, '上方收起楼层展开后仍精准停在第 2 楼开头')
  rail.dispose()
})


