import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))

function regex(id, name, enabled = true) {
  return {
    id, name, findRegex: '/<' + id + '>/g', replaceString: name,
    trimStrings: [], placement: [2], enabled, markdownOnly: true,
    promptOnly: false, runOnEdit: true, substituteRegex: 0,
    minDepth: null, maxDepth: null
  }
}

test('手机脚本可读取全局与人物卡正则，并按旧 scope/enable_state 过滤', () => {
  const w = helperHostHarness({ regexScripts: {
    global: [regex('global-on', '全局启用'), regex('global-off', '全局停用', false)],
    character: [regex('card-on', '人物卡启用')]
  } }).window

  assert.equal(typeof w.getTavernRegexes, 'function')
  assert.deepEqual(Array.from(w.getTavernRegexes({ scope: 'all', enable_state: 'enabled' }), item => [item.id, item.scope]), [
    ['global-on', 'global'], ['card-on', 'character']
  ])
  assert.deepEqual(Array.from(w.getTavernRegexes({ type: 'character' }), item => item.script_name), ['人物卡启用'])
})

test('手机脚本导入并更新全局正则后等待宿主持久化', async () => {
  const run = helperHostHarness({ extensionSettings: {}, regexScripts: { global: [], character: [] } })
  const w = run.window
  assert.equal(typeof w.importRawTavernRegex, 'function')
  assert.equal(w.importRawTavernRegex('手机消息', JSON.stringify({
    findRegex: '/<phone>/g', replaceString: '<aside>手机</aside>', placement: [2],
    disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true
  })), true)

  const pending = w.updateTavernRegexesWith(items => {
    items[0].enabled = false
    items[0].scope = 'global'
    return items
  })
  await tick()
  const call = run.calls().at(-1)
  assert.equal(call.method, 'saveTavernExtensionSettings')
  assert.equal(call.args.settings.regex[0].scriptName, '手机消息')
  assert.equal(call.args.settings.regex[0].disabled, true)
  run.reply(call, { updated: true, extensionSettings: call.args.settings })
  const updated = await pending
  assert.equal(updated[0].enabled, false)
})

test('手机脚本读取并更新人物卡变量', async () => {
  const run = helperHostHarness({ characterVariables: { phone_data: { user: { name: '绘梨衣' } } } })
  const w = run.window
  assert.deepEqual(w.getVariables({ type: 'character' }), { phone_data: { user: { name: '绘梨衣' } } })

  const pending = w.updateVariablesWith(value => {
    value.phone_data.user.name = '上杉绘梨衣'
    return value
  }, { type: 'character' })
  await tick()
  const call = run.calls().at(-1)
  assert.equal(call.method, 'updateTavernHelperVariables')
  assert.deepEqual(call.args.option, { type: 'character' })
  assert.deepEqual(call.args.variables, { phone_data: { user: { name: '上杉绘梨衣' } } })
  run.reply(call, { updated: true, characterVariables: call.args.variables })
  assert.deepEqual(await pending, { phone_data: { user: { name: '上杉绘梨衣' } } })
})

// Reduced from StageDog's 自动开启角色卡局部正则: preserve the unguarded
// includes and subsequent API calls so a missing field or empty-array shim fails.
test('CHAT_CHANGED 自动开启局部正则读取宿主实际启用状态，不触发多余保存或重载', async () => {
  const run = helperHostHarness({ character: { path: 'card.json' }, extensionSettings: {} })
  const w = run.window
  vm.runInNewContext(`eventOn(tavern_events.CHAT_CHANGED, async () => {
    const id = SillyTavern.characterId;
    if (id === undefined) return;
    const avatar = SillyTavern.characters[id].avatar;
    const allowed = SillyTavern.extensionSettings.character_allowed_regex;
    if (!allowed.includes(avatar)) {
      allowed.push(avatar);
      await TavernHelper.builtin.saveSettings();
      await SillyTavern.saveChat();
      await SillyTavern.reloadCurrentChat();
    }
  });`, w)
  await w.eventEmit('CHAT_CHANGED', 'chat')
  assert.equal(run.calls().length, 0)
  run.receive({ type: 'dsh-tavern-helper-context', context: { character: { avatar: 'next.png' } } })
  await w.eventEmit('CHAT_CHANGED', 'next')
  assert.equal(run.calls().length, 0)
  assert(w.SillyTavern.extensionSettings.character_allowed_regex.includes('next.png'))
  const save = w.SillyTavern.saveSettingsDebounced()
  await tick()
  const call = run.calls().at(-1)
  assert.equal(Object.hasOwn(call.args.settings, 'character_allowed_regex'), false, '运行时启用状态不写入插件配置')
  run.reply(call, { updated: true, extensionSettings: call.args.settings })
  await save
})
