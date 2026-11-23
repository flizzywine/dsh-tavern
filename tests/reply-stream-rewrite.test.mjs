import assert from 'node:assert/strict'
import test from 'node:test'
import { createReplyRewriteStream, createReplyStreamRewriters } from '../tavern-plugin/lib/domain/reply-stream-rewrite.js'
import { createModelRequestLog } from '../tavern-plugin/lib/domain/model-request-log.js'
import { registerModelStreamHooks } from '../tavern-plugin/lib/hooks/model-stream.js'

// A rewriter that cuts at paragraph breaks and upper-cases what it is given.
function paragraphRewriter({ min = 4, fail = false, slow = 0 } = {}) {
  const calls = []
  return {
    calls,
    plan(buffer, { eof }) {
      if (eof) return buffer.length
      const index = buffer.indexOf('\n\n')
      if (index < 0) return null
      const cut = index + 2
      return cut >= min ? cut : null
    },
    async rewrite(text) {
      calls.push(text)
      if (slow) await new Promise(resolve => setTimeout(resolve, slow))
      if (fail) throw new Error('upstream down')
      return text.toUpperCase()
    }
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

async function feed(stream, tokens) {
  let output = ''
  for (const token of tokens) {
    output += stream.push(token)
    await flush()
    output += stream.push('')
  }
  output += await stream.drain()
  return output
}

test('改写失败的那一段退回原文，后续段继续', async () => {
  const rewriter = paragraphRewriter({ fail: true })
  const warnings = []
  const stream = createReplyRewriteStream({ rewriter, warn: error => warnings.push(error) })
  const first = '第一段文字很长很长，长到足以触发切点扫描。\n\n'
  const output = await feed(stream, [first])
  assert.equal(output, first)
  assert.equal(warnings.length, 1)
})

test('取消后缓冲原文不再等改写', async () => {
  const rewriter = paragraphRewriter({ slow: 50 })
  const controller = new AbortController()
  const stream = createReplyRewriteStream({ rewriter, signal: controller.signal })
  stream.push('待改写的一段。\n\n')
  controller.abort()
  assert.equal(stream.push('尾巴'), '待改写的一段。\n\n尾巴')
})

test('open 只在有改写器时建立管道，并把上下文传给 rewrite', async () => {
  const host = createReplyStreamRewriters()
  assert.equal(host.open({ sessionId: 's', turn: 1 }), null)
  const seen = []
  host.register('p', {
    plan: buffer => buffer.length,
    async rewrite(text, context) { seen.push(context); return text + '!' }
  })
  const stream = host.open({ sessionId: 's', turn: 3, chatId: 'c', mode: 'story' })
  const body = '一段足够长的正文，长到能够触发切点扫描并把这一段交给改写器处理。'
  assert.equal(await feed(stream, [body]), body + '!')
  assert.deepEqual(seen[0], { sessionId: 's', chatId: 'c', turn: 3, mode: 'story', signal: undefined })
})

// The real llm/stream hook of a story game, with a rewriter host installed.
function storyStream(replyStreamRewriters) {
  const files = new Map()
  let stamp = 1000
  const log = createModelRequestLog({
    readJson: async path => { const value = files.get(path); return typeof value === 'string' ? JSON.parse(value) : structuredClone(value) },
    writeJson: async (path, value) => { files.set(path, structuredClone(value)) },
    updateJson: async (path, updater) => { files.set(path, structuredClone(await updater(structuredClone(files.get(path))))) },
    writeText: async (path, text) => { files.set(path, text) },
    remove: async path => { files.delete(path) },
    now: () => ++stamp, id: () => 'r' + stamp
  })
  let hook
  const game = { id: 'chat-game', mode: 'story', requestMode: 'sillytavern' }
  registerModelStreamHooks({
    ctx: { on(name, fn) { if (name === 'llm/stream') hook = fn }, llm: {}, get() {}, logger: () => ({ warn() {} }) },
    agentRegistry: { get: () => undefined }, sessionStore: { get: () => undefined, flush() {} },
    backgroundAgentRunner: { owns: () => false, requestContext: () => undefined },
    chatForSession: async () => undefined, chatHeaderForSession: async id => id === 'session-game' ? game : undefined,
    foregroundStrategies: { projectRequest: () => null, completeRequest() {} },
    fullTemplateRuntime: {}, modelRequestLog: log, requestCoordinates: new Map([['session-game', { turn: 2, step: 1 }]]),
    str: value => typeof value === 'string' ? value : '', replyStreamRewriters,
    sessionStateForSession: async () => null, updateChat: async () => {}, worldbookRecallLog: { requested: async () => {} },
    runtimePrompt: () => '', storyRetention: async () => ({})
  })
  const send = async provider => {
    const chunks = []
    for await (const chunk of hook({ sessionId: 'session-game', messages: [{ role: 'user', content: [{ type: 'text', text: '继续' }] }] }, provider)) chunks.push(chunk)
    return chunks
  }
  return { send, log }
}

// A provider that streams one text block and then repeats it whole in block-end, as real providers do.
function oneTextBlock(pieces) {
  return async function * () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for (const text of pieces) yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: pieces.join('') } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

test('整篇攒着改写：block-end 带的是改写后的整块，存档和请求日志都不会退回原文', async () => {
  const host = createReplyStreamRewriters()
  host.register('whole', { plan: (buffer, { eof }) => eof ? buffer.length : null, async rewrite(text) { return '改写过的：' + text } })
  const { send, log } = storyStream(host)
  const chunks = await send(oneTextBlock(['她推开门，', '雨还在下。']))
  assert.deepEqual(chunks.map(chunk => chunk.type), ['block-start', 'text-delta', 'block-end', 'finish'])
  assert.deepEqual(chunks[1], { type: 'text-delta', index: 0, text: '改写过的：她推开门，雨还在下。' })
  assert.equal(chunks[2].block.text, '改写过的：她推开门，雨还在下。')
  assert.equal((await log.evidence('chat-game')).requests[0].response.text, '改写过的：她推开门，雨还在下。')
})

test('边写边改的改写器：block-end 也换成逐段改写后拼起来的全文', async () => {
  const host = createReplyStreamRewriters()
  host.register('polish', paragraphRewriter({ min: 1 }))
  const { send } = storyStream(host)
  const pieces = ['the first paragraph is long enough to be cut.\n\n', 'the second one ', 'ends the reply.']
  const chunks = await send(oneTextBlock(pieces))
  const written = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
  assert.equal(written, pieces.join('').toUpperCase())
  assert.equal(chunks.find(chunk => chunk.type === 'block-end').block.text, written)
  assert.equal(chunks.at(-1).type, 'finish')
})

test('没有改写器时 block-end 原样放过', async () => {
  const { send } = storyStream(createReplyStreamRewriters())
  const chunks = await send(oneTextBlock(['原文。']))
  assert.equal(chunks.find(chunk => chunk.type === 'block-end').block.text, '原文。')
})
