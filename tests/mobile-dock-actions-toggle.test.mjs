// 移动端在 .dsh-tavern-dock-actions 与输入框卡片之间提供居中的展开/收起按钮：
// 展开时显示 .dsh-tavern-dock-actions，收起时隐藏 .dsh-tavern-dock-actions（并同步收起已打开的运行状态栏），桌面端不显示该按钮且始终保持操作栏可见。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const cssAsset = name => readFile(new URL('../tavern-plugin/lib/client-assets/' + name, import.meta.url), 'utf8')
const paperSkinCss = () => readFile(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/skins/paper.css', import.meta.url), 'utf8')
const clientSource = () => readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

const localRequire = createRequire(import.meta.url)
const reactDomFile = localRequire.resolve('react-dom/client')
const reactRequire = createRequire(reactDomFile)
const reactFile = reactRequire.resolve('react')

async function buildReactPrelude() {
  const modules = new Map()
  async function bundle(file) {
    if (modules.has(file)) return
    modules.set(file, '')
    let source = await readFile(file, 'utf8')
    const req = createRequire(file)
    for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      const target = match[1] === 'react' ? reactFile : req.resolve(match[1])
      await bundle(target)
      source = source.replaceAll(match[0], `require(${JSON.stringify(target)})`)
    }
    modules.set(file, `function(module,exports,require){${source}\n}`)
  }
  await bundle(reactFile)
  await bundle(reactDomFile)
  return `const process={env:{NODE_ENV:'production'}},modules={${[...modules].map(([name, code]) => `${JSON.stringify(name)}:${code}`).join(',')}},cache={};`
    + `function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}`
    + `const React=require(${JSON.stringify(reactFile)}),ReactDOM=require(${JSON.stringify(reactDomFile)});`
}

const hostCss = `
:root{--dsw-alias-border-l2:#dfd9d0;--dsw-alias-bg-base:#faf9f7;--dsw-alias-label-primary:#262421;--dsw-alias-label-secondary:#746e65;--dsw-specific-sidebar-fill:#fff;--dsw-specific-input-major:#fff;--dsw-alias-brand-primary:#c96442}
body{margin:0;font:15px/1.5 system-ui}
.wSkVaW_composerSeat{display:flex;flex-direction:column;padding:0 8px 8px}
.wSkVaW_composerStack{--dsh-composer-stack-gap:6px;gap:var(--dsh-composer-stack-gap);display:flex;flex-direction:column}
.uV2eYG_card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,780px);margin:0 auto;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-specific-input-major);display:flex;flex-direction:column;gap:12px;padding-top:8px;position:relative}
.uV2eYG_scroll{max-height:336px;overflow-y:auto}
.uV2eYG_input{box-sizing:border-box;min-height:36px;padding:4px 8px 0 14px;outline:none}
.uV2eYG_input p{margin:0}
.uV2eYG_row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 8px 6px}
.uV2eYG_tools,.uV2eYG_trailing{display:flex;align-items:center;gap:8px}
.uV2eYG_add,.uV2eYG_primary{width:34px;height:34px;border-radius:999px;display:grid;place-items:center}
[data-composer-dock]{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:4px 12px}
`

