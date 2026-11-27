import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

async function until(check) { for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 50)); assert.ok(check()) }
// the 前台工具 section's ⋯ menu, its fold, and the 模板 menu of the page head.
async function toolMenu(page, item) { await page.getByRole('button', { name: '前台工具操作', exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click() }
const openTools = page => page.locator('.ap-section-toggle', { hasText: '前台工具' }).click()
async function templateMenu(page, item) { await page.getByRole('button', { name: '模板', exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click() }

test('普通卡和舞台卡都能从本局设置进入舞台设置', async t => {
  for (const [name, stage, status] of [
    ['普通卡默认关', { isStageCard: false, dialogue: false, stage: false }, '未开启'],
    ['舞台卡自动开', { isStageCard: true, dialogue: true, stage: true }, '舞台模式已开启'],
    ['气泡卡', { isStageCard: false, dialogue: true, stage: false }, '仅对话气泡']
  ]) {
    await t.test(name, async t => {
      const { page } = await openTavernSettings(t, { sessionId: 'game', respond(method) {
        if (method === 'listSessions') return { sessions: [{ sessionId: 'game', mode: 'story' }] }
        if (method === 'getSession') return { view: { sessionId: 'game', mode: 'story', playerName: name, stage } }
        if (method === 'getConversationBackgroundConfig') return { backgroundTasks: {}, modelCatalog: [] }
        if (method === 'listGamePlugins') return { plugins: { settings: [] } }
        if (method === 'getConversationWritingSkills') return { skills: [] }
      } })
      await page.waitForFunction(name => document.querySelector('[aria-label="玩家称呼"]')?.value === name, name)
      await page.getByRole('button', { name: '舞台', exact: true }).waitFor()
      await page.getByRole('button', { name: '打开舞台设置', exact: true }).waitFor()
      await page.getByText(status, { exact: true }).waitFor()
    })
  }
})

test('注册的本局设置保存玩家称呼、预设、后台模型与前台工具，失败时保留已保存模型', async t => {
  let playerName = '你', preset = null, model = null, disabledTools = [], fail = false, candidateTabs = true
  const { page, calls } = await openTavernSettings(t, { sessionId: 'game', respond(method, args) {
    if (method === 'listSessions') return { sessions: [{ sessionId: 'game', mode: 'story' }] }
    if (method === 'getSession') return { view: { sessionId: 'game', mode: 'story', playerName, runtimePreset: preset, statusBarPlacement: 'sidebar' } }
    if (method === 'listPresets') return { presets: [{ path: 'presets/one.json', title: '测试预设', valid: true, recognized: true }] }
    if (method === 'getUserPreferenceProfile') return { userProfile: { profiles: [] }, currentConversation: { enabled: false } }
    if (method === 'listGamePlugins') return { plugins: { plugins: [], errors: [], settings: [], tasks: { settlement: [], manual: [] } } }
    if (method === 'getConversationWritingSkills') return { skills: [] }
    if (method === 'setPlayerName') { playerName = args.userName; return { playerName } }
    if (method === 'applyConversationPreset') { preset = { id: args.path, name: '测试预设' }; return {} }
    if (method === 'getBackgroundModelReasoning') return { reasoning: { efforts: [{ id: 'high', name: 'High' }] } }
    if (method === 'setConversationBackgroundConfig' && fail) throw Error('保存失败测试')
    if (method === 'getConversationBackgroundConfig' || method === 'setConversationBackgroundConfig') {
      if (method === 'setConversationBackgroundConfig') {
        if (Object.hasOwn(args, 'backgroundModel')) model = args.backgroundModel
        if (Object.hasOwn(args, 'candidateTabs')) candidateTabs = args.candidateTabs
        if (Array.isArray(args.disabledForegroundTools)) disabledTools = args.disabledForegroundTools
      }
      return {
        backgroundModel: model, worldbookStrategy: 'plugin-demo', worldbookStrategies: [{ id: 'plugin-demo', label: '旧版策略' }],
        backgroundTasks: { variables: true, posture: true },
        disabledForegroundTools: disabledTools, candidateTabs,
        foregroundTools: [
          { name: 'tavern_recall_history', label: '召回历史', description: '查阅历史正文。' },
          { name: 'tavern_read_variables', label: '读取变量', description: '只读查询当前变量。' },
          { name: 'plugin_lookup', label: '插件查询', description: '插件注册的工具。', source: 'plugin' }
        ],
        modelCatalog: [{ provider: 'p', models: [{ id: 'm', name: '测试模型' }] }]
      }
    }
  } })
  const name = page.getByLabel('玩家称呼', { exact: true })
  await page.waitForFunction(() => document.querySelector('[aria-label="玩家称呼"]')?.value === '你')
  for (const [label, text] of [
    ['玩家称呼', '留空时使用「你」'],
    ['预设', '提示词和正则'],
    ['长期偏好', '游玩和写作偏好'],
    ['候选项数量', '4 条行动和 1 条场景切换'],
  ]) {
    await page.getByRole('button', { name: label + '说明', exact: true }).hover()
    await page.locator('.fork-help-tip-body').filter({ hasText: text }).waitFor({ state: 'visible' })
  }
  await name.fill('旅人')
  await name.press('Tab')
  await until(() => playerName === '旅人')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const presetField = page.getByRole('button', { name: /^本局预设：/ })
  await presetField.click()
  await page.getByRole('menuitemradio', { name: '测试预设', exact: true }).click()
  await page.getByRole('button', { name: /^本局预设：.*测试预设/ }).waitFor()
  assert.equal(preset.id, 'presets/one.json')
  const modelField = page.getByRole('button', { name: /^本局后台模型：/ })
  const effortField = page.getByRole('button', { name: /^本局后台推理强度：/ })
  await modelField.click()
  await page.getByRole('menuitemradio', { name: '测试模型', exact: true }).click()
  await page.getByRole('button', { name: /^本局后台模型：.*测试模型/ }).waitFor()
  assert.deepEqual(model, { provider: 'p', model: 'm' })
  await effortField.click()
  await page.getByRole('menuitemradio', { name: /^High/ }).click()
  await page.getByRole('button', { name: /^本局后台推理强度：High/ }).waitFor()
  assert.deepEqual(model, { provider: 'p', model: 'm', reasoningEffort: 'high' })

  await page.getByRole('button', { name: '候选项数量：大量候选', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '少量候选', exact: true }).click()
  await page.getByRole('button', { name: '候选项数量：少量候选', exact: true }).waitFor()
  assert.equal(candidateTabs, false)

  await openTools(page)
  const worldbook = page.getByLabel('召回历史', { exact: true })
  await worldbook.waitFor()
  assert.equal(await worldbook.isChecked(), true)
  await worldbook.click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="召回历史"]')?.checked === false)
  assert.deepEqual(disabledTools, ['tavern_recall_history'])
  await toolMenu(page, '全部关闭')
  await page.waitForFunction(() => document.querySelector('input[aria-label="读取变量"]')?.checked === false)
  assert.deepEqual([...disabledTools].sort(), ['plugin_lookup', 'tavern_read_variables', 'tavern_recall_history'])
  await toolMenu(page, '全部开启')
  await page.waitForFunction(() => document.querySelector('input[aria-label="读取变量"]')?.checked === true)
  assert.deepEqual(disabledTools, [])
  const plugin = page.getByLabel('插件查询', { exact: true })
  await plugin.waitFor()
  await plugin.click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="插件查询"]')?.checked === false)
  assert.deepEqual(disabledTools, ['plugin_lookup'])

  assert.equal(await page.getByLabel('状态栏位置', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: /^读取方式：/ }).count(), 0)
  assert.equal(await page.getByLabel('世界书模型筛选', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: /^世界书策略(?:：|说明)/ }).count(), 0)
  assert.equal(calls.some(call => Object.hasOwn(call.args || {}, 'worldbookStrategy')), false)
  fail = true
  await modelField.click()
  await page.getByRole('menuitemradio', { name: '跟随前台', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '保存失败测试' }).waitFor()
  assert.match(await modelField.innerText(), /测试模型/)
  assert.deepEqual(model, { provider: 'p', model: 'm', reasoningEffort: 'high' })
  for (const call of calls.filter(call => ['setPlayerName', 'applyConversationPreset', 'setConversationBackgroundConfig'].includes(call.method))) {
    assert.equal(call.args.sessionId, 'game')
  }
})

