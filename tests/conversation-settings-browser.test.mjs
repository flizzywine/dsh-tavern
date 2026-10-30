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