test('移动端展开/收起按钮控制 dsh-tavern-dock-actions 显隐、保持居中且桌面端不受影响', async t => {
  const [tavernCss, themeCss, paperCss, client, reactPrelude] = await Promise.all([
    cssAsset('tavern.css'),
    cssAsset('theme.css'),
    paperSkinCss(),
    clientSource(),
    buildReactPrelude(),
  ])

  const sliceStart = client.indexOf('function CandidateDockActions(')
  const sliceEnd = client.indexOf('function observeTurnErrorProjection(')
  assert.ok(sliceStart > 0 && sliceEnd > sliceStart, '定位 CandidateDockActions 与移动端开关源码片段')
  const dockSlice = client.slice(sliceStart, sliceEnd)

  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()

  await page.goto('about:blank')
  await page.setContent(`<!doctype html><html class="dsh-tavern-viewport-pinned dsh-tavern-coarse-play"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body class="dsh-tavern-shell-active">
    <div data-dsh-fork-session="play">
      <div class="wSkVaW_composerSeat" data-composer-seat>
        <div data-slot="conversation.composer" style="display:contents">
          <div class="wSkVaW_composerStack">
            <div data-slot="conversation.input.dock" style="display:contents">
              <div id="dock-mount" style="display:contents"></div>
              <div id="candidate-panel" class="dsh-tavern-question dsh-tavern-candidate-question collapsed">
                <div class="dsh-tavern-question-head"><span>接下来的行动</span></div>
              </div>
            </div>
            <div data-slot="conversation.composer.bar" style="display:contents">
              <div>
                <div class="uV2eYG_card" data-composer-card="true">
                  <div class="uV2eYG_scroll" data-input-scroll="true">
                    <div class="uV2eYG_grow"><div class="uV2eYG_input" data-composer-input="true" contenteditable="true" tabindex="0"><p>练习流星爆</p></div></div>
                  </div>
                  <div class="uV2eYG_row">
                    <div class="uV2eYG_tools"><button class="uV2eYG_add" type="button">+</button></div>
                    <div class="uV2eYG_trailing"><button class="uV2eYG_primary" type="button">↑</button></div>
                  </div>
                </div>
                <div class="uV2eYG_dock" data-composer-dock="">
                  <div data-slot="conversation.composer.dock"><span>7 轮 · 12 步</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body></html>`)
  await page.addStyleTag({ content: hostCss })
  await page.addStyleTag({ content: tavernCss })
  await page.addStyleTag({ content: themeCss })
  await page.addStyleTag({ content: paperCss })

  await page.addScriptTag({
    content: `${reactPrelude}
    const storageMap = new Map();
    const mockStorage = {
      getItem: k => storageMap.has(k) ? storageMap.get(k) : null,
      setItem: (k, v) => storageMap.set(k, String(v)),
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: mockStorage });
    const useTavernSessionMode = () => 'story';
    const isPlayMode = mode => mode === 'story' || mode === 'script';
    const latestTavernAssistantMessageId = () => 'msg-1';
    const useLiveTavernView = () => ({ view: { latestAssistantTurn: 1, canClearIncompleteReply: false } });
    const CandidateAction = () => React.createElement(React.Fragment, null,
      React.createElement('button', { type: 'button', className: 'dsh-tavern-choice-trigger dsh-tavern-candidate-entry', 'data-fork-action': 'open-choices' }, '行动 7 ⌃'),
      React.createElement('button', { type: 'button', className: 'dsh-tavern-choice-trigger', 'data-fork-action': 'choices-again' }, '重新生成候选项')
    );
    const TavernPluginComposerActions = () => React.createElement('button', { type: 'button', className: 'dsh-tavern-choice-trigger', 'data-fork-action': 'regen' }, '重新生成正文');
    const TavernMoreActions = () => React.createElement('div', { className: 'dsh-tavern-more-actions' }, React.createElement('button', { type: 'button', className: 'dsh-tavern-choice-trigger', 'data-fork-action': 'more' }, '更多 ▾'));
    const TavernCompactionAction = () => null;
    const TavernStopBackgroundAction = () => null;
    const rpc = async () => ({});
    const liveTavernView = { invalidate() {} };
    const tavernErrorHub = { report() {} };
    ${dockSlice}
    window.__readStorage = () => mockStorage.getItem('dsh-tavern:mobile-dock-actions-open');
    ReactDOM.createRoot(document.getElementById('dock-mount')).render(
      React.createElement(CandidateDockActions, {
        sessionId: 's1',
        sessions: { subagentAddress: () => null },
        useChat: fn => fn({}),
        useSession: fn => fn({ running: false }),
      })
    );`
  })

  const dockActions = page.locator('.dsh-tavern-dock-actions')
  const toggleBtn = page.locator('.dsh-tavern-mobile-dock-toggle')
  const statsToggle = page.locator('.dsh-tavern-mobile-stats-toggle')
  const hostDock = page.locator('[data-composer-dock]')
  const card = page.locator('[data-composer-card]')
  await toggleBtn.waitFor({ state: 'visible' })

  // 1. 默认展开态：显示 dsh-tavern-dock-actions，按钮水平居中位于操作栏与输入框之间
  assert.equal(await dockActions.isVisible(), true, '移动端默认展开显示 dsh-tavern-dock-actions')
  assert.equal(await toggleBtn.getAttribute('aria-expanded'), 'true')
  assert.equal(await toggleBtn.getAttribute('aria-label'), '收起操作栏')

  const expandedGeom = await page.evaluate(() => {
    const r = sel => document.querySelector(sel).getBoundingClientRect()
    const seat = r('[data-composer-seat]')
    const dock = r('.dsh-tavern-dock-actions')
    const tab = r('.dsh-tavern-mobile-dock-toggle-tab')
    const card = r('[data-composer-card]')
    return {
      seatHeight: seat.height,
      dockBottom: dock.bottom,
      tabTop: tab.top,
      tabBottom: tab.bottom,
      cardTop: card.top,
      centerDelta: Math.abs((tab.left + tab.right) / 2 - (card.left + card.right) / 2),
    }
  })
  assert.ok(expandedGeom.dockBottom <= expandedGeom.tabTop + 4, '展开按钮排在 dsh-tavern-dock-actions 下方')
  assert.ok(expandedGeom.tabBottom <= expandedGeom.cardTop + 1, '展开按钮排在输入框卡片上方且不压住输入卡')
  assert.ok(expandedGeom.centerDelta <= 1, `展开按钮水平居中对齐输入框(偏差 ${expandedGeom.centerDelta}px)`)

  assert.equal(await statsToggle.count(), 0, '操作栏不再渲染运行状态展开按钮')
  assert.equal(await hostDock.isVisible(), false, '移动端宿主状态栏始终折叠隐藏')

  // 2. 点击收起：隐藏 dsh-tavern-dock-actions，释放底部输入区高度，持久化偏好
  await toggleBtn.click()
  assert.equal(await dockActions.isVisible(), false, '收起后隐藏 dsh-tavern-dock-actions')
  assert.equal(await hostDock.isVisible(), false, '收起操作栏时宿主状态栏保持隐藏')
  assert.equal(await toggleBtn.isVisible(), true, '收起后展开按钮本身仍在输入框上方可见')
  assert.equal(await toggleBtn.getAttribute('aria-expanded'), 'false')
  assert.equal(await toggleBtn.getAttribute('aria-label'), '展开操作栏')
  assert.equal(await page.evaluate(() => window.__readStorage()), '0', '收起偏好已写入 localStorage')

  const collapsedGeom = await page.evaluate(() => {
    const r = sel => document.querySelector(sel).getBoundingClientRect()
    const seat = r('[data-composer-seat]')
    const tab = r('.dsh-tavern-mobile-dock-toggle-tab')
    const card = r('[data-composer-card]')
    return { seatHeight: seat.height, tabBottom: tab.bottom, cardTop: card.top }
  })
  assert.ok(expandedGeom.seatHeight - collapsedGeom.seatHeight >= 36, `收起后输入区高度显著减少(${expandedGeom.seatHeight} -> ${collapsedGeom.seatHeight})`)
  assert.ok(collapsedGeom.tabBottom <= collapsedGeom.cardTop + 1, '收起态按钮仍位于输入框上方')

  // 3. 切到宽屏桌面视口（非触屏环境验证 CSS 媒体查询）：桌面不显示移动按钮，且操作栏正常可见
  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false })
  t.after(() => desktopContext.close())
  const desktopPage = await desktopContext.newPage()
  await desktopPage.setContent(await page.content())
  // 即使 DOM 上带有移动端收起标记 data-mobile-collapsed="true"，桌面端依然显示操作栏且隐藏移动展开按钮
  const desktopView = await desktopPage.evaluate(() => ({
    dockDisplay: getComputedStyle(document.querySelector('.dsh-tavern-dock-actions')).display,
    rowDisplay: getComputedStyle(document.querySelector('.dsh-tavern-mobile-dock-toggle-row')).display,
  }))
  assert.notEqual(desktopView.dockDisplay, 'none', '桌面端忽略移动端收起标记，保持 dsh-tavern-dock-actions 显示')
  assert.equal(desktopView.rowDisplay, 'none', '桌面端隐藏移动端展开/收起按钮行')

  // 4. 移动端再次点击展开：恢复显示 dsh-tavern-dock-actions
  await toggleBtn.click()
  assert.equal(await dockActions.isVisible(), true, '再次点击恢复显示 dsh-tavern-dock-actions')
  assert.equal(await hostDock.isVisible(), false, '展开操作栏后宿主状态栏仍保持隐藏')
  assert.equal(await toggleBtn.getAttribute('aria-expanded'), 'true')
  assert.equal(await page.evaluate(() => window.__readStorage()), '1', '展开偏好已更新到 localStorage')

  // 5. 候选面板展开为底部抽屉时，展开按钮行随操作栏一起让位隐藏
  await page.evaluate(() => document.getElementById('candidate-panel').classList.remove('collapsed'))
  assert.equal(await toggleBtn.isVisible(), false, '候选抽屉展开时隐藏展开按钮行')
  await page.evaluate(() => document.getElementById('candidate-panel').classList.add('collapsed'))
  assert.equal(await toggleBtn.isVisible(), true, '候选抽屉收起后恢复显示展开按钮行')

  // 6. 极短视口软键盘弹出且输入框聚焦时，展开按钮行一起让位隐藏
  await page.evaluate(() => {
    document.documentElement.classList.add('dsh-tavern-short-viewport')
    document.querySelector('[data-composer-input]').focus()
  })
  assert.equal(await toggleBtn.isVisible(), false, '软键盘极短视口聚焦输入时隐藏展开按钮行')
})