test('本局设置顶栏支持保存目前设置为默认模板与恢复默认模板并刷新界面', async t => {
  let state = {
    playerName: '阿良',
    preset: { id: 'presets/reborn.json', name: 'Reborn2.4.2' },
    model: { provider: 'reapi', model: 'deepseek/deepseek-v4.1-flash-thinking-max' },
    backgroundTasks: { variables: true, posture: false, styleReference: false },
    webSearchEnabled: false,
    disabledTools: ['web_fetch']
  }
  let savedTemplate = null
  let failRestore = false
  const { page, calls } = await openTavernSettings(t, {
    sessionId: 'game',
    contextOptions: { viewport: { width: 960, height: 1100 } },
    respond(method, args) {
      if (method === 'listSessions') return { sessions: [{ sessionId: 'game', mode: 'story' }] }
      if (method === 'getSession') return { view: { sessionId: 'game', mode: 'story', playerName: state.playerName, runtimePreset: state.preset, statusBarPlacement: 'sidebar' } }
      if (method === 'listPresets') return { presets: [{ path: 'presets/reborn.json', title: 'Reborn2.4.2', valid: true, recognized: true }] }
      if (method === 'getUserPreferenceProfile') return { userProfile: { profiles: [] }, currentConversation: { enabled: false } }
      if (method === 'listGamePlugins') return { plugins: { plugins: [], errors: [], settings: [], tasks: { settlement: [], manual: [] } } }
      if (method === 'getConversationWritingSkills') return { skills: [] }
      if (method === 'setPlayerName') { state = { ...state, playerName: args.userName }; return { playerName: state.playerName } }
      if (method === 'getBackgroundModelReasoning') return { reasoning: { efforts: [{ id: 'high', name: 'High' }] } }
      if (method === 'getConversationBackgroundConfig') {
        return {
          backgroundModel: state.model,
          worldbookStrategy: 'native-skills',
          worldbookStrategies: [{ id: 'native-skills', label: '主动检索' }],
          backgroundTasks: state.backgroundTasks,
          webSearchEnabled: state.webSearchEnabled,
          disabledForegroundTools: state.disabledTools,
          foregroundTools: [
            { name: 'tavern_recall_history', label: '召回历史', description: '查阅历史正文。' },
            { name: 'web_fetch', label: '读取网页', description: '读取网页正文。' }
          ],
          modelCatalog: [{ provider: 'reapi', models: [{ id: 'deepseek/deepseek-v4.1-flash-thinking-max', name: 'deepseek/deepseek-v4.1-flash-thinking-max' }] }]
        }
      }
      if (method === 'saveConversationSettingsAsDefaultTemplate') {
        savedTemplate = structuredClone(state)
        return { saved: true, warnings: [] }
      }
      if (method === 'restoreConversationSettingsFromDefaultTemplate') {
        if (failRestore) throw new Error('正在生成中，无法恢复')
        state = {
          playerName: '默认旅人',
          preset: null,
          model: null,
          backgroundTasks: { variables: true, posture: true, styleReference: true },
          webSearchEnabled: true,
          disabledTools: []
        }
        return { restored: true, warnings: [] }
      }
    }
  })

  await page.getByRole('button', { name: '模板', exact: true }).waitFor()

  // Type a new player name without pressing Tab first, then click Save Default Template directly
  const nameInput = page.getByLabel('玩家称呼', { exact: true })
  await page.waitForFunction(() => document.querySelector('[aria-label="玩家称呼"]')?.value === '阿良')
  await nameInput.fill('云游者')
  await templateMenu(page, '保存目前设置为默认模板')
  await page.getByRole('status').filter({ hasText: '已保存目前设置为默认模板' }).waitFor()
  assert.equal(savedTemplate.playerName, '云游者')
  assert.equal(calls.find(c => c.method === 'saveConversationSettingsAsDefaultTemplate').args.sessionId, 'game')

  // Failure path shows alert without wiping current controls
  failRestore = true
  await templateMenu(page, '恢复默认模板')
  await page.getByRole('alert').filter({ hasText: '正在生成中，无法恢复' }).waitFor()
  assert.equal(await nameInput.inputValue(), '云游者')

  // Success path restores default template and refreshes all child panels
  failRestore = false
  await openTools(page)
  await page.waitForFunction(() => document.querySelector('input[aria-label="读取网页"]')?.checked === false)
  await templateMenu(page, '恢复默认模板')
  await page.getByRole('status').filter({ hasText: '已恢复默认模板' }).waitFor()
  await page.waitForFunction(() => document.querySelector('[aria-label="玩家称呼"]')?.value === '默认旅人')
  await page.getByRole('button', { name: /^本局预设：.*不使用酒馆预设/ }).waitFor()
  await page.getByRole('button', { name: /^本局后台模型：.*跟随前台/ }).waitFor()
  await page.waitForFunction(() => document.querySelector('input[aria-label="读取网页"]')?.checked === true)
})

