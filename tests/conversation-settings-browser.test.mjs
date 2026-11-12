import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

test('注册的本局设置保存玩家称呼、预设、后台模型与前台工具，失败时保留已保存模型', async t => {
  let playerName = '你', preset = null, model = null, disabledTools = [], strategy = 'legacy', screening = true, fail = false
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
        if (Object.hasOwn(args, 'worldbookStrategy')) strategy = args.worldbookStrategy
        if (Array.isArray(args.disabledForegroundTools)) disabledTools = args.disabledForegroundTools
      }
      return {
        backgroundModel: model, worldbookStrategy: strategy, worldbookStrategies: [{ id: 'legacy', label: '外部注入（旧机制）' }, { id: 'native-skills', label: '主动检索（推荐）' }], backgroundTasks: { variables: true, posture: true },
        disabledForegroundTools: disabledTools,
        foregroundTools: [
          { name: 'tavern_recall_history', label: '召回历史', description: '查阅历史正文。' },
          { name: 'submit_story', label: '正文提交', description: '用 submit_story 提交正文。' },
          { name: 'plugin_lookup', label: '插件查询', description: '插件注册的工具。', source: 'plugin' }
        ],
        modelCatalog: [{ provider: 'p', models: [{ id: 'm', name: '测试模型' }] }]
      }
    }
  } })
  const name = page.getByLabel('玩家称呼', { exact: true })
  await page.waitForFunction(() => document.querySelector('[aria-label="玩家称呼"]')?.value === '你')
  await name.fill('旅人')
  await name.press('Tab')
  await page.waitForFunction(() => document.querySelector('.dsh-local-field input')?.disabled === false)
  assert.equal(playerName, '旅人')
  const presetField = page.getByRole('button', { name: /^本局预设：/ })
  await presetField.click()
  await page.getByRole('menuitemradio', { name: '测试预设', exact: true }).click()
  await page.getByRole('button', { name: /^本局预设：.*测试预设/ }).waitFor()
  assert.equal(preset.id, 'presets/one.json')
  const modelField = page.getByRole('button', { name: /^本局后台模型：/ })
  await modelField.click()
  await page.getByRole('menuitemradio', { name: 'p · 测试模型', exact: true }).click()
  await page.getByRole('button', { name: /^本局后台模型：.*测试模型/ }).waitFor()
  assert.deepEqual(model, { provider: 'p', model: 'm' })

  await page.locator('details.dsh-local-advanced > summary').click()
  const worldbook = page.getByLabel('召回历史', { exact: true })
  await worldbook.waitFor()
  assert.equal(await worldbook.isChecked(), true)
  await worldbook.click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="召回历史"]')?.checked === false)
  assert.deepEqual(disabledTools, ['tavern_recall_history'])
  await page.getByRole('button', { name: '全部关闭' }).click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="正文提交"]')?.checked === false)
  assert.deepEqual([...disabledTools].sort(), ['plugin_lookup', 'submit_story', 'tavern_recall_history'])
  await page.getByRole('button', { name: '全部开启' }).click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="正文提交"]')?.checked === true)
  assert.deepEqual(disabledTools, [])
  const plugin = page.getByLabel('插件查询', { exact: true })
  await plugin.waitFor()
  await plugin.click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="插件查询"]')?.checked === false)
  assert.deepEqual(disabledTools, ['plugin_lookup'])

  assert.equal(await page.getByLabel('状态栏位置', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: /^读取方式：/ }).count(), 0)
  assert.equal(await page.getByLabel('世界书模型筛选', { exact: true }).count(), 0)
  assert.equal(calls.some(call => Object.hasOwn(call.args || {}, 'worldbookStrategy')), false)
  fail = true
  await modelField.click()
  await page.getByRole('menuitemradio', { name: '跟随前台', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '保存失败测试' }).waitFor()
  assert.match(await modelField.innerText(), /测试模型/)
  assert.deepEqual(model, { provider: 'p', model: 'm' })
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

  const saveBtn = page.getByRole('button', { name: '保存目前设置为默认模板', exact: true })
  const restoreBtn = page.getByRole('button', { name: '恢复默认模板', exact: true })
  await saveBtn.waitFor()
  await restoreBtn.waitFor()

  // Type a new player name without pressing Tab first, then click Save Default Template directly
  const nameInput = page.getByLabel('玩家称呼', { exact: true })
  await page.waitForFunction(() => document.querySelector('[aria-label="玩家称呼"]')?.value === '阿良')
  await nameInput.fill('云游者')
  await saveBtn.click()
  await page.getByRole('status').filter({ hasText: '已保存目前设置为默认模板' }).waitFor()
  assert.equal(savedTemplate.playerName, '云游者')
  assert.equal(calls.find(c => c.method === 'saveConversationSettingsAsDefaultTemplate').args.sessionId, 'game')

  // Failure path shows alert without wiping current controls
  failRestore = true
  await restoreBtn.click()
  await page.getByRole('alert').filter({ hasText: '正在生成中，无法恢复' }).waitFor()
  assert.equal(await nameInput.inputValue(), '云游者')

  // Success path restores default template and refreshes all child panels
  failRestore = false
  await page.locator('details.dsh-local-advanced > summary').click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="读取网页"]')?.checked === false)
  await restoreBtn.click()
  await page.getByRole('status').filter({ hasText: '已恢复默认模板' }).waitFor()
  await page.waitForFunction(() => document.querySelector('[aria-label="玩家称呼"]')?.value === '默认旅人')
  await page.getByRole('button', { name: /^本局预设：.*不使用酒馆预设/ }).waitFor()
  await page.getByRole('button', { name: /^本局后台模型：.*跟随前台/ }).waitFor()
  await page.waitForFunction(() => document.querySelector('input[aria-label="读取网页"]')?.checked === true)
})
