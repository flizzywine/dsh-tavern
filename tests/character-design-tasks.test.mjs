import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHARACTER_DESIGN_COMPLETE_TOOL_NAME,
  CHARACTER_DESIGN_REQUEST_TOOL,
  createCharacterDesignTasks
} from '../tavern-plugin/lib/domain/character-design-tasks.js'

const design = {
  name: '林岚', identity: '港口诊所医生', narrativeRole: '持续提供线索并挑战主角判断的盟友',
  coreMotivation: '查清镇上反复出现的失忆病例', innerConflict: '追求真相，却害怕再次连累病人',
  personality: '冷静细致，遇到含糊说法会耐心追问', appearance: '黑色短发，身形清瘦，左眉有浅疤',
  behaviorStyle: '先记录细节再行动，紧张时会转动钢笔', speechStyle: '语速平稳，用词准确，很少夸张',
  relationships: '与港务人员互相信任，对镇长保持礼貌警惕',
  defaultPresentation: '深蓝长外套、浅灰衬衫和便于行走的短靴', plotPotential: '病例来源会迫使她在职业责任与私人秘密间选择'
}

function harness(runModel, settleStatus = 'done') {
  let current = {
    id: 'chat-1', sessionId: 'session-1', mode: 'story', settleStatus,
    posture: '站在门边', storyScope: 'body-1', messages: [{ role: 'assistant', text: '林岚推门走进诊所。' }]
  }
  const chats = {
    async read() { return structuredClone(current) },
    async write(chat) { current = structuredClone(chat); return structuredClone(current) },
    async update(_id, change) { current = await change(structuredClone(current)); return structuredClone(current) },
    async forSession(sessionId) { return sessionId === current.sessionId ? structuredClone(current) : undefined }
  }
  const tasks = createCharacterDesignTasks({
    chats,
    model: { run: runModel },
    selection: () => ({ provider: 'test', model: 'test' }),
    scopeForChat: chat => ({ storyScope: chat.storyScope }),
    validScope: (chat, scope) => chat.storyScope === scope.storyScope,
    messagesForChat: chat => chat.messages,
    now: (() => { let value = 100; return () => ++value })()
  })
  return {
    tasks,
    get: () => structuredClone(current),
    settle() { current.settleStatus = 'done' },
    replaceStory() { current.storyScope = 'body-2' }
  }
}

async function until(check) {
  for (let index = 0; index < 100; index++) {
    const value = check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('等待人物设计任务完成超时')
}

test('人物设计请求先独立排队，结算完成后 Agent 加载 Skill 并只使用人物设计工具', async () => {
  let calls = 0
  const run = harness(async input => {
    calls++
    assert.equal(input.task, 'character-design')
    assert.match(input.system, /第一步调用 skill 加载 tavern-character-design/)
    assert.doesNotMatch(input.system, /顺便|同时结算/)
    assert.deepEqual(input.tools.map(tool => tool.name), [
      'character_design_read', 'character_design_save', CHARACTER_DESIGN_COMPLETE_TOOL_NAME
    ])
    assert.equal(input.tools.some(tool => tool.name === 'posture_submit' || tool.name === 'mvu_submit_update'), false)
    await input.onPersistentSessionReady('background-1')
    const index = JSON.parse(await input.onToolCall({ name: 'character_design_read', arguments: {} }))
    assert.deepEqual(index.characters, [])
    const saved = JSON.parse(await input.onToolCall({ name: 'character_design_save', arguments: design }))
    assert.equal(saved.ok, true)
    await input.onToolCall({
      name: CHARACTER_DESIGN_COMPLETE_TOOL_NAME,
      arguments: { outcome: 'saved', names: ['林岚'], summary: '已建立可持续复用的完整设计。' }
    })
    return { text: '', traceSessionId: 'background-1', traceBoundary: 8 }
  }, 'running')

  const queued = await run.tasks.request({
    sessionId: 'session-1', requestId: 'request-1', turn: 2,
    reason: '新登场人物将持续推动主线', subjects: [{ name: '林岚', need: '建立完整人物设计' }]
  })
  assert.equal(queued.status, 'queued')
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(calls, 0, '正文状态结算未完成时只排队，不抢占结算')

  run.settle()
  await run.tasks.resume('chat-1')
  await until(() => run.get().characterDesignTaskReceipt)

  const saved = run.get()
  assert.equal(calls, 1)
  assert.equal(saved.posture, '站在门边', '独立人物设计不修改姿势')
  assert.equal(saved.characterDesignDocument.characters[0].name, '林岚')
  assert.equal(saved.characterDesignTaskReceipt.outcome, 'saved')
  assert.equal(saved.characterDesignAgentSessionId, 'background-1')
})

test('人物设计 Agent 失败只终止自身任务，不改变已完成结算', async () => {
  const run = harness(async input => {
    await input.onPersistentSessionReady('background-failed')
    throw new Error('人物设计模型中断')
  })
  const requested = await run.tasks.request({
    sessionId: 'session-1', requestId: 'request-failed',
    reason: '需要补全人物', subjects: [{ name: '林岚', need: '补全长期动机' }]
  })
  await until(() => run.get().taskMailbox.tasks[requested.taskId].status === 'failed')
  const saved = run.get()
  assert.equal(saved.settleStatus, 'done')
  assert.equal(saved.posture, '站在门边')
  assert.equal(saved.characterDesignDocument, undefined)
  assert.match(saved.taskMailbox.tasks[requested.taskId].error, /人物设计模型中断/)
})

test('触发请求的正文被替换后任务作废，不留下幽灵人物', async () => {
  let calls = 0
  const run = harness(async () => { calls++; return { text: '' } }, 'running')
  const requested = await run.tasks.request({
    sessionId: 'session-1', requestId: 'request-stale',
    reason: '旧正文出现了人物', subjects: [{ name: '旧人物', need: '建立设计' }]
  })
  run.replaceStory()
  run.settle()
  await run.tasks.resume('chat-1')
  await until(() => run.get().taskMailbox.tasks[requested.taskId].status === 'stale')
  assert.equal(calls, 0)
  assert.equal(run.get().characterDesignDocument, undefined)
})

test('请求工具只接受调度材料，不接受人物档案或 MVU 字段', () => {
  assert.equal(CHARACTER_DESIGN_REQUEST_TOOL.name, 'request_character_design')
  assert.deepEqual(Object.keys(CHARACTER_DESIGN_REQUEST_TOOL.parameters.properties), ['reason', 'subjects'])
})
