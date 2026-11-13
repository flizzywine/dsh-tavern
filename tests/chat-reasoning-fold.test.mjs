import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHAT_REASONING_STREAM_MARKER,
  patchReasoningChatSource
} from '../tavern-plugin/lib/domain/chat-reasoning-fold.js'
import { chatAnswerBootScript } from '../tavern-plugin/lib/domain/chat-answer-boot-patch.js'

// The shipped shape: ReasoningRow is memoized and reads its disclosure state from the
// props the host injects. The fixture keeps that call path so the patch is exercised
// exactly where the page runs it.
const SHIPPED = `const react = { memo: (fn) => fn, useSyncExternalStore: (subscribe, snapshot) => snapshot() };
const ReasoningRow = (0, react.memo)(function ReasoningRow({ text: rawText, running, textInteractionSource = false, usePresentation, useDisclosure, renderSlot, t }) {
	const { expanded, toggle } = useDisclosure();
	return { expanded: expanded, toggle: toggle };
});
`

function load(source) {
  return new Function(source + '\nreturn ReasoningRow;')()
}

test('思考行跟随流式展开：生成中铺开，写完自动收起', () => {
  const result = patchReasoningChatSource(SHIPPED)
  assert.equal(result.status, 'applied')
  assert.ok(result.text.includes(CHAT_REASONING_STREAM_MARKER))
  const ReasoningRow = load(result.text)
  const useDisclosure = () => ({ expanded: false, toggle: () => {} })
  // No stored preference: the shipped default is on.
  globalThis.localStorage = { getItem: () => null }
  assert.equal(ReasoningRow({ running: true, useDisclosure }).expanded, true)
  assert.equal(ReasoningRow({ running: false, useDisclosure }).expanded, false)
})

test('关掉开关后完全交还宿主：思考行依旧默认收起', () => {
  const ReasoningRow = load(patchReasoningChatSource(SHIPPED).text)
  const useDisclosure = () => ({ expanded: false, toggle: () => {} })
  globalThis.localStorage = { getItem: key => (key === 'dsh-tavern.reasoningStreamOnly' ? '0' : null) }
  assert.equal(ReasoningRow({ running: true, useDisclosure }).expanded, false)
  delete globalThis.localStorage
})

test('读者自己展开的选择在流式结束后仍然有效', () => {
  const ReasoningRow = load(patchReasoningChatSource(SHIPPED).text)
  globalThis.localStorage = { getItem: () => '1' }
  assert.equal(ReasoningRow({ running: false, useDisclosure: () => ({ expanded: true, toggle: () => {} }) }).expanded, true)
  delete globalThis.localStorage
})

test('幂等，且形状不符时保持原样', () => {
  const once = patchReasoningChatSource(SHIPPED)
  assert.equal(patchReasoningChatSource(once.text).status, 'patched')
  assert.equal(patchReasoningChatSource('function Latest(turn) { return turn.answer }').status, 'unmatched')
})

test('也认没有 memo 包裹的 ReasoningRow', () => {
  const bare = `const react = { memo: (fn) => fn, useSyncExternalStore: (subscribe, snapshot) => snapshot() };\n\t\tfunction ReasoningRow({ running, useDisclosure }) {\n\t\t\tconst { expanded, toggle } = useDisclosure();\n\t\t\treturn expanded;\n\t\t}\n`
  const result = patchReasoningChatSource(bare)
  assert.equal(result.status, 'applied')
  const rebuilt = new Function(result.text + '\nreturn ReasoningRow;')()
  globalThis.localStorage = { getItem: () => '1' }
  assert.equal(rebuilt({ running: true, useDisclosure: () => ({ expanded: false, toggle: () => {} }) }), true)
  delete globalThis.localStorage
})

test('页面补丁脚本同时带上两条改写规则', () => {
  const script = chatAnswerBootScript()
  assert.ok(script.includes('dsh-tavern:answer-step'))
  assert.ok(script.includes('dsh-tavern:reasoning-stream'))
})

// 整轮思考汇总：玩法回合的思考落在工具步上，收尾行要能把它们全取出来画一次。
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('missing ' + name)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') { depth -= 1; if (depth === 0) return source.slice(start, index + 1) }
  }
  throw new Error('unbalanced ' + name)
}

test('按整轮收集思考块：工具步与收尾步的 reasoning 都算', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
  const collect = new Function(extractFunction(source, 'tavernTurnReasoningBlocks') + '\nreturn tavernTurnReasoningBlocks')()
  const node = blocks => ({ data: { get: key => (key === 'assistant-step' ? { blocks } : undefined) } })
  const turn = { steps: [
    node([{ kind: 'reasoning', text: '先想一层' }, { kind: 'tool-call' }]),
    node([{ kind: 'reasoning', text: '  ' }, { kind: 'tool-call' }]),
    node([{ kind: 'reasoning', text: '再想一层' }, { kind: 'text', text: '正文' }])
  ] }
  assert.deepEqual(collect(turn).map(block => block.text), ['先想一层', '再想一层'])
  assert.deepEqual(collect({ steps: [node([{ kind: 'text', text: '正文' }])] }), [])
  assert.deepEqual(collect(undefined), [])
})


