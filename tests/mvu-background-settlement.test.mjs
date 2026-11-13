import assert from 'node:assert/strict'
import test from 'node:test'

import { createMvuSettlementModule } from "../tavern-plugin/lib/domain/mvu-background-settlement.js"

test('本地 provider 复用 durable submission、官方事务和效果审计；无变化提交为 error', async () => {
  const submissions = [], prepared = [], calls = []
  let nextVariables = { stat_data: { hp: 4 }, schema: {} }
  const module = createMvuSettlementModule({ model: { async run() { throw new Error('本地 provider 不应调用模型') } }, runtime: {
    async settleMvuUpdate(input) {
      calls.push(input)
      return { variables: nextVariables, context: { messages: [{ variables: nextVariables }] }, validation: undefined }
    }
  } })
  const base = { operationId: 'provider-op', chatId: 'chat', branchId: 'branch', basedOnRevision: 9, sessionId: 'game', messageId: 1, swipeId: 0,
    storyText: 'HP提升。', currentVariables: { stat_data: { hp: 3 }, schema: {} }, onSubmission: value => submissions.push(value), onPrepared: value => prepared.push(value) }
  const applied = await module.resumeProviderVariables({ ...base, submission: { operations: [{ op: 'replace', path: '/stat_data/hp', valueJson: '4' }] } })
  assert.equal(applied.receipt.status, 'updated')
  assert.deepEqual(submissions[0].operations, [{ op: 'replace', path: '/stat_data/hp', value: 4 }])
  assert.equal(prepared.length, 1)
  assert.equal(calls.length, 1)

  nextVariables = { stat_data: { hp: 3 }, schema: {} }
  const rejected = await module.resumeProviderVariables({ ...base, submission: { operations: [{ op: 'replace', path: '/stat_data/hp', valueJson: '5' }] } })
  assert.equal(rejected.receipt.status, 'error', 'runtime handled without a change fails the existing audit')
  assert.equal(prepared.length, 1, 'rejected effects are never marked prepared')
  await assert.rejects(module.resumeProviderVariables({ ...base, submission: { operations: [{ op: 'replace', path: '/stat_data/schema', valueJson: '{}' }] } }), /不能访问 MVU/)
  assert.equal(calls.length, 2, 'invalid paths fail before runtime dispatch')
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

test('数字与文本互换同样退回重提：漏了引号的 1999 不会悄悄存成数字，文本也进不了数字字段', async () => {
  // 票号 is empty, so only the MVU schema knows its elements are text.
  const currentVariables={stat_data:{年份:'2024',金币:10,票号:[]},schema:{type:'object',properties:{年份:{type:'string'},金币:{type:'number'},票号:{type:'array',elementType:{type:'string'}}}}}
  async function settle(wrong, right) {
    const feedback=[], dispatched=[]
    const module=createMvuSettlementModule({maxAttempts:2,
      model:{async run(input){
        await input.onToolCall({name:'posture_submit',arguments:{posture:'站在柜台前'}})
        for (const operation of [wrong, right]) feedback.push(JSON.parse(await input.onToolCall({name:'mvu_submit_update',arguments:{operations:[operation]}})))
        return {text:''}
      }},
      runtime:{async settleMvuUpdate(request){
        dispatched.push(...JSON.parse(request.command.match(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/)[1]))
        return {updated:true,context:{messages:[{variables:{stat_data:{年份:'1999',金币:12,票号:['7']}}}]}}
      }}
    })
    await module.settleVariables({operationId:'kinds',chatId:'c',branchId:'b',basedOnRevision:1,sessionId:'s',messageId:0,swipeId:0,storyText:'年份改成 1999，收下 12 枚金币和 7 号票。',currentVariables})
    assert.equal(feedback[0].ok,false);assert.equal(feedback[0].retryable,true)
    assert.equal(feedback[1].ok,true)
    return {error:feedback[0].error,dispatched}
  }
  const year=await settle({op:'replace',path:'/stat_data/年份',valueJson:'1999'},{op:'replace',path:'/stat_data/年份',valueJson:'"1999"'})
  assert.match(year.error,/\/stat_data\/年份 当前是文本，提交的是数字；文本值要带 JSON 双引号，valueJson 写 "1999"/)
  assert.deepEqual(year.dispatched,[{op:'replace',path:'/年份',value:'1999'}])
  const coins=await settle({op:'replace',path:'/stat_data/金币',valueJson:'"12%"'},{op:'replace',path:'/stat_data/金币',valueJson:'12'})
  assert.match(coins.error,/\/stat_data\/金币 当前是数字，提交的是文本；数字不带引号/)
  assert.deepEqual(coins.dispatched,[{op:'replace',path:'/金币',value:12}])
  const ticket=await settle({op:'insert',path:'/stat_data/票号/-',valueJson:'7'},{op:'insert',path:'/stat_data/票号/-',valueJson:'"7"'})
  assert.match(ticket.error,/\/stat_data\/票号\/- 的列表元素 当前是文本，提交的是数字/)
  assert.equal(ticket.dispatched[0].value,'7')
})
