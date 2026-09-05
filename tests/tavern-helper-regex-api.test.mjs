import assert from 'node:assert/strict'
import test from 'node:test'
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
