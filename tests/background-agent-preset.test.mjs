import assert from 'node:assert/strict'
import test from 'node:test'

import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { projectRuntimePresetRequest } from '../tavern-plugin/lib/domain/runtime-preset-lifecycle.js'
import { resolveRuntimePresetMacros } from '../tavern-plugin/lib/domain/runtime-presets.js'

function presetSnapshotFixture() {
  const raw = {
    presetPath: 'presets/test.json',
    presetName: '测试预设',
    front: { entries: [{ role: 'system', content: '前段：角色{{char}}与{{user}}' }] },
    middle: { entries: [{ role: 'system', content: '中段：{{random::甲::乙}}规则' }] },
    back: { entries: [{ role: 'user', content: '后段：结尾要求{{user}}' }] },
    regexScripts: [{ id: 'r1', findRegex: '/.*/g', replaceString: '不应该改写后台' }]
  }
  return resolveRuntimePresetMacros(raw, {
    charName: '阿晴',
    macroState: { userName: '旅人' },
    randomSeed: 'seed-fixed-1'
  }).snapshot
}

function mockRunner({ resolveRuntimePresetSnapshot, stageRuntimePresetSnapshot, stepsByRun = 1 }) {
  const stepLogs = []
  let seq = 0
  const runner = createBackgroundAgentRunner({
    id: () => 'bg-' + (++seq),
    agents: {
      get: () => ({ id: 'parent', session: { header: {} } }),
      async create(options) {
        const preStepHooks = []
        await options.setup({
          systemPrompt: { section() {}, suppressRuntimeContext() {} },
          on(name, listener, hookOptions) {
            if (name !== 'agent/pre-step') return
            if (hookOptions && hookOptions.prepend) preStepHooks.unshift(listener)
            else preStepHooks.push(listener)
          },
          tools: { presentAs() {}, restrict() {}, register() { return () => {} } }
        })
        const sessionId = 'agent-session-' + seq
        const session = {
          id: sessionId,
          header: {},
          events: [],
          requestHeader() { return null },
          append(type, data) { this.events.push({ type, data }) }
        }
        let work = Promise.resolve()
        let scheduled = false
        const messages = []
        function drainQueue() {
          if (scheduled) return work
          scheduled = true
          work = Promise.resolve().then(async () => {
            scheduled = false
            const signal = new AbortController().signal
            for (let step = 1; step <= stepsByRun; step++) {
              const base = { kind: 'enter', messages: structuredClone(messages) }
              const payload = { agent: { session }, turn: 1, step, signal }
              const run = index => index >= preStepHooks.length
                ? Promise.resolve(base)
                : preStepHooks[index](payload, () => run(index + 1))
              const result = await run(0)
              stepLogs.push({ sessionId, step, decisionMessages: result.messages })
              if (step < stepsByRun) {
                messages.push(
                  { role: 'assistant', content: [{ type: 'tool-call', id: 'call-' + step, name: 'tavern_read_source', arguments: '{}' }] },
                  { role: 'tool', content: [{ type: 'tool-result', id: 'call-' + step, text: '读取结果' }] }
                )
              }
            }
            session.append('assistant/message', {
              message: { content: [{ type: 'text', text: '{"ok":true}' }] }
            })
          })
          return work
        }
        return {
          agent: {
            session,
            followup(message) {
              messages.push(message)
              drainQueue()
            },
            async whenIdle() { await work }
          },
          async dispose() {}
        }
      }
    },
    resolveRuntimePresetSnapshot,
    stageRuntimePresetSnapshot
  })
  return { runner, stepLogs }
}

