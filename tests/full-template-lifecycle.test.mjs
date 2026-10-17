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

test('长历史分批同步，每批最多八层，续批不重复执行变量修改', async () => {
  const states = await runtime.history({settings:{preload_worldinfo_enabled:false}, transcript:
    Array.from({length:20},()=>({role:'assistant',content:'<% setMessageVar("count", (getMessageVar("count") || 0) + 1) %>值 <%= getMessageVar("count") %>'}))
  }, [{}, {}, {}])
  const rows = Array.isArray(states) ? states : states.states
  assert.ok(rows)
  assert.deepEqual(rows.map(state => state.chat.filter(row => row.template_rendered).length), [8,16,20,20])
  assert.deepEqual(rows.at(-1).chat.map(row => row.variables[0].count), Array.from({length:20}, (_, i) => i + 1))
  assert.deepEqual(rows[3].chat, rows[2].chat)
  assert.deepEqual(rows[2].chat.slice(0,8), rows[0].chat.slice(0,8))
})