test('本局设置功能区包含“后台任务附加预设”开关，默认关闭且可保存并从默认模板恢复', async t => {
  let backgroundTasks = { variables: true, posture: true }
  const { page, calls } = await openTavernSettings(t, {
    sessionId: 'game',
    respond(method, args) {
      if (method === 'listSessions') return { sessions: [{ sessionId: 'game', mode: 'story' }] }
      if (method === 'getSession') return { view: { sessionId: 'game', mode: 'story', playerName: '你', runtimePreset: null, statusBarPlacement: 'sidebar' } }
      if (method === 'listPresets') return { presets: [] }
      if (method === 'getUserPreferenceProfile') return { userProfile: { profiles: [] }, currentConversation: { enabled: false } }
      if (method === 'listGamePlugins') return { plugins: { plugins: [], errors: [], settings: [], tasks: { settlement: [], manual: [] } } }
      if (method === 'getConversationWritingSkills') return { skills: [] }
      if (method === 'getBackgroundModelReasoning') return { reasoning: { efforts: [] } }
      if (method === 'setConversationBackgroundConfig') {
        backgroundTasks = { ...backgroundTasks, ...args.backgroundTasks }
      }
      if (method === 'getConversationBackgroundConfig' || method === 'setConversationBackgroundConfig') {
        return {
          backgroundModel: null,
          worldbookStrategy: 'native-skills',
          worldbookStrategies: [{ id: 'native-skills', label: '主动检索' }],
          backgroundTasks,
          disabledForegroundTools: [],
          foregroundTools: [],
          modelCatalog: []
        }
      }
    }
  })
  const presetSwitch = page.getByRole('switch', { name: '后台任务附加预设', exact: true })
  await presetSwitch.waitFor()
  assert.equal(await page.getByRole('switch', { name: '人物姿势', exact: true }).count(), 0)
  assert.equal(await presetSwitch.isChecked(), false)
  await presetSwitch.press('Space')
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="后台任务附加预设"]')?.checked === true)
  const lastSave = calls.filter(c => c.method === 'setConversationBackgroundConfig').at(-1)
  assert.deepEqual(lastSave.args.backgroundTasks, { preset: true })
})

