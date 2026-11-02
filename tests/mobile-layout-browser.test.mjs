import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'

test('移动端实际样式：顶栏、键盘、候选、面板、编辑器与桌面恢复', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 90000 }, async t => {
  const { chromium } = await import('playwright')
  const { install, nativeComposer, viewport } = await import('./fixtures/mobile-layout-browser.mjs')
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  // 此页验证按宽度切换后的桌面恢复；触屏平板另测，避免把宽屏等同于鼠标设备。
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: false })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await install(page)
  const box = selector => page.locator(selector).boundingBox()
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const assertNoOverflow = async label => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true, label)
  await mkdir(new URL('../output/playwright/mobile/', import.meta.url), { recursive: true })

  await t.test('320–1023px 顶部操作共用一行，不遮标题或互相覆盖', async () => {
    for (const width of [320, 360, 390, 430, 768, 1023]) {
      await page.setViewportSize({ width, height: 844 })
      await settle()
      const selectors = ['.dsh-tavern-play-fullscreen', '.dsh-tavern-header-settings', '.dsh-tavern-export-action', '[aria-label="资源面板"]']
      const rects = await Promise.all(selectors.map(box))
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i]
        assert.ok(rect && rect.width >= 40 && rect.height >= 40, `${width}: ${selectors[i]} 可触摸`)
        assert.ok(Math.abs(rect.y - rects[0].y) <= 1, `${width}: 顶栏对齐 ${selectors[i]}`)
        assert.ok(rect.x >= 0 && rect.x + rect.width <= width, `${width}: 顶栏不越界`)
        const hit = await page.locator(selectors[i]).evaluate(element => {
          const r = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
        })
        assert.equal(hit, true, `${width}: ${selectors[i]} 不被透明层拦截`)
      }
      const toggle = await box('[data-mobile-nav="toggle"]')
      assert.ok(toggle && toggle.width > 0 && toggle.height > 0, `${width}: 目录开关可见`)
      assert.ok(Math.abs((toggle.y + toggle.height / 2) - (rects[0].y + rects[0].height / 2)) <= 1, `${width}: 目录开关与顶栏对齐`)
      assert.equal(await page.locator('[data-mobile-nav="toggle"]').evaluate(element => {
        const r = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      }), true, `${width}: 目录开关不被透明层拦截`)
      // 原生 corner 有按钮时，酒馆隐藏 dsh-web-mobile 重复的文件按钮。
      assert.equal(await box('[data-mobile-nav="files"]'), null, `${width}: 不重复显示文件按钮`)
      const title = await page.locator('header nav').boundingBox()
      // 顶栏宽度预算给标题留的下限是 16px（tavernHeaderMobileChrome 的注释）。
      assert.ok(title.width >= 16, `${width}: 会话标题保留空间`)
      await assertNoOverflow(`${width}: 页面不溢出`)
    }
    await page.setViewportSize({ width: 390, height: 844 }); await settle()
    await page.screenshot({ path: 'output/playwright/mobile/chat-390.png' })
  })

  await t.test('键盘仅缩小 visualViewport、平移、缩放和关闭，输入栏与候选均可用', async () => {
    for (const state of [{ height: 460, offsetTop: 0 }, { height: 390, offsetTop: 40 }, { height: 300, offsetTop: 0 }]) {
      await viewport(page, state)
      const shell = await box('#frame'), input = await box('[data-composer-seat]'), sheet = await box('.dsh-tavern-candidate-question'), header = await box('header')
      assert.equal(shell.y, state.offsetTop)
      assert.equal(shell.height, state.height)
      assert.ok(input.y + input.height <= state.offsetTop + state.height + 1, '输入区在键盘之上')
      const short = await page.locator('html').evaluate(el => el.classList.contains('dsh-tavern-short-viewport'))
      if (short) assert.ok(sheet.y + sheet.height <= state.offsetTop + state.height, '短窗口列表覆盖内容区并留在键盘上方')
      else assert.ok(Math.abs(sheet.y + sheet.height - input.y) <= 1, '候选紧贴输入区，无重复键盘偏移')
      assert.ok(sheet.y >= header.y + header.height - 1, '候选不遮住顶栏')
      await assertNoOverflow('键盘弹出时整页不产生滚动')
    }
    await viewport(page, { height: 460, offsetTop: 0 })
    await page.screenshot({ path: 'output/playwright/mobile/keyboard-390.png' })
    const originalHeight = await page.locator('#frame').evaluate(el => el.getBoundingClientRect().height)
    await viewport(page, { height: 230, scale: 2, offsetTop: 70 })
    assert.equal((await box('#frame')).height, originalHeight, '缩放不触发键盘重排')
    await viewport(page, { height: 844, scale: 1, offsetTop: 0 })
    assert.equal((await box('#frame')).height, 844, '键盘关闭恢复全高')
  })

  await t.test('真实插槽包装和全屏状态不缩小根页面，操作栏保持在可用区顶部', async () => {
    assert.equal(await page.locator('[data-slot="conversation.header"] > header').count(), 1)
    for (const width of [390, 850, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(() => document.documentElement.classList.add('dsh-tavern-play-fullscreen'))
      await settle()
      const root = await box('html'), header = await box('header')
      assert.equal(root.width, width, '全屏状态不能套用按钮的 32px 宽度')
      assert.equal(root.height, 844, '全屏状态不能套用按钮的 32px 高度')
      assert.equal(header.y, 0, '顶栏没有额外空白行')
      if (width < 1024) {
        assert.equal(await page.locator('header').evaluate(el => getComputedStyle(el).paddingTop), '2px')
        assert.ok((await box('.dsh-tavern-play-fullscreen[aria-label]')).y <= 3)
      }
      await page.evaluate(() => document.documentElement.classList.remove('dsh-tavern-play-fullscreen'))
    }
    await page.setViewportSize({ width: 390, height: 844 }); await settle()
  })

  await t.test('候选列表点选即追加、独立滚动，并在点击输入框时收起', async () => {
    await page.locator('.dsh-tavern-question-option').first().click()
    assert.match(await page.getByRole('textbox', { name: '消息' }).inputValue(), /候选 1/)
    assert.equal(await page.locator('.dsh-tavern-question-option').count(), 12)
    await page.locator('.dsh-tavern-question-body').evaluate(el => { el.scrollTop = el.scrollHeight })
    assert.ok(await page.locator('.dsh-tavern-question-body').evaluate(el => el.scrollTop > 0))
    await page.getByRole('textbox', { name: '消息' }).click()
    assert.equal(await page.getByRole('textbox', { name: '消息' }).evaluate(el => el === document.activeElement), true)
    assert.equal(await page.locator('.dsh-tavern-question-option').count(), 0)
    await page.getByRole('button', { name: '展开行动列表', exact: true }).press('Enter')
    assert.equal(await page.locator('.dsh-tavern-question-option').count(), 12, '嵌套按钮 Enter 只切换一次')
    await page.getByRole('textbox', { name: '消息' }).click()
    assert.equal(await page.locator('.dsh-tavern-question-option').count(), 0, '手动输入时收起候选，留出正文空间')
    await viewport(page, { height: 400, offsetTop: 0 })
    await page.screenshot({ path: 'output/playwright/mobile/typing-390.png' })
    await viewport(page, { height: 844, offsetTop: 0 })
  })

  await t.test('移动端把宿主运行状态折叠到操作行箭头，桌面保留完整状态', async () => {
    await nativeComposer(page)
    await settle()
    const toggle = page.locator('.dsh-tavern-mobile-stats-toggle')
    const dock = page.locator('[data-slot="conversation.composer.dock"]')
    assert.equal(await toggle.isVisible(), true, '移动端显示状态开关')
    const touch = await box('.dsh-tavern-mobile-stats-toggle')
    assert.ok(touch && touch.width >= 44 && touch.height >= 44, '状态开关可触摸')
    const actions = await box('.dsh-tavern-dock-actions')
    assert.ok(actions && actions.height <= 60, '操作行保持单行')
    assert.ok(actions.x + actions.width - (touch.x + touch.width) <= 12, '箭头固定在操作行右侧')
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(await dock.isVisible(), false, '默认收起宿主状态')
    await page.screenshot({ path: 'output/playwright/mobile/stats-collapsed-390.png' })
    assert.equal(await page.locator('[data-composer-dock] > .fixture-pill').isVisible(), false, '整条宿主状态栏一起收起')
    await toggle.click(); await settle()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    assert.equal(await toggle.getAttribute('aria-label'), '收起运行信息')
    assert.equal(await dock.isVisible(), true, '展开后读取宿主实时状态')
    assert.equal(await page.locator('[data-composer-dock] > .fixture-pill').isVisible(), true, '原生上下文计量也恢复')
    assert.match(await dock.innerText(), /72 轮 · 82 步/)
    await assertNoOverflow('展开状态不撑破页面')
    await page.screenshot({ path: 'output/playwright/mobile/stats-expanded-390.png' })
    await toggle.click(); await settle()
    assert.equal(await dock.isVisible(), false, '再次点击收起')
    await page.setViewportSize({ width: 1280, height: 900 }); await settle()
    assert.equal(await toggle.isVisible(), false, '桌面不显示移动开关')
    assert.equal(await dock.isVisible(), true, '桌面保留完整状态')
    await page.screenshot({ path: 'output/playwright/mobile/stats-desktop-1280.png' })
    await page.setViewportSize({ width: 390, height: 844 }); await settle()
    assert.equal(await toggle.isVisible(), true)
    assert.equal(await dock.isVisible(), false, '返回移动端保持用户选择的收起状态')
    await toggle.click(); await settle()
    await viewport(page, { height: 240, offsetTop: 0 })
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dsh-tavern-short-viewport')), true)
    await page.locator('[data-composer-input]').evaluate(element => element.focus()); await settle()
    assert.equal(await dock.isVisible(), false, '键盘弹出时展开面板也收起')
    await page.evaluate(() => document.activeElement.blur())
    await viewport(page, { height: 844, offsetTop: 0 }); await settle()
    assert.equal(await dock.isVisible(), true, '失焦后恢复用户选择')
    await toggle.click(); await settle()
  })

  await t.test('更换会话输入栏后继续观察，桌面和卸载清除移动状态', async () => {
    await page.evaluate(() => {
      const old = document.querySelector('[data-composer-seat]')
      const replacement = document.createElement('div'); replacement.setAttribute('data-composer-seat', '')
      replacement.className = old.className
      replacement.style.height = '90px'
      replacement.innerHTML = '<div data-composer-card><textarea aria-label="新会话"></textarea></div>'
      old.replaceWith(replacement)
    })
    await settle()
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dsh-composer-offset'))
    await page.locator('[data-composer-seat]').evaluate(el => { el.style.height = '160px' })
    await settle()
    const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dsh-composer-offset'))
    assert.notEqual(before, after, '新输入区的 ResizeObserver 生效')
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await settle()
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dsh-tavern-coarse-play')), false)
      assert.equal(await page.locator('#frame').evaluate(el => getComputedStyle(el).position), 'relative', '桌面保持宿主外壳的定位，不被钉到可视区')
    }
    await page.evaluate(() => window.releaseViewport())
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--dsh-vv-height')), '')
  })

  await t.test('布局视口一起缩小、横屏和缺少 visualViewport 时正常回退', async () => {
    await page.setViewportSize({ width: 390, height: 400 }); await install(page)
    assert.equal((await box('#frame')).height, 400)
    await page.setViewportSize({ width: 844, height: 390 }); await settle()
    assert.equal((await box('#frame')).height, 390)
    await assertNoOverflow('横屏不溢出')
    await page.evaluate(() => {
      window.releaseViewport()
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
      window.releaseViewport = installVisualViewportPin(document)
    })
    await page.setViewportSize({ width: 360, height: 640 }); await settle()
    assert.equal((await box('#frame')).height, 640)
  })

  await t.test('全屏右栏打开后盖住输入区和候选按钮，面板底部内容不被遮挡', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await install(page)
    await page.getByRole('button', { name: '资源面板', exact: true }).click(); await settle()
    for (const selector of ['[data-composer-card]', '.dsh-tavern-dock-actions']) {
      const covered = await page.locator(selector).evaluate(el => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return document.querySelector('[data-sidebar-right-panel]').contains(hit)
      })
      assert.equal(covered, true, selector)
    }
  })

  await t.test('人物卡、世界书、预设、设置与弹窗在窄屏键盘上方可滚动', async () => {
    await page.setViewportSize({ width: 320, height: 720 }); await install(page)
    await viewport(page, { height: 430, offsetTop: 20 })
    await page.getByRole('button', { name: '资源面板', exact: true }).click()
    const samples = [
      '<div class="dsh-tavern-library"><div class="dsh-tavern-panel-toolbar"><div class="dsh-tavern-panel-tabs"><button class="dsh-tavern-panel-tab">人物卡资料</button><button class="dsh-tavern-panel-tab">世界书与扩展</button><button class="dsh-tavern-panel-tab">全部资源</button></div><button class="dsh-tavern-panel-refresh">刷新</button></div><input class="dsh-tavern-library-search" placeholder="搜索人物卡"></div>',
      '<div class="dsh-tavern-worldbook-editor"><div class="dsh-tavern-worldbook-grid"><label>名称<input value="很长的条目名称"></label><label>策略<select><option>这是一个很长的世界书触发策略说明</option></select></label></div><div class="dsh-tavern-worldbook-editor-actions"><button>保存世界书</button><button>添加条目</button></div></div>',
      '<div class="dsh-tavern-prompt-editor"><label class="dsh-tavern-prompt-editor-field">预设内容<textarea>输入很长的指令</textarea></label><label class="dsh-tavern-prompt-editor-field">位置<select><option>插入当前上下文的前面</option></select></label></div>',
      '<div class="dsh-template-panel"><div class="dsh-template-panel-body"><div class="dsh-template-settings-grid"><label>模板沙箱<select><option>受限制的模板运行环境</option></select></label><label>变量范围<input value="当前会话"></label></div></div></div>',
      '<div class="dsh-tavern-settings-section"><label class="dsh-tavern-settings-row dsh-tavern-settings-model-row"><span class="dsh-tavern-settings-copy">默认模型</span><select class="dsh-tavern-settings-select"><option>很长很长的模型提供商名称和模型标识符</option></select></label></div>',
    ]
    for (let index = 0; index < samples.length; index++) {
      await page.locator('#content').evaluate((el, html) => { el.innerHTML = html }, samples[index])
      assert.equal(await page.locator('#content').evaluate(el => el.scrollWidth <= el.clientWidth), true, `面板 ${index} 不横向溢出`)
      const inputs = page.locator('#content input, #content textarea, #content select')
      for (const input of await inputs.all()) assert.ok(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16), '编辑不触发 iOS 字号缩放')
    }
    await page.evaluate(() => {
      const dialog = document.createElement('dialog'); dialog.className = 'dsh-tavern-prompt'
      dialog.innerHTML = '<div class="dsh-tavern-prompt-panel"><div class="dsh-tavern-prompt-title">新建分组</div><input class="dsh-tavern-prompt-input" aria-label="名称"><div class="dsh-tavern-prompt-actions"><button class="dsh-tavern-btn">取消</button><button class="dsh-tavern-btn">保存</button></div></div>'
      document.body.append(dialog); dialog.showModal()
    })
    const dialog = await box('dialog')
    assert.ok(dialog.y >= 20 && dialog.y + dialog.height <= 450)
    await page.getByRole('textbox', { name: '名称' }).fill('新建分组')
    await page.screenshot({ path: 'output/playwright/mobile/prompt-320.png' })
    await assertNoOverflow('面板与弹窗无页面溢出')
  })

  // 真实挂载入口组件再断言渲染结果：极简 React 只需要 useState/useRef/useEffect，
  // 这样测的是「窗口里到底有没有控件、返回时会不会关掉」，不是源码里写了什么。
  await t.test('Android 内嵌外壳零控件、全屏铺满 iframe，返回键关闭窗口', async () => {
    await page.goto('about:blank'); await page.setViewportSize({ width: 360, height: 800 })
    const entry = await readFile(new URL('../android/dsh-tavern-entry/client.js', import.meta.url), 'utf8')
    const observed = await page.evaluate(async source => {
      document.body.innerHTML = '<div id="root"></div>'
      window.fetch = async url => ({
        ok: true,
        json: async () => String(url).endsWith('/embed') ? { url: 'about:blank' } : { online: true, update: { phase: 'idle' } }
      })
      const hooks = []
      let cursor = 0
      let render = () => {}
      const react = {
        useState(initial) {
          const slot = cursor++
          if (!(slot in hooks)) hooks[slot] = { value: typeof initial === 'function' ? initial() : initial }
          return [hooks[slot].value, next => { hooks[slot].value = typeof next === 'function' ? next(hooks[slot].value) : next; render() }]
        },
        useRef(initial) {
          const slot = cursor++
          if (!(slot in hooks)) hooks[slot] = { value: { current: initial } }
          return hooks[slot].value
        },
        useEffect(run, deps) {
          const slot = cursor++
          const previous = hooks[slot]
          if (previous && deps && previous.deps && deps.every((value, index) => value === previous.deps[index])) return
          if (previous && previous.cleanup) previous.cleanup()
          const cleanup = run()
          hooks[slot] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : null }
        },
        createElement(type, props, ...children) { return { type, props: props || {}, children } }
      }
      function build(node) {
        if (node === null || node === undefined || node === false) return document.createTextNode('')
        if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node))
        if (Array.isArray(node)) {
          const fragment = document.createDocumentFragment()
          node.forEach(child => fragment.append(build(child)))
          return fragment
        }
        if (typeof node.type === 'function') return build(node.type(Object.assign({}, node.props, { children: node.children })))
        const element = document.createElement(node.type)
        for (const [key, value] of Object.entries(node.props)) {
          if (key === 'className') element.className = value
          else if (key === 'ref') value.current = element
          else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value)
          else if (value !== null && value !== undefined && value !== false) element.setAttribute(key, String(value))
        }
        node.children.flat().forEach(child => element.append(build(child)))
        return element
      }
      let component = null
      render = () => { cursor = 0; document.getElementById('root').replaceChildren(build(react.createElement(component, {}))) }
      window.__ModuleLoader__ = {
        load: ({ factory }) => {
          const exports = factory(() => react)
          exports.apply({
            slots: { inject: (_name, fn) => fn(), register: (_meta, value) => { component = value; return () => {} } },
            effect: fn => fn()
          })
        }
      }
      new Function(source)()
      render()
      const open = [...document.querySelectorAll('button')].find(button => button.textContent.includes('酒馆工作台'))
      open.click()
      await new Promise(resolve => setTimeout(resolve, 60))
      const shell = document.querySelector('.dsh-tavern-embed')
      const frame = shell && shell.querySelector('iframe')
      const report = {
        mounted: Boolean(shell),
        role: shell && shell.getAttribute('role'),
        modal: shell && shell.getAttribute('aria-modal'),
        controls: shell ? shell.querySelectorAll('button, [role="button"], a[href]').length : -1,
        frameTop: frame && frame.getBoundingClientRect().top,
        frameHeight: frame && frame.getBoundingClientRect().height,
        viewport: innerHeight
      }
      // 原生返回：goBack() 弹掉打开时压入的哨兵条目，窗口关闭、回到入口。
      history.back()
      await new Promise(resolve => setTimeout(resolve, 150))
      report.openAfterBack = Boolean(document.querySelector('.dsh-tavern-embed'))
      // 宿主返回：DSHA 找到可见 dialog 后派发 Escape，同样关闭窗口。
      ;[...document.querySelectorAll('button')].find(button => button.textContent.includes('酒馆工作台')).click()
      await new Promise(resolve => setTimeout(resolve, 60))
      report.reopened = Boolean(document.querySelector('.dsh-tavern-embed'))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 60))
      report.openAfterEscape = Boolean(document.querySelector('.dsh-tavern-embed'))
      return report
    }, entry)
    assert.equal(observed.mounted, true, '入口按钮能打开内嵌窗口')
    assert.equal(observed.role, 'dialog', '外壳是模态对话框，DSHA 的返回键据此判定本次返回已处理')
    assert.equal(observed.modal, null, '外壳不声明 aria-modal（会命中宿主弹窗限宽规则）')
    assert.equal(observed.controls, 0, '窗口内没有任何可见控件')
    assert.equal(observed.frameTop, 0, 'iframe 顶到屏幕边缘（没有工具栏占位）')
    assert.ok(Math.abs(observed.frameHeight - observed.viewport) <= 1, 'iframe 占满可视高度')
    assert.equal(observed.openAfterBack, false, '历史回退（原生返回）关闭窗口')
    assert.equal(observed.reopened, true, '关闭后能再次打开')
    assert.equal(observed.openAfterEscape, false, '宿主派发的 Escape 关闭窗口')
  })

  // 回归：dsh-web-mobile（DSHA 随包烘焙的宿主 UI 层）在触屏手机档给「没有底部按钮的
  // aria-modal 元素」留左右 16px 边距，那是给宿主自己的内容弹窗用的。全屏外壳一旦带上
  // aria-modal，就被这条规则截成 100vw-32px，右侧恒定露出 32px 遮罩缺口。
  await t.test('Android 内嵌外壳不被宿主弹窗限宽规则截断', async () => {
    // 规则原文取自 dsh-web-mobile@2.4.1 lib/client.js；这里只复现尺寸契约。
    const hostRule = `@media (max-width: 1023px) and (pointer: coarse) {
      [aria-modal="true"]:not(:has(> :first-child > :last-child > button)) { max-width: calc(100vw - 32px); }
    }`
    // hasTouch 让 (pointer: coarse) 命中，等同手机。
    const phone = await browser.newPage({ viewport: { width: 360, height: 800 }, hasTouch: true })
    try {
      await phone.setContent(`<!doctype html><style>body{margin:0}${hostRule}
        .shell { position: fixed; inset: 0; background: #14110d; }</style>
        <div class="shell" id="with-modal" role="dialog" aria-modal="true"><iframe></iframe></div>
        <div class="shell" id="role-only" role="dialog"><iframe></iframe></div>`)
      const width = selector => phone.locator(selector).evaluate(el => Math.round(el.getBoundingClientRect().width))
      assert.equal(await width('#with-modal'), 360 - 32, '带 aria-modal 会被限宽规则截掉 32px（缺口来源）')
      assert.equal(await width('#role-only'), 360, '只声明 role 的外壳铺满视口')
    } finally {
      await phone.close()
    }
  })

  await t.test('Android 内嵌外壳传递键盘后的可用高度给 iframe，关闭时释放监听', async () => {
    await page.goto('about:blank'); await page.setViewportSize({ width: 360, height: 800 })
    const entry = await readFile(new URL('../android/dsh-tavern-entry/client.js', import.meta.url), 'utf8')
    const style = entry.slice(entry.indexOf('const CSS = `') + 'const CSS = `'.length, entry.indexOf('`;', entry.indexOf('const CSS = `')))
    const controller = entry.slice(entry.indexOf('function installEmbeddedViewport('), entry.indexOf('function checkTavern('))
    await page.setContent(`<style>body{margin:0}${style}</style><div class="dsh-tavern-embed" role="dialog" aria-modal="true"><iframe title="酒馆工作台" srcdoc="<meta name=viewport content=width=device-width><body>测试会话</body>"></iframe></div>`)
    await page.evaluate(source => {
      window.testViewport = new EventTarget()
      Object.assign(window.testViewport, { height: 420, offsetTop: 30, scale: 1 })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: window.testViewport })
      window.releaseEmbedded = new Function(source + ';return installEmbeddedViewport')()(document.querySelector('.dsh-tavern-embed'))
    }, controller)
    const frame = await box('iframe')
    assert.equal(frame.y, 30)
    assert.ok(Math.abs(frame.height - 420) <= 1)
    await page.evaluate(() => { Object.assign(window.testViewport, { height: 800, offsetTop: 0 }); window.testViewport.dispatchEvent(new Event('resize')) })
    await settle()
    assert.equal((await box('.dsh-tavern-embed')).height, 800)
    assert.ok(Math.abs((await box('iframe')).height - 800) <= 1)
    await page.evaluate(() => { window.releaseEmbedded(); window.testViewport.height = 300; window.testViewport.dispatchEvent(new Event('resize')) })
    await settle()
    assert.equal(await page.locator('.dsh-tavern-embed').evaluate(el => el.style.height), '')
  })
  assert.deepEqual(errors, [])
})
