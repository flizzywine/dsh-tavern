// 桌面宿主把 @deepseek-ai/dsh-client-ui-chat 打进只读的 app.asar，安装期改文件的路子
// 走不通；这里改为页面启动前注入脚本，在模块注册工厂的那一刻改写 latestAnswer。
// 覆盖四件事：只改对话界面、只看 latestAnswer 不动步骤匹配、改完仍取到有内容的步骤、
// 宿主换掉 load 实现后补丁仍在。
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { CHAT_UI_MODULE_ID, chatAnswerBootScript, installChatAnswerBootPatch } from '../tavern-plugin/lib/domain/chat-answer-boot-patch.js'

function sandboxWithLoader() {
  const sandbox = { console: { info() {}, warn() {}, error() {} }, window: {}, Object, Array, RegExp, JSON, String, Map, Function }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(chatAnswerBootScript(), sandbox)
  const registrations = []
  sandbox.window.__ModuleLoader__ = { load(registration) { registrations.push(registration) } }
  return { sandbox, registrations }
}

function chatFactory() {
  return function (require) {
    function latestAnswer(turn) {
      const data = turn.steps.at(-1)?.data.get("assistant-step")
      return data ?? null
    }
    return { latestAnswer }
  }
}

// 真实对话界面的步骤匹配：只认 append，酒馆用 replace 改写正文时这一步就没有数据。
function chatFactoryWithMatch() {
  return function (require) {
    const match = (event) => {
      if (event.type === "step/start") return { id: `${event.data.turn}:${event.data.step}`, role: "start" }
      if (event.type === "assistant/live-chunk" || event.type === "assistant/message" && event.surfaceOp === "append") return {
        id: `${event.data.turn}:${event.data.step}`,
        role: "update"
      }
      return null
    }
    return { match }
  }
}

test('注入脚本在对话界面模块注册时改写 latestAnswer，其余模块原样放过', () => {
  const { sandbox, registrations } = sandboxWithLoader()
  sandbox.window.__ModuleLoader__.load({ id: CHAT_UI_MODULE_ID, factory: chatFactory() })
  sandbox.window.__ModuleLoader__.load({ id: '@deepseek-ai/dsh-client-ui-conversation', factory: chatFactory() })
  assert.equal(registrations.length, 2)
  assert.match(String(registrations[0].factory), /dsh-tavern:answer-step/)
  assert.doesNotMatch(String(registrations[1].factory), /dsh-tavern:answer-step/)
})

// 步骤匹配不能再动：让 replace 也生成 assistant-step 的话，同一段正文会在原步骤和改写
// 步骤各渲染一遍，页面上出现重复正文。
test('不改写步骤匹配，改写步骤不会再建一个 assistant-step 节点', () => {
  const { sandbox, registrations } = sandboxWithLoader()
  sandbox.window.__ModuleLoader__.load({ id: CHAT_UI_MODULE_ID, factory: chatFactoryWithMatch() })
  const source = String(registrations[0].factory)
  assert.doesNotMatch(source, /surfaceOp\.op === "replace"/)
  const exported = registrations[0].factory(() => ({}))
  assert.equal(exported.match({ type: 'assistant/message', data: { turn: 3, step: 2 }, surfaceOp: { op: 'replace', startSeq: 15, endSeq: 27 } }), null)
  // append 与其余事件的行为不变
  assert.deepEqual(exported.match({ type: 'assistant/message', data: { turn: 1, step: 1 }, surfaceOp: 'append' }), { id: '1:1', role: 'update' })
  assert.equal(exported.match({ type: 'tool/call', data: { turn: 1, step: 1 } }), null)
})

test('改写后的 latestAnswer 回退到最后一个有回复内容的步骤', () => {
  const { sandbox, registrations } = sandboxWithLoader()
  sandbox.window.__ModuleLoader__.load({ id: CHAT_UI_MODULE_ID, factory: chatFactory() })
  const exported = registrations[0].factory(() => ({}))
  const answer = { blocks: [{ kind: 'text', text: '整理后的正文' }] }
  const steps = [
    { data: new Map([['assistant-step', answer]]) },
    { data: new Map() }
  ]
  assert.equal(exported.latestAnswer({ steps }), answer)
  // 最后一步本身有内容时行为不变
  const last = { blocks: [{ kind: 'text', text: '最后一步的正文' }] }
  assert.equal(exported.latestAnswer({ steps: [steps[0], { data: new Map([['assistant-step', last]]) }] }), last)
})

test('重复赋值不会二次包装 load', () => {
  const { sandbox, registrations } = sandboxWithLoader()
  const loader = sandbox.window.__ModuleLoader__
  sandbox.window.__ModuleLoader__ = loader
  sandbox.window.__ModuleLoader__.load({ id: CHAT_UI_MODULE_ID, factory: chatFactory() })
  assert.equal(registrations.length, 1)
  assert.equal((String(registrations[0].factory).match(/dsh-tavern:answer-step/g) || []).length, 1)
})

test('宿主进入 live 后重新给 load 赋值，补丁仍然生效', () => {
  const { sandbox, registrations } = sandboxWithLoader()
  // 真实宿主会把队列 loader 的 load 换成 live 实现，覆盖掉注入时包住的那层。
  sandbox.window.__ModuleLoader__.load = (registration) => registrations.push(registration)
  sandbox.window.__ModuleLoader__.load({ id: CHAT_UI_MODULE_ID, factory: chatFactory() })
  assert.equal(registrations.length, 1)
  assert.equal((String(registrations[0].factory).match(/dsh-tavern:answer-step/g) || []).length, 1)
})

test('注入行放在 head 首位，且重复触发不会重复注入', () => {
  let listener
  const ctx = {
    inject(names, callback) {
      assert.deepEqual(names, ['webServer'])
      callback({ on(event, handler) { assert.equal(event, 'webserver/index-inject'); listener = handler } })
    }
  }
  installChatAnswerBootPatch(ctx)
  assert.equal(typeof listener, 'function')
  const table = [{ kind: 'script', placement: 'head', text: 'queue' }]
  listener(table)
  assert.equal(table.length, 2)
  assert.equal(table[0].placement, 'head')
  assert.match(table[0].text, /__ModuleLoader__/)
  assert.equal(table[1].text, 'queue')
  listener(table)
  assert.equal(table.length, 2)
})
