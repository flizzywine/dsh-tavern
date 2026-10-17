import assert from 'node:assert/strict'
import test from 'node:test'

import { createMvuBackgroundTaskFrame, createMvuSettlementModule, projectMvuBackgroundRequest } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

test('failed posture can be corrected after variables succeed without repeating variable execution', async () => {
  let writes = 0
  const module = createMvuSettlementModule({
    model: { async run(input) {
      assert.equal(JSON.parse(await input.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [] } })).ok, true)
      assert.equal(input.stopToolsWhen(), false)
      assert.equal(input.acceptWithoutText(), false)
      assert.equal(JSON.parse(await input.onToolCall({ name: 'posture_submit', arguments: { posture: '' } })).retryable, true)
      assert.equal(input.stopToolsWhen(), false)
      assert.equal(JSON.parse(await input.onToolCall({ name: 'posture_submit', arguments: { posture: '坐下' } })).ok, true)
      assert.equal(input.stopToolsWhen(), true)
      return {}
    } },
    runtime: { async settleMvuUpdate() { writes++; return { updated: false, context: { messages: [{ variables: {} }, { variables: { stat_data: { hp: 10 } } }] } } } }
  })
  const result = await module.settleVariables({ operationId: 'batch', chatId: 'chat', branchId: 'branch', basedOnRevision: 1, turn: 2, swipeId: 0, sessionId: 's', messageId: 1, storyText: '她站在门边。', currentVariables: { stat_data: { hp: 10 } }, backgroundTasks: { posture: true } })
  assert.equal(result.posture, '坐下')
  assert.equal(writes, 1)
})

test('silent card rejection reports submitted and observed values for a targeted correction', async () => {
  let feedback
  const module=createMvuSettlementModule({maxAttempts:1,
    model:{async run(input){
      await input.onToolCall({name:'posture_submit',arguments:{posture:'站在路旁'}})
      feedback=JSON.parse(await input.onToolCall({name:'mvu_submit_update',arguments:{operations:[{op:'replace',path:'/当前活动',valueJson:'["步行通勤"]'}]}}))
      return {text:''}
    }},
    runtime:{async settleMvuUpdate(){return {updated:true,context:{messages:[{variables:{stat_data:{当前活动:[]}}}]}}}}
  })
  await module.settleVariables({operationId:'rejected-activity',chatId:'c',branchId:'b',basedOnRevision:1,sessionId:'s',messageId:0,swipeId:0,storyText:'走到路旁。',currentVariables:{stat_data:{当前活动:[]}}})
  assert.equal(feedback.ok,false)
  assert.deepEqual(feedback.rejectedOperations,[{operation:'replace',path:'/当前活动',submittedJson:'["步行通勤"]',observedJson:'[]'}])
  assert.match(feedback.error,/不得原样重试/)
})

test('本局 Guide 进入变量结算上下文，空 Guide 不占位', function () {
  const base = { operationId: 'guide-1', chatId: 'chat', branchId: 'main', basedOnRevision: 1, messageId: 1, swipeId: 0, storyText: '正文' }
  const request = projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({ ...base, guides: [{ id: 'a', text: ' 好感度涨得慢一点 ' }, { id: 'b', text: '' }] }))
  assert.match(request.turnContext, /【玩家 Guide · 持续生效】/)
  assert.match(request.turnContext, /1\. 好感度涨得慢一点(\n|$)/)
  assert.doesNotMatch(request.turnContext, /2\. /)
  assert.match(request.system, /只根据【正文】中已经确认发生的事实结算变量/)
  assert.doesNotMatch(projectMvuBackgroundRequest(createMvuBackgroundTaskFrame(base)).turnContext, /Guide/)
})

test('replace 改变字段形状（列表↔文本）时退回给模型按原类型重提，不进入 MVU', async () => {
  const feedback=[];let dispatched=0
  const module=createMvuSettlementModule({maxAttempts:2,
    model:{async run(input){
      await input.onToolCall({name:'posture_submit',arguments:{posture:'站在路旁'}})
      feedback.push(JSON.parse(await input.onToolCall({name:'mvu_submit_update',arguments:{operations:[{op:'replace',path:'/待办',valueJson:'"买猫粮"'},{op:'replace',path:'/好感',valueJson:'"12"'}]}})))
      feedback.push(JSON.parse(await input.onToolCall({name:'mvu_submit_update',arguments:{operations:[{op:'replace',path:'/待办',valueJson:'["买猫粮"]'}]}})))
      return {text:''}
    }},
    runtime:{async settleMvuUpdate(){dispatched++;return {updated:true,context:{messages:[{variables:{stat_data:{待办:['买猫粮'],好感:10}}}]}}}}
  })
  await module.settleVariables({operationId:'kind',chatId:'c',branchId:'b',basedOnRevision:1,sessionId:'s',messageId:0,swipeId:0,storyText:'走到路旁。',currentVariables:{stat_data:{待办:[],好感:10}}})
  assert.equal(feedback[0].ok,false);assert.equal(feedback[0].retryable,true)
  assert.match(feedback[0].error,/\/待办 当前是列表，提交的是文本/)
  assert.equal(feedback[1].ok,true)
  assert.equal(dispatched,1)
})

test('列表元素改变形状（文本元素换成数组元素）同样退回重提', async () => {
  const feedback=[]
  const module=createMvuSettlementModule({maxAttempts:2,
    model:{async run(input){
      await input.onToolCall({name:'posture_submit',arguments:{posture:'站在路旁'}})
      feedback.push(JSON.parse(await input.onToolCall({name:'mvu_submit_update',arguments:{operations:[{op:'replace',path:'/通讯',valueJson:'[["😤","胡伟","别回所里"]]'}]}})))
      feedback.push(JSON.parse(await input.onToolCall({name:'mvu_submit_update',arguments:{operations:[{op:'insert',path:'/通讯/-',valueJson:'"😤|胡伟|别回所里"'}]}})))
      return {text:''}
    }},
    runtime:{async settleMvuUpdate(){return {updated:true,context:{messages:[{variables:{stat_data:{通讯:['📞|宋|你好','😤|胡伟|别回所里']}}}]}}}}
  })
  await module.settleVariables({operationId:'element',chatId:'c',branchId:'b',basedOnRevision:1,sessionId:'s',messageId:0,swipeId:0,storyText:'看手机。',currentVariables:{stat_data:{通讯:['📞|宋|你好']}}})
  assert.match(feedback[0].error,/\/通讯 的列表元素 当前是文本，提交的是列表/)
  assert.equal(feedback[1].ok,true)
})

test('the settlement prompt hides $meta, which MVU already turned into the schema (#153)', async () => {
  let prompt = ''
  const module = createMvuSettlementModule({ maxAttempts: 1,
    model: { async run(input) { prompt = JSON.stringify(input); return { text: '' } } },
    runtime: { async settleMvuUpdate() { return { updated: false, context: { messages: [{ variables: {} }] } } } }
  })
  await module.settleVariables({ operationId: 'meta', chatId: 'c', branchId: 'b', basedOnRevision: 1, sessionId: 's', messageId: 0, swipeId: 0, storyText: '她站在门边。',
    currentVariables: { stat_data: { $meta: { strictSet: true }, 人物: { 体力: 62, $meta: { extensible: true } }, 线索: ['旧烟盒'] }, schema: { strictSet: true } } }).catch(() => {})
  assert.match(prompt, /体力/)
  assert.match(prompt, /旧烟盒/)
  assert.match(prompt, /当前变量快照/)
  assert.doesNotMatch(prompt.slice(prompt.indexOf('当前变量快照'), prompt.indexOf('变量结构')), /\$meta/)
})
