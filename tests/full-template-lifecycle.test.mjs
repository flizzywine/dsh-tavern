import assert from 'node:assert/strict'
import test from 'node:test'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'

const runtime = await UpstreamTemplateRuntime.create()

test('新轮次、全局变量与设置变化保留旧展示；编辑只更新对应楼层，回退恢复快照', async () => {
  const source='当时的值 <%= getGlobalVar("hp") %>'
  const states=await runtime.history({globalVariables:{hp:7},settings:{preload_worldinfo_enabled:false,raw_message_evaluation_enabled:false},transcript:[{role:'assistant',content:source}]},[
    {global:{hp:9},append:{role:'assistant',content:source}},
    {global:{hp:11},settings:{render_loader_enabled:false}},
    {edit:{index:1,text:'修改后的值 <%= getGlobalVar("hp") %>'}},
    {restore:{from:0}}
  ])
  assert.match(states[0].chat[0].template_display.html,/当时的值 [\s\S]*7/)
  assert.deepEqual(states[1].chat[0].template_display,states[0].chat[0].template_display)
  assert.match(states[1].chat[1].template_display.html,/当时的值 [\s\S]*9/)
  assert.deepEqual(states[2].chat,states[1].chat)
  assert.deepEqual(states[3].chat[0],states[2].chat[0])
  assert.match(states[3].chat[1].template_display.html,/修改后的值 [\s\S]*11/)
  assert.deepEqual(states[4].chat,states[0].chat)
  const rendered=await runtime.page.evaluate(()=>window.historyRenderCounts)
  assert.equal(rendered[2],rendered[1])
  assert.equal(rendered[4],rendered[3])
  assert.ok(rendered[1]>rendered[0] && rendered[3]>rendered[2])
  // A fresh authoritative snapshot with a saved display must not evaluate it again.
  const reopened=await runtime.lifecycle({globalVariables:{hp:99},settings:{preload_worldinfo_enabled:false,raw_message_evaluation_enabled:false},transcript:states[0].chat.map(row=>({...row,role:'assistant',content:row.mes}))})
  assert.deepEqual(reopened.first.chat[0].template_display,states[0].chat[0].template_display)
})
