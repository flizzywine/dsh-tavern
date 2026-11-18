import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

// Mount the shipped sidebar and dock. listSessions populates mode through the
// real sidebar, so this exercises the registered click handler and HTTP client.
async function mount(t, outcome, { mode = 'story', settings, browser: sharedBrowser, viewport, hasTouch } = {}) {
  const browser = sharedBrowser || await chromium.launch({ headless: true })
  if (!sharedBrowser) t.after(() => browser.close())
  const page = await browser.newPage({ viewport, hasTouch })
  page.setDefaultTimeout(5000)
  const errors = [], calls = [], unexpected = []
  page.on('pageerror', error => errors.push(error.message))
  let attempts = 0, task = null
  const sync = () => ({ activity: { busy: false, phase: 'idle' }, task, tasks: { candidate: task, background: null } })
  await page.route('http://tavern.test/**', async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1)
    if (!route.request().url().includes('/api/dsh-tavern/')) {
      // As on a phone, the sidebar is out of the way while the player uses the composer.
      const sidebar = settings ? '<main id="sidebar" style="display:none"></main>' : '<main id="sidebar"></main>'
      return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1">' + sidebar + '<div id="dock"></div>' })
    }
    const args = route.request().postDataJSON() || {}
    calls.push({ method, args })
    let result
    if (method === 'submitTask') {
      attempts++
      if (outcome === 'timeout' && attempts === 1) return
      if (outcome === 'network' || outcome === 'recover' && attempts === 1) return route.abort('failed')
      if (outcome === 'reject') result = { ok: false, error: '候选输入已过期' }
      else {
        task = { taskId: 'candidate-1', kind: 'candidate', input: { messageId: 'reply-1' }, status: 'queued', busy: true }
        result = { ok: true, sync: sync() }
      }
    } else if (settings && ['getCandidateGuidanceShortcuts', 'saveCandidateGuidanceShortcuts'].includes(method)) {
      try { result = { ok: true, ...await settings[method](args) } }
      catch (error) { result = { ok: false, error: error.message, errorCode: error.code } }
    } else {
      const responses = {
        listCards: { cards: [] },
        getCardOrganization: { organization: { groups: [], assignments: {} } },
        listSessions: { sessions: [{ sessionId: 'game', chatId: 'chat', mode, cardName: '测试' }] },
        getUpdateStatus: { status: { phase: 'idle', host: 'cli' } },
        getHostCompatibility: {},
        confirmSessionPatch: {},
        gameMode: args.op === 'list' ? { modes: [] } : { mode: null },
        syncSession: { sync: sync() },
        getSession: { view: { mode, latestAssistantTurn: 1, activity: { busy: false }, tavernHelper: { messages: [] } } },
        getActiveInterfaceSkin: { css: '' },
        getTavernSettings: { settings: {} }, // composer and sidebar preferences
        getChoices: { candidates: settings ? { choices: ['继续走近'] } : null },
        loadSessionPreviews: { previews: {} },
        cardPluginScopes: { scopes: {} }, // plugin composer actions wait for which plugins belong to which cards
      }
      if (!(method in responses)) unexpected.push(method)
      result = { ok: true, ...responses[method] }
    }
    await route.fulfill({ json: result })
  })
  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||{});}};` })
  await page.addScriptTag({ content: clientSource })
  await page.evaluate(() => {
    const slots = {}, noop = () => () => {}
    const sessionState = { current: '', byId: {} }
    const ctx = {
      inject() { return { dispose() {} } },
      get() {}, provide() {},
      effect(run, label) {
        if (['dsh-tavern: Tavern workspace browser', 'dsh-tavern: candidate dock actions', 'dsh-tavern: candidate guide panel'].includes(label)) return run()
        return () => {}
      },
      slots: { inject(_name, run) { return run() }, register(spec, component) { slots[spec.id || spec.name] = component; return () => {} } },
      sessions: { subagentAddress: () => null, refresh: async () => {}, list: { getSnapshot: () => sessionState }, binding: () => null },
      workspaces: {}, betterSidebar: {},
      tavernSessionSignals: { subscribe: noop },
    }
    window.client.apply(ctx)
    const React = modules.react
    modules['react-dom/client'].createRoot(document.querySelector('#sidebar')).render(React.createElement(slots['sidebar.workspaces'], {
      wide: true, useSessions: select => select(sessionState), useWorkspaces: select => select({ items: [] }), renderSlot: () => null,
    }))
    // A top-level play session shows its round actions in the composer (input.left).
    const props = {
      sessionId: 'game', messageId: 'reply-1', useSession: select => select({ running: false }), useInput: select => select({ draft: '' }),
      useChat: select => select({ legacy: { nodes: [{ kind: 'assistant', messageId: 'reply-1' }] } }),
    }
    modules['react-dom/client'].createRoot(document.querySelector('#dock')).render(React.createElement(React.Fragment, null,
      React.createElement(slots['dsh-tavern-candidate-actions'], props), React.createElement(slots['dsh-tavern-candidate-guide'], props)))
  })
  await page.getByRole('button', { name: settings ? '重新生成候选项' : '生成候选项', exact: true }).waitFor()
  return { page, calls, errors, unexpected }
}

test('候选快捷提示可保存、编辑和排序，重开后按模式读回并恢复默认', async t => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'tavern-candidate-shortcuts-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const storyDefaults = ['让对手戏角色更主动', '多点暧昧动作', '增加突发插曲', '场景换到白天户外']
  const scriptDefaults = ['侧重角色行动', '直接开新场景']
  const shortcutSelector = '.dsh-tavern-candidate-shortcut-chip'

  async function openGuide(mode, options) {
    // Each new page reads from a new settings service backed by the same profile directory.
    const store = createProfileDataStore({ dataRoot })
    const path = 'tavern-settings.json'
    const settings = createSettingsHandlers({
      readTavernSettings: async () => presentTavernSettings(await store.readJson(path), {}),
      updateTavernSettings: async patch => presentTavernSettings(await store.updateJson(path, current => applyTavernSettingsPatch(current, patch)), {}),
    })
    const run = await mount(t, 'guide', { mode, settings, browser, ...options })
    const { page } = run
    await page.getByRole('button', { name: '重新生成候选项', exact: true }).click()
    const manage = page.getByRole('button', { name: '管理', exact: true })
    await manage.waitFor()
    return { ...run, manage, input: page.getByPlaceholder('对候选的要求（可选）'),
      saveDraft: page.getByRole('button', { name: '保存为快捷提示' }),
      dialog: page.getByRole('dialog', { name: '管理快捷提示' }), chips: page.locator(shortcutSelector) }
  }

  async function checkOrder(page, texts) {
    await page.waitForFunction(({ selector, texts }) => {
      const actual = Array.from(document.querySelectorAll(selector), button => button.textContent)
      return actual.length === texts.length && actual.every((text, index) => text === texts[index])
    }, { selector: shortcutSelector, texts })
  }

  const story = await openGuide('story', { viewport: { width: 390, height: 680 }, hasTouch: true })
  await checkOrder(story.page, storyDefaults)
  assert.equal(await story.saveDraft.isDisabled(), true, '空要求不能保存')
  await story.chips.first().click()
  assert.equal(await story.input.inputValue(), storyDefaults[0])
  await story.chips.nth(1).click()
  assert.equal(await story.input.inputValue(), storyDefaults[0] + '；' + storyDefaults[1])
  const draft = '保持当前场景，让配角主动推进剧情'
  await story.input.fill(draft)
  await story.saveDraft.click()
  await checkOrder(story.page, [...storyDefaults, draft])
  assert.equal(await story.input.inputValue(), draft)

  await story.manage.click()
  await story.dialog.getByText('普通模式', { exact: true }).waitFor()
  await story.dialog.getByRole('button', { name: '新增快捷提示' }).click()
  const long = '保留当前地点和时间。\n' + '让等候已久的配角先提出一个可以马上行动的建议。'.repeat(28)
  const editor = story.dialog.getByRole('textbox', { name: '快捷提示内容' })
  const saveEdit = story.dialog.getByRole('button', { name: '保存', exact: true })
  await editor.fill(long)
  await saveEdit.click()
  await editor.waitFor({ state: 'hidden' })
  await checkOrder(story.page, [...storyDefaults, draft, long])
  assert.equal(await story.chips.last().evaluate(chip => chip.scrollWidth > chip.clientWidth), true, '长提示在按钮上省略显示')
  const [scrollWidth, clientWidth] = await story.dialog.evaluate(dialog => {
    const body = dialog.querySelector('.fork-modal-body')
    return [body.scrollWidth, body.clientWidth]
  })
  assert.equal(scrollWidth, clientWidth, '手机上的管理列表不必横向滚动')

  const revised = '保持当前场景，让配角先提议查找信件'
  await story.dialog.getByRole('button', { name: '编辑第 5 条快捷提示' }).click()
  assert.equal(await editor.inputValue(), draft)
  await editor.fill(revised)
  await saveEdit.click()
  await editor.waitFor({ state: 'hidden' })
  await story.dialog.getByRole('button', { name: '上移第 5 条快捷提示' }).click()
  await checkOrder(story.page, [...storyDefaults.slice(0, 3), revised, storyDefaults[3], long])
  await story.dialog.getByRole('button', { name: '下移第 4 条快捷提示' }).click()
  await checkOrder(story.page, [...storyDefaults, revised, long])
  await story.dialog.getByRole('button', { name: '下移第 4 条快捷提示' }).click()
  await story.dialog.getByRole('button', { name: '删除第 2 条快捷提示' }).click()
  const storyCustom = [storyDefaults[0], storyDefaults[2], revised, storyDefaults[3], long]
  await checkOrder(story.page, storyCustom)
  await story.page.keyboard.press('Escape')
  await story.dialog.waitFor({ state: 'hidden' })
  assert.equal(await story.input.inputValue(), draft, '管理时保留重生成草稿')
  assert.equal(story.calls.some(call => call.method === 'submitTask'), false)

  const script = await openGuide('script')
  await checkOrder(script.page, scriptDefaults)
  const scriptDraft = '照剧本推进，让主角先调查门口'
  await script.input.fill(scriptDraft)
  await script.saveDraft.click()
  await checkOrder(script.page, [...scriptDefaults, scriptDraft])
  await script.manage.click()
  await script.dialog.getByText('剧本模式', { exact: true }).waitFor()
  await script.dialog.getByRole('button', { name: '恢复默认' }).click()
  await checkOrder(script.page, scriptDefaults)
  const deleteFirst = script.dialog.getByRole('button', { name: '删除第 1 条快捷提示' })
  await deleteFirst.click()
  await checkOrder(script.page, scriptDefaults.slice(1))
  await deleteFirst.press('Enter')
  await script.dialog.getByText('还没有快捷提示').waitFor()
  await checkOrder(script.page, [])
  await script.page.keyboard.press('Tab')
  assert.equal(await script.dialog.evaluate(dialog => dialog.contains(document.activeElement)), true, '键盘删除后焦点留在管理弹窗内')

  const reopenedScript = await openGuide('script')
  await checkOrder(reopenedScript.page, [])
  const reopenedStory = await openGuide('story')
  await checkOrder(reopenedStory.page, storyCustom)
  await reopenedStory.input.fill('先留在房间')
  await reopenedStory.chips.last().click()
  assert.equal(await reopenedStory.input.inputValue(), '先留在房间；' + long)
  assert.equal(reopenedStory.calls.some(call => call.method === 'submitTask'), false, '快捷提示只填入全文')
  await reopenedStory.input.fill('先留在房间；确认信件的来历')
  const submitted = reopenedStory.page.waitForResponse(response => response.url().endsWith('/submitTask'))
  await reopenedStory.page.getByRole('button', { name: '重新生成', exact: true }).click()
  await submitted
  const [request] = reopenedStory.calls.filter(call => call.method === 'submitTask')
  assert.equal(request.args.guidance, '先留在房间；确认信件的来历')
  for (const run of [story, script, reopenedScript, reopenedStory]) {
    assert.deepEqual(run.unexpected, [])
    assert.deepEqual(run.errors, [])
  }
})

test('候选快捷提示管理弹窗在键盘保存期间保留焦点，失败后可重试', async t => {
  const pendingDraft = Promise.withResolvers()
  const pendingEdit = Promise.withResolvers()
  let saves = 0
  const settings = {
    getCandidateGuidanceShortcuts: async () => ({ shortcuts: { story: [] } }),
    saveCandidateGuidanceShortcuts: async ({ items }) => {
      saves++
      if (saves === 1) await pendingDraft.promise
      if (saves === 2) await pendingEdit.promise
      return { shortcuts: { story: items } }
    },
  }
  const { page } = await mount(t, 'guide', { settings })
  await page.getByRole('button', { name: '重新生成候选项', exact: true }).click()
  await page.getByPlaceholder('对候选的要求（可选）').fill('先调查门口')
  await page.getByRole('button', { name: '保存为快捷提示' }).press('Enter')
  await page.getByText('正在保存快捷提示…').waitFor()
  await page.getByRole('button', { name: '管理', exact: true }).press('Enter')
  const dialog = page.getByRole('dialog', { name: '管理快捷提示' })
  await dialog.getByText('正在保存快捷提示…').waitFor()
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
  pendingDraft.resolve()
  await dialog.getByRole('button', { name: '编辑第 1 条快捷提示' }).and(page.locator(':enabled')).press('Enter')

  const editor = dialog.getByRole('textbox', { name: '快捷提示内容' })
  const save = dialog.getByRole('button', { name: '保存', exact: true })
  await editor.fill('再调查窗户')
  await save.press('Enter')
  await dialog.getByText('正在保存快捷提示…').waitFor()
  assert.equal(await editor.evaluate(node => node === document.activeElement), true)
  pendingEdit.reject(new Error('模拟保存失败'))
  await dialog.getByText(/模拟保存失败/).waitFor()
  assert.equal(await editor.evaluate(node => node === document.activeElement), true)
  assert.equal(await editor.inputValue(), '再调查窗户')
  await save.press('Enter')
  await editor.waitFor({ state: 'hidden' })
  await dialog.getByText('再调查窗户', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '新增快捷提示' }).and(page.locator(':focus')).waitFor()
})

for (const [outcome, contract] of [
  ['recover', '网络失败后复用请求标识并恢复提交'],
  ['timeout', '响应超时会取消请求并使用同一标识重试'],
  ['network', '持续网络失败只提交三次并解除忙碌状态'],
  ['reject', '业务拒绝不会重试'],
]) {
  test(`候选按钮：${contract}`, async t => {
    const { page, calls, errors, unexpected } = await mount(t, outcome)
    const succeeds = outcome === 'recover' || outcome === 'timeout'
    const submitted = succeeds ? page.waitForResponse(response => response.url().endsWith('/submitTask') && response.ok()) : null
    await page.getByRole('button', { name: '生成候选项', exact: true }).click()
    if (succeeds) {
      await submitted
      await page.getByRole('button', { name: '生成中…', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '生成中…', exact: true }).isDisabled(), true)
    } else {
      // The handler releases its busy state only after its retry/error path ends.
      await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === '生成候选项' && !button.disabled))
    }
    const requests = calls.filter(call => call.method === 'submitTask')
    assert.equal(requests.length, succeeds ? 2 : outcome === 'network' ? 3 : 1)
    assert.ok(requests[0].args.requestId)
    assert.equal(new Set(requests.map(call => call.args.requestId)).size, 1, 'all transport retries must reuse the original request identity')
    for (const { args } of requests) {
      assert.equal(args.sessionId, 'game')
      assert.equal(args.messageId, 'reply-1')
      assert.equal(args.kind, 'candidate')
    }
    assert.deepEqual(unexpected, [])
    assert.deepEqual(errors, [])
  })
}