test('原生对话流在出正文前借宿步骤槽流式展开思维链，出正文与跨多步后由回复座位统一收拢展示', async () => {
  const { readFileSync } = await import('node:fs')
  const vm = await import('node:vm')
  const source = readFileSync(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
  const start = source.indexOf('function tavernAssistantStepNode(')
  const end = source.indexOf('// Third-party plugins:', start)
  assert.ok(start > 0 && end > start, '应能定位流式思维链辅助函数区间')
  const snippet = source.slice(start, end)
  let streamEnabled = true
  const FakeReact = {
    createElement(type, props, ...children) {
      const nextProps = children.length ? Object.assign({}, props, { children }) : Object.assign({}, props)
      if (typeof type === 'function') return type(nextProps)
      return { type, props: props || {}, children }
    }
  }
  const TavernReasoningSeat = props => ({ seat: 'host', props })
  const context = vm.createContext({
    React: FakeReact,
    TavernReasoningSeat,
    useTavernReasoningStreamEnabled: () => streamEnabled,
    tavernReasoningStreamEnabled: () => streamEnabled
  })
  vm.runInContext(snippet, context)
  const { TavernAssistantReasoningSlot, TavernTurnReasoning, tavernTurnReasoningIsLive } = context

  const step1Running = {
    status: 'running',
    finalNode: { seq: 1 },
    blocks: [{ kind: 'reasoning', text: '第1步思考中' }]
  }
  const turnOnlyStep1 = {
    status: 'open',
    steps: [{ data: { get: k => (k === 'assistant-step' ? step1Running : null) } }]
  }
  const nodeStep1 = { data: step1Running, location: { kind: 'step', turn: turnOnlyStep1 } }
  const firstRender = TavernAssistantReasoningSlot({ node: nodeStep1 })
  assert.equal(firstRender.type, 'details')
  assert.equal(firstRender.props.className, 'dsh-tavern-assistant-reasoning dsh-tavern-stream-reasoning')
  assert.equal(firstRender.props.open, true, '首步仅有思考尚未出正文时应保持流式展开')
  assert.equal(firstRender.children[0].children[0], '思考中…')

  const step1CallingTool = {
    status: 'settled',
    finalNode: { seq: 1 },
    blocks: [{ kind: 'reasoning', text: '第1步思考完' }, { kind: 'tool-call', name: 'read' }]
  }
  const turnStep1Tool = { status: 'open', steps: [{ data: step1CallingTool }] }
  const toolPauseRender = TavernAssistantReasoningSlot({ node: { data: step1CallingTool, location: { kind: 'step', turn: turnStep1Tool } } })
  assert.equal(toolPauseRender.type, 'details')
  assert.equal(toolPauseRender.props.open, false, '思考结束转入工具调用时应立即收起并保留在原处不闪烁')
  assert.equal(toolPauseRender.children[0].children[0], '思考过程')

  const step2Thinking = {
    status: 'running',
    finalNode: { seq: 2 },
    blocks: [{ kind: 'reasoning', text: '第2步继续分析' }]
  }
  const turnTwoSteps = { status: 'open', steps: [{ data: step1CallingTool }, { data: step2Thinking }] }
  assert.equal(TavernAssistantReasoningSlot({ node: { data: step1CallingTool, location: { kind: 'step', turn: turnTwoSteps } } }), null, '旧步骤应让位给最新的思考步，避免重复渲染')
  const secondStepRender = TavernAssistantReasoningSlot({ node: { data: step2Thinking, location: { kind: 'step', turn: turnTwoSteps } } })
  assert.equal(secondStepRender.props.open, true)
  assert.ok(secondStepRender.children[1].children[0].includes('第1步思考完') && secondStepRender.children[1].children[0].includes('第2步继续分析'))

  const step2WithReply = {
    status: 'running',
    finalNode: { seq: 2 },
    blocks: [{ kind: 'reasoning', text: '第2步继续分析' }, { kind: 'text', text: '正文开始' }]
  }
  const turnWithReply = { status: 'open', steps: [{ data: step1CallingTool }, { data: step2WithReply }] }
  assert.equal(TavernAssistantReasoningSlot({ node: { data: step2WithReply, location: { kind: 'step', turn: turnWithReply } } }), null, '已有正文后步骤槽应彻底让位给回复座位')
  const replySeatReasoning = TavernTurnReasoning({ turn: turnWithReply, fallbackBlocks: step2WithReply.blocks, streaming: true })
  assert.equal(replySeatReasoning.props.open, false, '正文开始输出后回复座位上的思维链应立即收起')
  assert.equal(tavernTurnReasoningIsLive(turnWithReply, step2WithReply.blocks, true), false)

  streamEnabled = false
  const hostSeat = TavernAssistantReasoningSlot({ node: nodeStep1 })
  assert.deepEqual(hostSeat, { seat: 'host', props: { blocks: step1Running.blocks, streaming: true } })
})
