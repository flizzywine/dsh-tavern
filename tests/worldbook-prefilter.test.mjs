import assert from 'node:assert/strict'
import test from 'node:test'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createWorldbookPrefilter } from '../tavern-plugin/lib/domain/worldbook-prefilter.js'

function harness() {
  let current = { id: 'chat-1', mode: 'story', messages: [] }
  let sequence = 0
  const store = {
    async readChat() { return current },
    async writeChat(chat) { current = chat },
    async updateChat(_id, mutation) { const next = await mutation(current); if (next !== undefined) current = next; return current }
  }
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + ++sequence, now: () => 1000 + sequence })
  let prefilter
  const tasks = createBackgroundTaskCoordinator({ store, timeline,
    preempt: async (chatId, role) => { if (role !== 'worldbook-filter') await prefilter.cancel(chatId) } })
  return { tasks, current: () => current, setPrefilter: value => { prefilter = value } }
}

test('预筛进行中开始其他后台任务时，预筛被取消并让路，而不是报后台忙', async () => {
  const h = harness()
  let started, aborted = false
  const running = new Promise(resolve => { started = resolve })
  const prefilter = createWorldbookPrefilter({ logger: { warn() {} }, async run(_chatId, signal) {
    const task = await h.tasks.begin(h.current(), 'worldbook-filter')
    started()
    try {
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    } catch (error) {
      aborted = true
      await task.fail(error)
      throw error
    }
  } })
  h.setPrefilter(prefilter)
  void prefilter.start('chat-1')
  await running
  assert.equal(h.tasks.activity(h.current()).role, 'worldbook-filter')
  const settlement = await h.tasks.begin(h.current(), 'settlement')
  assert.equal(aborted, true)
  assert.equal(settlement.participantRequest.role, 'background')
})

test('同一对话再次预筛会取消上一轮；取消没有在运行的预筛不报错', async () => {
  const runs = []
  const prefilter = createWorldbookPrefilter({ logger: { warn() {} }, async run(chatId, signal) {
    runs.push(signal)
    await new Promise(resolve => setTimeout(resolve, 5))
  } })
  const first = prefilter.start('chat-1')
  const second = prefilter.start('chat-1')
  await Promise.all([first, second])
  assert.equal(runs.length, 1, '被取代的预筛不会开始')
  assert.equal(await prefilter.cancel('chat-1'), false)
})
