import assert from 'node:assert/strict'
import test from 'node:test'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { createForegroundFrameSessionAdapter } from '../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'
import { createMvuBackgroundTaskFrame, projectMvuBackgroundRequest } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

const message = (role, text, source) => ({ role, content: [{ type: 'text', text }], source })
async function foreground(history, raw = '{{User}}进入大厅。\n<StatusPlaceHolderImpl/>') {
  const plan = await createContextPlanner({ prompt: () => '本轮正文规则' }).plan({ purpose: 'body',
    card: { name: '守卫' }, chat: { macroState: { userName: '小明' }, messages: [{ role: 'assistant', text: '小明进入大厅。', sourceText: raw }] } })
  const frame = createForegroundFrameBuilder().build({ chatId: 'c', branchId: 'b', operationId: 'op', basedOnRevision: 1, turn: 2,
    inputs: [{ kind: 'foreground.user-input', projectedText: '继续' }, ...plan.sections.map(s => ({
      kind: s.kind === 'previous-source' ? 'foreground.current-state' : 'foreground.writing-rules', text: s.text,
      source: { stage: 'context-plan', sectionKind: s.kind }
    }))] })
  return createForegroundFrameSessionAdapter({ id: () => 'new-frame' }).append({ messages: history, frame, step: 1 })
}

test('只在实际输入历史已有同文时省去新补全文，旧提示和工具消息原样保留', async () => {
  const history = [message('user', '旧轮提示和状态', { kind: 'plugin', plugin: 'dsh-tavern', form: 'foreground-frame' }),
    message('assistant', '小明进入大厅。'), message('user', '工具返回', { kind: 'tool', callId: 'call-1' }), message('user', '继续')]
  const before = structuredClone(history)
  const result = await foreground(history)
  assert.deepEqual(result.messages.slice(0, history.length), before)
  history.forEach((m, i) => assert.equal(result.messages[i], m))
  assert.doesNotMatch(result.messages.at(-1).content[0].text, /上一轮正文源文本|进入大厅/)
  assert.match(result.messages.at(-1).content[0].text, /本轮正文规则/)
  assert.deepEqual(history, before)
})

test('真实缺失正文、历史压缩后、未知宏和不同正文不得误去重', async () => {
  for (const [history, raw] of [
    [[], undefined],
    [[message('assistant', '摘要：已进入大厅')], undefined],
    [[message('assistant', '小明进入大厅。')], '{{User}}进入大厅。另有隐藏线索。'],
    [[message('assistant', '小明进入大厅。')], '{{getvar::location}}小明进入大厅。'],
    [[message('assistant', '小明进入大厅。'), message('assistant', '守卫关门。')], undefined]
  ]) {
    const result = await foreground(history, raw)
    assert.match(result.messages.at(-1).content[0].text, /上一轮正文源文本/)
  }
})

const tutorial = `变量输出格式:
  rule:
    - you must output the update analysis and the actual update commands at once in the end of the next reply
    - delta: update existing numbers by a delta value
    - don't update field names starts with \`_\` as they are readonly
  format: |-
    <UpdateVariable>
    <Analysis>
    - \${Q1: 每过一年增加年龄，数值只能使用 delta}
    </Analysis>
    <JSONPatch>
    [
      { "op": "delta", "path": "\${/path/to/number/variable}", "value": "\${positive_or_negative_delta}" },
      { "op": "move", "from": "\${/path/to/variable}", "to": "\${/path/to/another/path}" },
      ...
    ]
    </JSONPatch>
    </UpdateVariable>
额外规则:
  - 新角色必须完整初始化
`
function project(rule) {
  const frame = createMvuBackgroundTaskFrame({ operationId: 'o', chatId: 'c', branchId: 'b', basedOnRevision: 1,
    messageId: 0, swipeId: 0, storyText: '一年过去。', currentVariables: { stat_data: { age: 20 } }, updateRules: [rule] })
  return { frame, request: projectMvuBackgroundRequest(frame) }
}

test('工具模式仍原样保留完整卡片教程，只由系统协议指定工具提交方式', () => {
  const { frame, request } = project(tutorial)
  assert(request.turnContext.endsWith(tutorial))
  assert.equal(frame.taskRules.updateRules[0], tutorial)
  assert.match(request.system, /mvu_submit_update/)
  assert.match(request.system, /不在回复中输出 XML 变量协议/)
})

test('自定义格式和业务路径均不解析删减', () => {
  for (const rule of [tutorial.replace('${/path/to/number/variable}', '/age'), tutorial.replace('</JSONPatch>', ''),
    '规则：保留 <UpdateVariable> 是剧情中的文字', 'format: |-\n  更新年龄。', tutorial.replace('<Analysis>', '<CustomAnalysis>')]) {
    assert(project(rule).request.turnContext.endsWith(rule))
  }
})
