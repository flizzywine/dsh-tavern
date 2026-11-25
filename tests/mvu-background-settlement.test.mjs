import assert from 'node:assert/strict'
import test from 'node:test'

import { createMvuSettlementModule } from "../tavern-plugin/lib/domain/mvu-background-settlement.js"

test('神豪终端清空待办事件后按本轮的终端提交记录核验', async () => {
  const anchor = { branchKey: 'branch', messageId: 3, swipeId: 1, fingerprint: 'source' }
  const event = { type: 'BEHAVIOR', personRef: 'character', score: 50 }
  const key = JSON.stringify(['branch', 3, 1, 'source', 0, 'SIGNIFICANT_BEHAVIOR_SCORE', 'character'])
  const committed = { type: 'SIGNIFICANT_BEHAVIOR_SCORE', status: 'COMMITTED', revision: 2 }
  const baseline = { schemaVersion: 3, meta: { revision: 1 }, pendingEvents: [], operationHistory: {} }
  const input = { operationId: 'event', chatId: 'chat', branchId: 'branch', basedOnRevision: 1, sessionId: 'game',
    messageId: 3, swipeId: 1, storyText: '她点头应允。', currentVariables: { stat_data: { shenghao: baseline } } }
  let after
  const module = createMvuSettlementModule({ model: { async run() { assert.fail('replay must not call a model') } }, runtime: {
    async settleMvuUpdate(request) {
      const variables = { stat_data: { shenghao: after } }
      const validation = await request.validate({ before: request.baselineVariables, after: variables })
      return { variables, validation, rejected: validation.failures.length > 0 }
    }
  } })
  const settle = (events = [event]) => module.resumeProviderVariables({
    ...input, submission: { operations: [{ op: 'replace', path: '/stat_data/shenghao/pendingEvents', value: events }] }
  })
  after = { ...baseline, meta: { revision: 2, sourceAnchor: anchor }, operationHistory: { [key]: committed } }
  const accepted = await settle()
  assert.equal(accepted.receipt.status, 'updated')
  assert.match(accepted.receipt.changes[0].path, /operationHistory/)
  for (const result of [
    await settle([event, { ...event, personRef: 'different' }]),
    await settle([{ ...event, personRef: 'different' }])
  ]) assert.equal(result.receipt.status, 'error')
  after = { ...after, operationHistory: { [key]: { ...committed, revision: 1 } } }
  assert.equal((await settle()).receipt.status, 'error')
  after = { ...after, meta: { revision: 2, sourceAnchor: { ...anchor, swipeId: 0 } }, operationHistory: { [key]: committed } }
  assert.equal((await settle()).receipt.status, 'error')
})

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
    storyText: 'HP提升。', currentVariables: { stat_data: { hp: 3 }, schema: {} },
    helperContext: ["刚进入营地。\n<UpdateVariable>_.set('hp', 3);</UpdateVariable>"],
    onSubmission: value => submissions.push(value), onPrepared: value => prepared.push(value) }
  const applied = await module.resumeProviderVariables({ ...base, submission: { operations: [{ op: 'replace', path: '/stat_data/hp', valueJson: '4' }] } })
  assert.equal(applied.receipt.status, 'updated')
  assert.deepEqual(submissions[0].operations, [{ op: 'replace', path: '/stat_data/hp', value: 4 }])
  assert.equal(prepared.length, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].storyText, '刚进入营地。\n\nHP提升。')
  assert.match(calls[0].command, /^<UpdateVariable>\n<JSONPatch>/)

  nextVariables = { stat_data: { hp: 3 }, schema: {} }
  const rejected = await module.resumeProviderVariables({ ...base, submission: { operations: [{ op: 'replace', path: '/stat_data/hp', valueJson: '5' }] } })
  assert.equal(rejected.receipt.status, 'error', 'runtime handled without a change fails the existing audit')
  assert.equal(prepared.length, 1, 'rejected effects are never marked prepared')
  await assert.rejects(module.resumeProviderVariables({ ...base, submission: { operations: [{ op: 'replace', path: '/stat_data/schema', valueJson: '{}' }] } }), /不能访问 MVU/)
  assert.equal(calls.length, 2, 'invalid paths fail before runtime dispatch')
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