test('本局设置随舞台和剧情罗盘的启用状态显示与隐藏', async t => {
  let stage = true, compass = true
  const { page, calls } = await openTavernSettings(t, { sessionId: 'game', respond(method) {
    if (method === 'listSessions') return { sessions: [{ sessionId: 'game', mode: 'story' }] }
    if (method === 'getSession') return { view: { sessionId: 'game', mode: 'story' } }
    if (method === 'getConversationWritingSkills') return { skills: [] }
    if (method === 'getConversationBackgroundConfig') return {
      backgroundTasks: {}, modelCatalog: [],
      foregroundTools: stage ? [{ name: 'stage_probe', label: '舞台工具' }] : [],
      modModelSlots: stage ? [{ modId: 'dsh.stage', modName: '舞台', id: 'director', label: '导演模型' }] : []
    }
    if (method === 'listGamePlugins') return { plugins: { settings: compass ? [{
      plugin: 'dsh-tavern-plot-compass', title: '剧情罗盘',
      fields: [{ key: 'maxRoutes', type: 'number', label: '剧情规划条目上限' }],
      values: { maxRoutes: 4 }
    }] : [] } }
  } })
  // the stage's own options and models live in 舞台设置; here a module going away takes its tools and plugin options with it.
  const compassSection = page.locator('section.dsh-tavern-plugin-settings', { hasText: '剧情罗盘' })
  await compassSection.waitFor()
  assert.equal(await compassSection.getByLabel('剧情规划条目上限').inputValue(), '4')
  await openTools(page)
  const stageTool = page.getByLabel('舞台工具', { exact: true })
  await stageTool.waitFor()
  const backgroundReads = () => calls.filter(call => call.method === 'getConversationBackgroundConfig').length
  assert.equal(backgroundReads(), 1)

  async function refreshModules() {
    await page.evaluate(() => {
      window.__tavernTestSignal('plugin:dsh-tavern-stage', 'stage-settings')
      window.__tavernTestSignal('game', 'plugin-settings')
      window.dispatchEvent(new CustomEvent('dsh-tavern-mods-changed'))
    })
  }
  stage = compass = false
  await refreshModules()
  await compassSection.waitFor({ state: 'detached' })
  await stageTool.waitFor({ state: 'detached' })
  assert.equal(backgroundReads(), 2)
  await page.getByRole('button', { name: /^本局后台模型：/ }).waitFor()
  stage = compass = true
  await refreshModules()
  await compassSection.waitFor()
  await stageTool.waitFor()
  assert.equal(backgroundReads(), 3)
})
