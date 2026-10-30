// 打断回合只发「回合打断」事件，由舞台模块自己停导演；部署忙碌由各模块登记，维护接口不认识舞台。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'
import { createMaintenanceHandlers } from '../tavern-plugin/lib/rpc/maintenance.js'
import { createStoryEvents } from '../tavern-plugin/lib/domain/story-events.js'
import { deploymentActivity } from '../tavern-plugin/lib/domain/deployment-activity.js'

test('打断回合发出回合打断事件（带被打断的回合与是否撤回）', async () => {
  const storyEvents = createStoryEvents({ logger: { warn() {} } }), heard = []
  storyEvents.on('turn-interrupted', 'test', payload => heard.push(payload))
  const stopped = { sessionId: 's', timeline: { operations: { a: { kind: 'body', turn: 3 }, b: { kind: 'agent' } } } }
  const handlers = createPlayHandlers({ str: String, storyEvents, reconcileStory: async () => {}, chatForSession: async () => stopped,
    interruptTurn: async () => ({ withdrawn: true }), pluginApi: { stopTasks() {} }, notifyPluginTimeline() {} })
  await handlers.interruptTurn({ sessionId: 's' })
  assert.deepEqual(heard, [{ sessionId: 's', turn: 3, withdrawn: true }])
})

test('部署状态汇总各模块登记的忙碌（导演在跑时不可部署）', async () => {
  const deploymentWork = [() => ({ director: { busy: true } })]
  const handlers = createMaintenanceHandlers({ str: String, deploymentActivity, deploymentWork, listTavernSessions: async () => [],
    taskStateReader: { forSession: async () => null }, agentRegistry: { list: () => [], get: () => null },
    backgroundTasks: { activity: () => null },
    backgroundAgentRunner: { progress: () => null }, pluginSettlementProgress: { snapshot: () => null }, autoChoices: { isPending: () => false } })
  const { work } = await handlers.getDeploymentActivity({})
  assert.equal(work.busy, true)
  assert.deepEqual(work.reasons, ['director'])
})
