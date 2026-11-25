import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/modules/story-external-history.js', import.meta.url), 'utf8')
const reminders = await readFile(new URL('../tavern-plugin/lib/domain/system-reminders.cjs', import.meta.url), 'utf8')
const receipts = await readFile(new URL('../tavern-plugin/lib/domain/writing-material-receipts.cjs', import.meta.url), 'utf8')

function load() {
	const context = vm.createContext({ console, window: {} })
	vm.runInContext(reminders, context)
	vm.runInContext(receipts, context)
	vm.runInContext(source, context)
	return context
}

// 原生 ChatFlow 的构建上下文：start.location 指向回合，current 是本轮已物化的节点。
function at(turn, extras = {}) {
	return { start: { location: { kind: 'turn', turn: { turn } } }, current: new Map(), ...extras }
}

function unknownLocation() {
	return { start: { location: { kind: 'session' } }, current: new Map() }
}

function harness(options = {}) {
	const context = load()
	const calls = []
	const rebuilds = []
	const rebuiltNodes = []
	const disposed = []
	const enabledCalls = []
	const builtStates = []
	const state = { enabled: options.enabled !== false, turnOrder: options.turnOrder || [1, 2, 3], openTurn: options.openTurn }
	const assembler = {
		activeTargets: options.activeTargets || new Set(['chat']),
		locationIndex: { snapshot: () => ({ turnOrder: state.turnOrder }) },
		openTurn: () => state.openTurn,
		buildNode(buildContext, target) {
			builtStates.push(buildContext?.state)
			const turn = buildContext && buildContext.start && buildContext.start.location && buildContext.start.location.turn
			calls.push({ turn: turn && turn.turn, target })
			return { native: true, target, turn: turn ? turn.turn : null }
		}
	}
	const originalBuild = assembler.buildNode
	const binding = {
		assembler,
		rebuild() {
			rebuiltNodes.push(assembler.buildNode(at(2), 'chat'))
			rebuilds.push(true)
			return rebuilds.length
		},
		dispose() { disposed.push('original'); return 'disposed' }
	}
	const originalDispose = binding.dispose
	class UiConversation {
		constructor(bindings) { this.bindings = bindings }
		binding(session) { return this.bindings.get(String(session)) }
	}
	const proto = UiConversation.prototype
	const originalProtoBinding = proto.binding
	const instance = new UiConversation(new Map([['s1', binding]]))
	const handle = context.installTavernStoryExternalHistory({
		require: () => ({ UiConversation }),
		uiConversation: instance,
		trajectoryPolicy: options.trajectoryPolicy,
		isEnabled: session => { enabledCalls.push(session); return state.enabled }
	})
	return { context, handle, instance, proto, originalProtoBinding, assembler, binding, originalBuild, originalDispose,
		calls, rebuilds, rebuiltNodes, disposed, enabledCalls, builtStates, state }
}

test('酒馆轨迹隐藏宿主提醒，保留 Skill 和玩家内容', async () => {
	const h = harness({ activeTargets: new Set(['trajectory']), trajectoryPolicy: async id => ({ hideSystemReminders: id === 's1' }) })
	h.instance.binding('s1')
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.rebuilds.length, 1)
	const reminder = at(3, { state: { kind: 'context', source: { kind: 'runtime-context' } } })
	assert.equal(h.assembler.buildNode(reminder, 'trajectory'), null)
	const skill = at(3, { state: { kind: 'context', source: { kind: 'skill-catalog' } } })
	assert.equal(h.assembler.buildNode(skill, 'trajectory').native, true)
	const unknown = at(3, { state: { kind: 'context', source: { kind: 'plugin:host' },
		content: [{ type: 'text', text: '<system-reminder>宿主信息</system-reminder>' }] } })
	assert.equal(h.assembler.buildNode(unknown, 'trajectory'), null)
	const player = at(3, { state: { kind: 'user', content: [{ type: 'text', text: '<system-reminder>书里的字样' }] } })
	assert.equal(h.assembler.buildNode(player, 'trajectory').native, true)
	assert.equal(h.assembler.buildNode(at(3, { state: { kind: 'assistant' } }), 'trajectory').native, true)
	assert.equal(h.assembler.buildNode(reminder, 'preview').native, true)
	h.handle.dispose()
	assert.equal(h.assembler.buildNode(reminder, 'trajectory').native, true)
})

test('白手套的前台轨迹隐藏 Skill 和旧变量回执，保留剧情事实', async () => {
	const h = harness({ activeTargets: new Set(['trajectory']),
		trajectoryPolicy: async () => ({ hideSystemReminders: true, hideSkillContext: true }) })
	h.instance.binding('s1')
	await new Promise(resolve => setImmediate(resolve))
	const skill = at(3, { state: { kind: 'context', source: { kind: 'skill-catalog' } } })
	assert.equal(h.assembler.buildNode(skill, 'trajectory'), null)
	const skillText = '【写作指引】\n写作规则。'
	const lore = '【世界书 · 钟楼】\n塔钟在整点响。'
  const raw = '【当前变量 · game】\ngame的characters的char_001的occupation为 律师。'
  const facts = '【当前状态】\n林婉是律师。'
	const injection = text => at(3, { state: { kind: 'context', source: { kind: 'plugin:dsh-tavern-pure-writer', form: 'inject' },
		content: [{ type: 'text', text }] } })
	assert.equal(h.assembler.buildNode(injection(skillText), 'trajectory'), null)
  assert.equal(h.assembler.buildNode(injection(raw), 'trajectory'), null)
  const text = [skillText, raw, lore, facts].join('\n\n')
  const mixed = injection(text)
	assert.equal(h.assembler.buildNode(mixed, 'trajectory').native, true)
  assert.equal(h.builtStates.at(-1).content[0].text, [lore, facts].join('\n\n'))
  assert.equal(mixed.state.content[0].text, text)
	h.handle.dispose()
})

