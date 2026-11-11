import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectCardExtensions } from '../tavern-plugin/lib/domain/card-extension-reading.js'

test('only bound content packs offer pack selection during card export', () => {
  const card = { extensions: { dsh_tavern: { stage: { enabled: true } } } }
  const tavern = card.extensions.dsh_tavern
  assert.equal(inspectCardExtensions(card).hasSelectableAssetPacks, false)
  const configPackId = '11111111-1111-4111-8111-111111111111'
  tavern.modConfigPackId = configPackId
  tavern.assetBindings = { boundPackIds: [configPackId] }
  assert.equal(inspectCardExtensions(card).hasSelectableAssetPacks, false)
  tavern.assetBindings.boundPackIds.push('22222222-2222-4222-8222-222222222222')
  assert.equal(inspectCardExtensions(card).hasSelectableAssetPacks, true)
})

test('读取包装式 TavernHelper_scripts，保留配置并进入实际运行投影', async () => {
  const { projectTavernHelperScripts } = await import('../tavern-plugin/lib/domain/tavern-helper-scripts.js')
  const value = { id:'wizard', name:'开场白向导', enabled:true, content:'window.wizard = true', data:{page:2}, info:'说明', button:{buttons:[{name:'重开'}]}, export_with:true }
  const extensions = { TavernHelper_scripts:[
    {type:'script',value},
    {type:'script',value:{id:'off',enabled:false,content:'throw Error()'}},
    {type:'folder',value:{id:'folder',content:'must not run'}},
    null, {type:'script',value:null}
  ] }
  const card = {spec:'chara_card_v3',data:{extensions}}
  const before = structuredClone(card), result = inspectCardExtensions(card)
  assert.equal(result.helperScripts.length, 2)
  assert.equal(result.otherExtensions.length, 0)
  const scripts = projectTavernHelperScripts(result.helperScripts).scripts
  assert.equal(scripts.length, 1)
  assert.equal(scripts[0].id, 'wizard')
  assert.equal(scripts[0].name, value.name)
  assert.equal(scripts[0].content, value.content)
  assert.deepEqual(scripts[0].data, value.data)
  assert.deepEqual(scripts[0].buttons, value.button.buttons)
  assert.equal(scripts[0].info, value.info)
  assert.equal(result.helperScripts[0].exportWith, true)
  result.helperScripts[0].data.page = 9
  assert.deepEqual(card, before)
})