test('开启后台预设开关后，全部后台 Agent 任务（共享上下文、精修、罗盘、导演）都注入三段预设', async () => {
  const staged = []
  const resolved = []
  const snapshot = presetSnapshotFixture()
  const { runner, stepLogs } = mockRunner({
    resolveRuntimePresetSnapshot: async input => {
      resolved.push(input)
      return snapshot
    },
    stageRuntimePresetSnapshot: input => staged.push(input)
  })
  try {
    await runner.run({
      sessionId: 'parent', persistent: false, task: 'settlement',
      selection: { provider: 'p', model: 'm' }, turnContext: '<turn>1</turn>'
    })
    await runner.run({
      sessionId: 'parent', persistent: false, task: 'polish',
      selection: { provider: 'p', model: 'm' }, system: '精修系统提示', taskText: '请润色本段正文',
      acceptWithoutText: () => true
    })
    await runner.run({
      sessionId: 'parent', persistent: false, task: 'plot-compass', ownPrefix: true,
      selection: { provider: 'p', model: 'm' }, system: '罗盘系统提示', taskText: '推演剧情路线',
      acceptWithoutText: () => true
    })
    await runner.run({
      sessionId: 'parent', persistent: false, task: 'stage-director',
      selection: { provider: 'p', model: 'm' },
      tools: [{ name: 'submit_direction', description: '提交舞台演出', parameters: { type: 'object' } }],
      onToolCall: async () => '{}',
      messages: [
        { role: 'system', content: [{ type: 'text', text: '导演系统提示' }] },
        { role: 'user', content: [{ type: 'text', text: '生成分镜指令' }] }
      ],
      acceptWithoutText: () => true
    })

    assert.deepEqual(resolved.map(r => r.operation), ['settlement', 'polish', 'plot-compass', 'stage-director'])
    assert.equal(staged.length, 4)
    for (const entry of staged) {
      assert.equal(entry.scope, 'background')
      assert.equal(entry.snapshot, snapshot)
    }

    for (const log of stepLogs) {
      const texts = log.decisionMessages.map(m => m.content.map(b => b.text).join(''))
      const midIdx = texts.findIndex(t => /中段：.*规则/.test(t))
      assert.ok(midIdx >= 0, '每个后台任务的 middle 阶段都已插入')
      assert.equal(log.decisionMessages.at(-1).role, 'user', 'middle 位于当前任务输入之前，不覆盖末尾任务')
      assert.equal(midIdx, log.decisionMessages.length - 2)

      // 宏变量已展开
      assert.match(snapshot.front.entries[0].content, /角色阿晴与旅人/)
      assert.match(snapshot.back.entries[0].content, /结尾要求旅人/)

      const projected = projectRuntimePresetRequest(
        { system: '基础系统', messages: log.decisionMessages },
        snapshot,
        { scope: 'background', turn: 1, step: 1 }
      )
      assert.match(projected.messages[0].content[0].text, /前段：角色阿晴与旅人/)
      assert.match(projected.messages.at(-1).content[0].text, /后段：结尾要求旅人/)
    }
  } finally {
    await runner.dispose()
  }
})

test('后台多步工具循环中，middle 与 back 在第 1 步与第 2 步之间保持前缀一致；关闭开关时不注入预设', async () => {
  const snapshot = presetSnapshotFixture()
  const multiStep = mockRunner({
    stepsByRun: 2,
    resolveRuntimePresetSnapshot: async () => snapshot
  })
  try {
    await multiStep.runner.run({
      sessionId: 'parent', persistent: false, task: 'settlement',
      selection: { provider: 'p', model: 'm' }, turnContext: '<turn>2</turn>'
    })
    assert.equal(multiStep.stepLogs.length, 2)
    const p1 = projectRuntimePresetRequest(
      { system: '结算指令', messages: multiStep.stepLogs[0].decisionMessages },
      snapshot,
      { scope: 'background', turn: 1, step: 1 }
    ).messages
    const p2 = projectRuntimePresetRequest(
      { system: '结算指令', messages: multiStep.stepLogs[1].decisionMessages },
      snapshot,
      { scope: 'background', turn: 1, step: 2 }
    ).messages
    const textOf = m => JSON.stringify(m.content)
    const toolCallIdx = p2.findIndex(m => m.role === 'assistant' && m.content.some(b => b.type === 'tool-call'))
    assert.ok(toolCallIdx > 0)
    assert.deepEqual(p2.slice(0, toolCallIdx).map(textOf), p1.map(textOf), '第 2 步工具调用前全部内容（front/system/middle/task/back）与第 1 步完全一致')
    assert.doesNotMatch(textOf(p2.at(-1)), /后段：结尾要求旅人/)
  } finally {
    await multiStep.runner.dispose()
  }

  // 默认关闭时 resolveRuntimePresetSnapshot 返回 null，不插入任何 preset 内容
  const offRun = mockRunner({
    resolveRuntimePresetSnapshot: async () => null
  })
  try {
    await offRun.runner.run({
      sessionId: 'parent', persistent: false, task: 'polish',
      selection: { provider: 'p', model: 'm' }, system: '精修', taskText: '正文',
      acceptWithoutText: () => true
    })
    const allTexts = offRun.stepLogs[0].decisionMessages.map(m => JSON.stringify(m.content)).join('\n')
    assert.doesNotMatch(allTexts, /前段：|中段：|后段：/)
  } finally {
    await offRun.runner.dispose()
  }
})