test('故事模式下未物化的旧回合不构建 chat 节点，返回 null 且不调用原生 buildNode', () => {
	const h = harness()
	assert.equal(h.instance.binding('s1'), h.binding)
	assert.equal(h.assembler.buildNode(at(2), 'chat'), null, '旧回合被裁剪')
	assert.equal(h.assembler.buildNode({ ...at(2), current: null }, 'chat'), null, '没有 current 映射的旧回合同样裁剪')
	assert.equal(h.calls.length, 0, '原生 buildNode 不应被调用')
})

test('最新回合、开放回合、未知位置与非 chat target 保留原生构建', () => {
	const h = harness()
	h.instance.binding('s1')
	assert.equal(h.assembler.buildNode(at(3), 'chat').native, true, '最新回合保留')
	h.state.openTurn = 2
	assert.deepEqual(h.assembler.buildNode(at(2), 'chat'), { native: true, target: 'chat', turn: 2 }, '开放回合保留')
	assert.equal(h.assembler.buildNode(unknownLocation(), 'chat').native, true, '未知位置保留')
	assert.equal(h.assembler.buildNode({ start: { location: { kind: 'turn', turn: { turn: 'nope' } } }, current: new Map() }, 'chat').native, true, '非法回合号保留')
	assert.equal(h.assembler.buildNode(at(2), 'preview').native, true, '非 chat target 保留')
	assert.equal(h.calls.length, 5)
})

test('已物化旧节点仍调用原生 buildNode，避免撤回已存在的 chat 目标', () => {
	const h = harness()
	h.instance.binding('s1')
	const materialized = at(2, { current: new Map([['chat', { id: 'm2' }]]) })
	assert.deepEqual(h.assembler.buildNode(materialized, 'chat'), { native: true, target: 'chat', turn: 2 })
	assert.equal(h.calls.length, 1, '已物化的旧回合必须走原生构建')
	assert.equal(h.assembler.buildNode(at(2, { current: new Map([['step', { id: 's2' }]]) }), 'chat'), null, '其他 target 的节点不算 chat 已物化')
})

test('enabled=false 时保留全部节点，不做任何裁剪', () => {
	const h = harness({ enabled: false })
	h.instance.binding('s1')
	assert.equal(h.assembler.buildNode(at(2), 'chat').native, true)
	assert.equal(h.assembler.buildNode(at(1), 'chat').native, true)
	assert.equal(h.assembler.buildNode(unknownLocation(), 'chat').native, true)
	assert.equal(h.calls.length, 3, '所有构建都交给原生实现')
})

test('refresh 仅在 enabled 变化或 force 时重建，状态不变不重复重建', () => {
	const h = harness()
	h.instance.binding('s1')
	assert.equal(h.rebuilds.length, 0)
	h.handle.refresh('s1')
	assert.equal(h.rebuilds.length, 1, '首次确定状态后重建一次')
	h.handle.refresh('s1')
	assert.equal(h.rebuilds.length, 1, '状态不变不重建')
	h.state.enabled = false
	h.handle.refresh('s1')
	assert.equal(h.rebuilds.length, 2, '状态变化触发重建')
	h.handle.refresh('s1')
	assert.equal(h.rebuilds.length, 2)
	h.handle.refresh('s1', true)
	assert.equal(h.rebuilds.length, 3, 'force=true 强制重建')
	h.handle.refresh('s1', { force: true })
	assert.equal(h.rebuilds.length, 4, 'force 选项强制重建')
	assert.deepEqual([...new Set(h.enabledCalls)], ['s1'], 'enabled 判断使用字符串 session id')

	const idle = harness({ activeTargets: new Set(['preview']) })
	idle.instance.binding('s1')
	idle.handle.refresh('s1')
	idle.state.enabled = false
	idle.handle.refresh('s1')
	idle.handle.refresh('s1', true)
	assert.equal(idle.rebuilds.length, 0, '没有激活 chat target 时不重建')
})

test('dispose 恢复原型 binding、实例 buildNode 与 dispose，并以完整原生语义重建', () => {
	const h = harness()
	h.instance.binding('s1')
	assert.notEqual(h.proto.binding, h.originalProtoBinding)
	assert.ok(h.proto.__dshTavernStoryExternalHistory, '安装后原型带有控制器标记')
	h.handle.dispose()
	assert.equal(h.proto.binding, h.originalProtoBinding, '原型 binding 已恢复')
	assert.equal('__dshTavernStoryExternalHistory' in h.proto, false, '原型标记已移除')
	assert.equal(h.assembler.buildNode, h.originalBuild, '实例 buildNode 已恢复')
	assert.equal(h.binding.dispose, h.originalDispose, 'binding.dispose 已恢复')
	assert.equal(h.rebuilds.length, 1, 'dispose 触发一次重建')
	assert.equal(h.rebuiltNodes[0].native, true, '重建期间旧回合走完整原生构建')
	const before = h.calls.length
	assert.equal(h.assembler.buildNode(at(2), 'chat').native, true, '此后旧回合按原生语义构建')
	assert.equal(h.calls.length, before + 1)
	h.handle.dispose()
	assert.equal(h.rebuilds.length, 1, '重复 dispose 不再重建')
	assert.equal(h.binding.dispose(), 'disposed', '原始 dispose 仍可调用一次')
	assert.deepEqual(h.disposed, ['original'])
})
