import test from 'node:test'
import assert from 'node:assert/strict'

import * as host from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/host.js'

test('整包宿主拒绝跨会话快照，保存把实际修改交给宿主，缺失能力明确失败', async t => {
  t.after(() => host.disposeTemplateHost())
  const snapshot = {sessionId:'a',chat:[{mes:'opening'}],characters:[],chat_metadata:{variables:{}},extension_settings:{},name1:'User',name2:'Character'}
  let receipt
  host.configureTemplateHost(snapshot, { saveChatConditional: async value => { receipt = structuredClone(value); return { saved: true } } }, { yaml: {} })
  host.chat[0].variables = [{hp:9}]
  assert.deepEqual(await host.saveChatConditional(), {saved:true})
  assert.equal(receipt.chat[0].variables[0].hp, 9)
  assert.throws(()=>host.refreshTemplateSnapshot({...snapshot,sessionId:'b'}), /another session/)
  assert.throws(()=>host.loadWorldInfo('book'), error => error.code === 'PROMPT_TEMPLATE_HOST_UNSUPPORTED')
  host.SlashCommandParser.addCommandObject({name:'probe',callback:async()=>{throw new Error('native rejection')}})
  await assert.rejects(host.runTemplateCommand('probe'), /native rejection/)
})
