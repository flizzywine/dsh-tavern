import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'
import { chatAnswerBootScript, installChatAnswerBootPatch } from '../tavern-plugin/lib/domain/chat-answer-boot-patch.js'
import { CHAT_ANSWER_STEP_MARKER } from '../tavern-plugin/lib/domain/chat-answer-step.js'

const bootRoot = process.env.DSH_BOOT_MODULE ? process.env.DSH_BOOT_MODULE.split(path.sep + 'node_modules' + path.sep)[0] : ''
const runtime = process.env.TAVERN_DSH_RUNTIME || bootRoot || path.resolve('config/cli-runtime')
let chatClient = ''
try { chatClient = readFileSync(path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'), 'utf8') } catch {}

function page() {
  const window = { console: { warn() {}, info() {} } }
  window.window = window
  const context = vm.createContext(window)
  vm.runInContext(chatAnswerBootScript(), context)
  return context
}

test('页面补丁拦住排队与实时两个阶段的注册，改写真实宿主对话界面的 latestAnswer（#254）', { skip: !chatClient && '需要一套 DSH 0.2.1 运行时' }, () => {
  const context = page()
  // The host's queue loader, then its live loader assigned onto the same object.
  vm.runInContext('window.__ModuleLoader__ = { pendingQueue: [], load(registration) { this.pendingQueue.push(registration) } }', context)
  vm.runInContext(chatClient, context)
  const queued = context.__ModuleLoader__.pendingQueue[0]
  assert.equal(queued.id, '@deepseek-ai/dsh-client-ui-chat')
  assert.ok(String(queued.factory).includes(CHAT_ANSWER_STEP_MARKER), 'the queued factory is patched')

  const live = []
  vm.runInContext('window.__ModuleLoader__.load = registration => window.__live.push(registration)', Object.assign(context, { __live: live }))
  vm.runInContext(chatClient, context)
  assert.ok(String(live[0].factory).includes(CHAT_ANSWER_STEP_MARKER), 'a registration after the live loader takes over is patched too')
})

test('页面补丁只动对话界面模块，形状对不上时原样放过', () => {
  const context = page()
  vm.runInContext('window.__ModuleLoader__ = { seen: [], load(registration) { this.seen.push(registration) } }', context)
  const other = { id: 'other', factory: () => 1 }
  const unmatched = { id: '@deepseek-ai/dsh-client-ui-chat', factory: () => 2 }
  context.__ModuleLoader__.load(other)
  context.__ModuleLoader__.load(unmatched)
  assert.equal(context.__ModuleLoader__.seen[0], other)
  assert.equal(context.__ModuleLoader__.seen[1].factory, unmatched.factory)
})

test('补丁脚本排在页面 head 的第一位，且只注入一次', () => {
  let handler
  installChatAnswerBootPatch({ inject: (_deps, apply) => apply({ on: (_event, fn) => { handler = fn } }) })
  const table = [{ kind: 'script', placement: 'head', text: 'queue' }]
  handler(table); handler(table)
  assert.equal(table.length, 2)
  assert.equal(table[0].kind, 'script')
  assert.match(table[0].text, /__ModuleLoader__/)
})

test('回答步骤的两个座位各显示自己的块：过程座只有思考，回复座不重复思考（#254）', () => {
  const client = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /if \(props\.groupPart === "reasoning"\) return React\.createElement\(TavernReasoningSeat/)
  assert.match(client, /input\.groupPart !== "response" \|\| block\.kind !== "reasoning"/)
  assert.match(client, /groupPart: props\.groupPart,/)
})
