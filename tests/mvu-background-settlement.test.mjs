import assert from 'node:assert/strict'
import test from 'node:test'

import { createMvuSettlementModule, normalizeMvuProviderSubmission } from "../tavern-plugin/lib/domain/mvu-background-settlement.js"

test('本地 provider 只接受完整 stat_data 绝对路径，拒绝 schema、元数据与原型路径', () => {
  assert.deepEqual(normalizeMvuProviderSubmission({ operations: [{ op: 'replace', path: '/stat_data/宝可梦/HP', valueJson: '12' }] }),
    { operations: [{ op: 'replace', path: '/stat_data/宝可梦/HP', value: 12 }] })
  for (const path of ['/宝可梦/HP', '/stat_data', '/stat_data/schema/x', '/stat_data/宝可梦/$meta', '/stat_data/__proto__/polluted', '/stat_data/constructor']) {
    assert.throws(() => normalizeMvuProviderSubmission({ operations: [{ op: 'replace', path, valueJson: '1' }] }), /路径|JSON Pointer/)
  }
  assert.throws(() => normalizeMvuProviderSubmission({ operations: [{ op: 'move', path: '/stat_data/a', from: '/stat_data/prototype' }] }), /路径/)
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
