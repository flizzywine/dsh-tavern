import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { generationStreamModeBootScript } from '../tavern-plugin/lib/domain/generation-stream-mode-boot-patch.js'

async function settle(dom) {
  for (let index = 0; index < 4; index++) await new Promise(resolve => dom.window.setTimeout(resolve, 0))
}

test('原生模型根菜单加入所有模型的流式/非流式切换，默认流式且点击保存', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><div role="menu">
    <button role="menuitem" class="cell"><span class="hash_cellLabel">模型</span><span class="hash_cellValue">DeepSeek</span></button>
    <button role="menuitem" class="cell"><span class="hash_cellLabel">推理等级</span><span class="hash_cellValue">High</span></button>
  </div></body></html>`, { url: 'http://localhost', runScripts: 'outside-only', pretendToBeVisual: true })
  const calls = []
  dom.window.fetch = async (url, options) => {
    const method = String(url).split('/').at(-1)
    const body = JSON.parse(options.body)
    calls.push({ method, body })
    return { json: async () => ({ ok: true, stream: method === 'setGenerationStreamMode' ? body.stream : true }) }
  }
  try {
    dom.window.eval(generationStreamModeBootScript())
    await settle(dom)
    const row = dom.window.document.querySelector('[data-dsh-tavern-stream-mode]')
    assert.ok(row)
    assert.match(row.title, /所有模型请求/)
    assert.equal(row.getAttribute('data-stream'), 'true')
    const options = row.querySelectorAll('[data-dsh-tavern-stream-option]')
    assert.deepEqual([...options].map(option => option.textContent), ['流式', '非流式'])
    assert.equal(options[0].getAttribute('aria-checked'), 'true')
    assert.equal(options[1].getAttribute('aria-checked'), 'false')
    options[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await settle(dom)
    assert.ok(calls.some(call => call.method === 'setGenerationStreamMode' && call.body.stream === false))
    assert.equal(row.getAttribute('data-stream'), 'false')
    assert.equal(options[1].getAttribute('aria-checked'), 'true')
    assert.equal(dom.window.__dshTavernGenerationStreamMode.snapshot().stream, false)
    row.remove()
    await settle(dom)
    assert.equal(dom.window.document.querySelector('[data-dsh-tavern-stream-mode]')?.getAttribute('data-stream'), 'false')
    const portal = dom.window.document.querySelector('[role="menu"]')
    const rootButtons = [...portal.querySelectorAll('[role="menuitem"]')]
    portal.setAttribute('role', 'group')
    rootButtons.forEach(button => button.remove())
    const choices = dom.window.document.createElement('div')
    choices.setAttribute('role', 'menu')
    choices.innerHTML = '<button role="menuitemradio" aria-checked="true">DeepSeek</button><button role="menuitemradio">第二个模型</button>'
    portal.prepend(choices)
    await settle(dom)
    assert.equal(portal.querySelector('[data-dsh-tavern-stream-mode]'), null, '原生模型子页复用容器时移除旧开关')
    assert.deepEqual([...portal.querySelectorAll('[role="menuitemradio"]')].map(button => button.textContent), ['DeepSeek', '第二个模型'])
    choices.remove()
    portal.setAttribute('role', 'menu')
    portal.append(...rootButtons)
    await settle(dom)
    assert.equal(portal.querySelector('[data-dsh-tavern-stream-mode]')?.getAttribute('data-stream'), 'false')
    dom.window.document.querySelector('[role="menu"]').remove()
    const effort = dom.window.document.createElement('div')
    effort.setAttribute('role', 'menu')
    effort.innerHTML = '<button role="menuitemradio">High</button>'
    dom.window.document.body.appendChild(effort)
    await settle(dom)
    assert.equal(effort.querySelector('[data-dsh-tavern-stream-mode]'), null)
  } finally {
    dom.window.__dshTavernGenerationStreamMode?.dispose()
    dom.window.close()
  }
})

test('移动端在模型根菜单最后一行显示当前输入栏的运行统计，实时同步且桌面端隐藏', async () => {
  const dom = new JSDOM(`<!doctype html><html><body class="dsh-tavern-shell-active">
    <div data-conversation-content>
      <div data-composer-seat>
        <div data-composer-card>
          <button type="button" aria-controls="m1-menu">模型</button>
        </div>
        <div data-composer-dock>
          <div data-slot="conversation.composer.dock">
            <span class="bOPqQW_anchor" data-composer-stat="activity">
              <button type="button" class="bOPqQW_pill" aria-label="49 轮 67 步 · 161 tok/s">
                <svg viewBox="0 0 14 14"><path d="M1 1h12" /></svg>
                <span class="bOPqQW_label">49 轮 67 步<span class="bOPqQW_sep">·</span>161 tok/s</span>
              </button>
            </span>
            <span class="bOPqQW_anchor" data-composer-stat="usage">
              <button type="button" class="bOPqQW_pill" aria-label="1.2M tok · 缓存命中 47%">
                <svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" /></svg>
                <span class="bOPqQW_label">1.2M tok<span class="bOPqQW_sep">·</span>缓存命中 47%</span>
              </button>
            </span>
          </div>
          <span class="JObwrW_root">
            <button type="button" class="JObwrW_trigger" aria-label="已使用 7% 上下文">
              <svg viewBox="0 0 14 14"><circle class="JObwrW_track" cx="7" cy="7" r="5" /><circle class="JObwrW_fill" cx="7" cy="7" r="5" stroke-dasharray="2.2 31.4" /></svg>
              <span>7%</span>
            </button>
          </span>
        </div>
      </div>
    </div>
    <div id="m1-menu" role="menu">
      <button role="menuitem" class="cell"><span class="hash_cellLabel">模型</span><span class="hash_cellValue">Gemini 4 Hydrogen</span></button>
    </div>
  </body></html>`, { url: 'http://localhost', runScripts: 'outside-only', pretendToBeVisual: true })
  dom.window.innerWidth = 390
  dom.window.fetch = async () => ({ json: async () => ({ ok: true, stream: true }) })
  try {
    dom.window.eval(generationStreamModeBootScript())
    await settle(dom)
    const menu = dom.window.document.getElementById('m1-menu')
    const streamRow = menu.querySelector('[data-dsh-tavern-stream-mode]')
    const statsRow = menu.querySelector('[data-dsh-tavern-mobile-stats]')
    assert.ok(streamRow && statsRow)
    assert.equal(menu.lastElementChild, statsRow, '统计行位于模型面板最后一行')
    assert.equal(statsRow.previousElementSibling, streamRow, '统计行排在输出方式行之后')
    assert.equal(statsRow.hidden, false)
    const items = [...statsRow.querySelectorAll('[data-dsh-tavern-menu-stat]')]
    assert.deepEqual(items.map(item => item.getAttribute('data-dsh-tavern-menu-stat')), ['activity', 'usage', 'context'])
    assert.equal(items.every(item => item.querySelector('button') === null && item.querySelector('svg') !== null), true, '保留图标并转为纯展示节点')
    assert.match(items[0].textContent, /49 轮 67 步·161 tok\/s/)
    assert.match(items[1].textContent, /1\.2M tok·缓存命中 47%/)
    assert.equal(items[2].textContent.trim(), '7%')

    // mousedown 阻止默认焦点转移，避免触发宿主 ModelSelect 的 onBlur 误关菜单
    const down = new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
    statsRow.dispatchEvent(down)
    assert.equal(down.defaultPrevented, true)

    // 宿主异步补上「推理等级」菜单项后，输出方式与统计行依然保持在菜单末尾最后两行
    const effortRow = dom.window.document.createElement('button')
    effortRow.setAttribute('role', 'menuitem')
    effortRow.className = 'cell'
    effortRow.innerHTML = '<span class="hash_cellLabel">推理等级</span><span class="hash_cellValue">Medium</span>'
    menu.appendChild(effortRow)
    await settle(dom)
    assert.equal(menu.lastElementChild, statsRow, '异步新增菜单项后统计行仍是最后一行')
    assert.equal(statsRow.previousElementSibling, streamRow, '输出方式仍在统计行正上方')

    // 运行统计实时变动时自动刷新
    dom.window.document.querySelector('[data-composer-stat="activity"] .bOPqQW_label').innerHTML = '50 轮 68 步<span class="bOPqQW_sep">·</span>175 tok/s'
    await settle(dom)
    assert.match(statsRow.querySelector('[data-dsh-tavern-menu-stat="activity"]').textContent, /50 轮 68 步·175 tok\/s/)

    // 切到宽屏桌面视口时隐藏菜单内统计行
    dom.window.innerWidth = 1280
    dom.window.dispatchEvent(new dom.window.Event('resize'))
    await settle(dom)
    assert.equal(statsRow.hidden, true, '桌面视口隐藏模型菜单内的移动统计行')

    // 回到移动端恢复显示，钻入模型子菜单时一并清理
    dom.window.innerWidth = 390
    dom.window.dispatchEvent(new dom.window.Event('resize'))
    await settle(dom)
    assert.equal(statsRow.hidden, false)

    // 方案 C：触发器纯属性与 CSS 变量同步，绝不向 React 按钮内插入子节点
    const triggerBtn = dom.window.document.querySelector('[data-composer-card] button[aria-controls="m1-menu"]')
    const initialChildren = triggerBtn.childNodes.length
    assert.equal(triggerBtn.getAttribute('data-dsh-tavern-ctx-trigger'), 'scheme-c')
    assert.equal(triggerBtn.getAttribute('data-ctx-tone'), 'normal')
    assert.equal(triggerBtn.style.getPropertyValue('--dsh-ctx-level'), '7%')
    assert.equal(triggerBtn.childNodes.length, initialChildren)

    // 推送精确触发态：cache-break（0% 告警微角标）与危险高占用态
    dom.window.__dshTavernGenerationStreamMode.setContextVisual({
      sessionId: 's1',
      triggerState: { percent: 42, level: 42, tone: 'cache-break', alertPill: '0%', bucketShares: [{ key: 'worldbook', share: 0.25 }, { key: 'story', share: 0.17 }] }
    })
    assert.equal(triggerBtn.getAttribute('data-ctx-tone'), 'cache-break')
    assert.equal(triggerBtn.getAttribute('data-ctx-alert'), '1')
    assert.equal(triggerBtn.getAttribute('data-ctx-pill'), '0%')
    assert.equal(triggerBtn.style.getPropertyValue('--dsh-ctx-level'), '42%')
    assert.ok(statsRow.querySelector('[data-dsh-tavern-stats-more]').textContent.includes('分布'))
    assert.ok(statsRow.querySelectorAll('[data-dsh-tavern-stats-seg]').length >= 2)
    assert.equal(triggerBtn.childNodes.length, initialChildren, '按钮子节点数始终保持零侵入')

    // 点击底部运行信息栏派发打开上下文分布浮层事件
    const openedEvents = []
    dom.window.addEventListener('dsh-tavern:open-context-window', e => openedEvents.push(e.detail))
    statsRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    assert.equal(openedEvents.length, 1)
    assert.equal(openedEvents[0].source, 'mobile-menu-stats')

    menu.setAttribute('role', 'group')
    for (const button of [...menu.querySelectorAll('[role="menuitem"]')]) button.remove()
    await settle(dom)
    assert.equal(menu.querySelector('[data-dsh-tavern-mobile-stats]'), null, '进入子面板时移除统计行')

    // dispose 完整清理触发器附加属性
    dom.window.__dshTavernGenerationStreamMode.dispose()
    assert.equal(triggerBtn.getAttribute('data-dsh-tavern-ctx-trigger'), null)
    assert.equal(triggerBtn.getAttribute('data-ctx-pill'), null)
  } finally {
    dom.window.__dshTavernGenerationStreamMode?.dispose()
    dom.window.close()
  }
})
