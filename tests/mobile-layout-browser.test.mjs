import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'

test('移动端实际样式：顶栏、键盘、候选、面板、编辑器与桌面恢复', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 90000 }, async t => {
  const { chromium } = await import('playwright')
  const { install, viewport } = await import('./fixtures/mobile-layout-browser.mjs')
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
      const selectors = ['[data-mobile-nav="toggle"]', '.dsh-tavern-play-fullscreen', '.dsh-tavern-header-settings', '.dsh-tavern-export-action', '[aria-label="资源面板"]']
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
      const title = await page.locator('header nav').boundingBox()
      assert.ok(title.width >= 24, `${width}: 会话标题保留空间`)
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
    assert.equal(await page.locator('[data-slot="conversation.session.header"] > header').count(), 1)
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
      assert.equal(await page.locator('#frame').evaluate(el => getComputedStyle(el).position), 'static')
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

  await t.test('生图预览、提示词表单、图库与批量工具在手机中不溢出', async () => {
    await page.setViewportSize({ width: 320, height: 720 }); await install(page)
    const imageSource = await readFile(new URL('../tavern-plugin/packages/dsh-image-gen/src/client/index.tsx', import.meta.url), 'utf8')
    const base = imageSource.slice(imageSource.indexOf('const STYLE = `') + 'const STYLE = `'.length, imageSource.indexOf('`', imageSource.indexOf('const STYLE = `') + 'const STYLE = `'.length))
    const studio = await readFile(new URL('../tavern-plugin/packages/dsh-image-gen/src/client/studio-style.ts', import.meta.url), 'utf8')
    await page.addStyleTag({ content: base + studio.slice(studio.indexOf('`') + 1, studio.lastIndexOf('`')) })
    await page.locator('#center').evaluate(el => { el.innerHTML = `<div class="dsh-ig-gallery-page"><div class="dsh-ig-studio-tabs-bar"><button class="dsh-ig-studio-tab-btn">生图工作台</button><button class="dsh-ig-studio-tab-btn">图片资料库</button><button class="dsh-ig-studio-tab-btn">收藏图片</button></div><div class="dsh-ig-gallery-page-body is-workbench"><div class="dsh-ig-workbench"><div class="dsh-ig-workbench-grid"><div class="dsh-ig-recent-panel"><div class="dsh-ig-recent-scroll"><button class="dsh-ig-recent-item">最近图片 1</button><button class="dsh-ig-recent-item">最近图片 2</button></div></div><div class="dsh-ig-canvas-column"><div class="dsh-ig-canvas-toolbar"><div class="dsh-ig-canvas-toolbar-left"><button>适合窗口</button><button>放大</button><button>缩小</button></div><div class="dsh-ig-canvas-toolbar-right"><button>生成状态</button></div></div><div class="dsh-ig-canvas">图片预览</div></div><div class="dsh-ig-generate-panel"><div class="dsh-ig-panel-tabs"><button>生成图片</button><button>模型配置</button></div><div class="dsh-ig-generator-form"><label class="dsh-ig-field">提示词<textarea>雨后的旧城区</textarea></label><button>生成</button></div></div></div></div></div></div>` })
    for (const width of [320, 390, 768, 1023]) {
      await page.setViewportSize({ width, height: 720 }); await settle()
      assert.equal(await page.locator('.dsh-ig-workbench').evaluate(el => el.scrollWidth <= el.clientWidth), true, `${width}: 生图不横向溢出`)
      assert.equal(await page.locator('.dsh-ig-workbench-grid').evaluate(el => getComputedStyle(el).display), 'flex')
      assert.ok((await box('.dsh-ig-canvas-column')).height < 500, '预览不保留桌面固定最小高度')
      assert.ok((await box('.dsh-ig-generator-form')).height >= 160, '移除桌面占位后表单仍完整展开')
      assert.ok((await box('.dsh-ig-recent-panel')).height >= 40, '最近图片列表仍可见')
      assert.equal(await page.locator('.dsh-ig-field textarea').evaluate(el => getComputedStyle(el).fontSize), '16px')
    }
    await page.setViewportSize({ width: 320, height: 720 }); await settle()
    await page.screenshot({ path: 'output/playwright/mobile/images-320.png' })
    await page.locator('#center').evaluate(el => { el.innerHTML = '<div class="dsh-ig-gallery-grid"><article class="dsh-ig-gallery-card"><div class="dsh-ig-card-toolbar"><button>下载</button><button>重绘</button></div></article></div><div class="dsh-ig-batch-bar"><div class="dsh-ig-batch-bar-left"><span>已选 12 张</span><button class="dsh-ig-batch-btn">全选</button></div><div class="dsh-ig-batch-bar-right"><button class="dsh-ig-batch-btn">下载</button><button class="dsh-ig-batch-btn">批量删除</button><button class="dsh-ig-batch-btn">退出</button></div></div>' })
    const batch = await box('.dsh-ig-batch-bar')
    assert.ok(batch.x >= 0 && batch.x + batch.width <= 320)
    assert.equal(await page.locator('.dsh-ig-card-toolbar').evaluate(el => getComputedStyle(el).opacity), '1', '触屏无需悬停即可操作图片')
  })

  await t.test('Android 内嵌外壳传递键盘后的可用高度给 iframe，关闭时释放监听', async () => {
    await page.goto('about:blank'); await page.setViewportSize({ width: 360, height: 800 })
    const entry = await readFile(new URL('../android/dsh-tavern-entry/client.js', import.meta.url), 'utf8')
    const style = entry.slice(entry.indexOf('const CSS = `') + 'const CSS = `'.length, entry.indexOf('`;', entry.indexOf('const CSS = `')))
    const controller = entry.slice(entry.indexOf('function installEmbeddedViewport('), entry.indexOf('function checkTavern('))
    await page.setContent(`<style>body{margin:0}${style}</style><div class="dsh-tavern-embed"><div class="dsh-tavern-embed-bar"><span>酒馆工作台</span><button>刷新</button><button>直接打开</button><button>关闭</button></div><iframe title="酒馆工作台" srcdoc="<meta name=viewport content=width=device-width><body>测试会话</body>"></iframe></div>`)
    await page.evaluate(source => {
      window.testViewport = new EventTarget()
      Object.assign(window.testViewport, { height: 420, offsetTop: 30, scale: 1 })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: window.testViewport })
      window.releaseEmbedded = new Function(source + ';return installEmbeddedViewport')()(document.querySelector('.dsh-tavern-embed'))
    }, controller)
    const frame = await box('iframe'), bar = await box('.dsh-tavern-embed-bar')
    assert.equal(bar.y, 30)
    assert.ok(Math.abs(frame.height + bar.height - 420) <= 1)
    assert.ok(frame.y + frame.height <= 450)
    await page.evaluate(() => { Object.assign(window.testViewport, { height: 800, offsetTop: 0 }); window.testViewport.dispatchEvent(new Event('resize')) })
    await settle()
    assert.equal((await box('.dsh-tavern-embed')).height, 800)
    await page.evaluate(() => { window.releaseEmbedded(); window.testViewport.height = 300; window.testViewport.dispatchEvent(new Event('resize')) })
    await settle()
    assert.equal(await page.locator('.dsh-tavern-embed').evaluate(el => el.style.height), '')
  })
  assert.deepEqual(errors, [])
})
