import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from './fixtures/client-vm.mjs'
import { chatAnswerBootScript } from '../tavern-plugin/lib/domain/chat-answer-boot-patch.js'
import { CHAT_ANSWER_STEP_MARKER } from '../tavern-plugin/lib/domain/chat-answer-step.js'

const bootRoot = process.env.DSH_BOOT_MODULE ? process.env.DSH_BOOT_MODULE.split(path.sep + 'node_modules' + path.sep)[0] : ''
const runtime = process.env.TAVERN_DSH_RUNTIME || bootRoot || path.resolve('config/cli-runtime')
let chatClient = ''
try { chatClient = readFileSync(path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'), 'utf8') } catch {}

test('the built host embeds a self-contained page patch with keepNames enabled', async () => {
  const { build } = createRequire(import.meta.url)('esbuild')
  const result = await build({ entryPoints: [fileURLToPath(new URL('../tavern-plugin/lib/domain/chat-answer-boot-patch.js', import.meta.url))], bundle: true, write: false, keepNames: true, format: 'iife', globalName: 'built' })
  const host = vm.createContext({})
  vm.runInContext(result.outputFiles[0].text, host)
  const warnings = [], context = vm.createContext({ console: { warn: (...args) => warnings.push(args) } })
  context.window = context
  vm.runInContext(host.built.chatAnswerBootScript(), context)
  vm.runInContext('window.__ModuleLoader__ = { load(value) { window.registration = value } }; window.__ModuleLoader__.load({id:"@deepseek-ai/dsh-client-ui-chat",factory:function(){function latestAnswer(turn){return turn.steps.at(-1)};return latestAnswer}})', context)
  assert.match(String(context.registration.factory), /dsh-tavern:answer-step/)
  assert.deepEqual(warnings, [])
})

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

test('回答步骤的两个座位各显示自己的块：过程座只有思考，回复座不重复思考（#254）', () => {
  const client = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  // 「流式显示思维链」把思考搬进回复座位；打开时过程座位让位，同一段思考不画两遍。
  assert.match(client, /tavernReasoningStreamEnabled\(\) \? null : React\.createElement\(TavernReasoningSeat/)
  assert.match(client, /input\.groupPart !== "response" \|\| block\.kind !== "reasoning" \|\| reasoningInReply/)
  assert.match(client, /groupPart: props\.groupPart,/)
})
