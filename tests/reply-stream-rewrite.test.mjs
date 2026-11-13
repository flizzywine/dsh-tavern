import assert from 'node:assert/strict'
import test from 'node:test'
import { createReplyRewriteStream, createReplyStreamRewriters } from '../tavern-plugin/lib/domain/reply-stream-rewrite.js'

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

test('按段落切段改写，输出保持原顺序', async () => {
  const rewriter = paragraphRewriter()
  const stream = createReplyRewriteStream({ rewriter })
  const first = '第一段文字很长很长，长到足以触发切点扫描。\n\n'
  const second = '第二段文字也很长很长，同样足以触发切点。\n\n'
  const output = await feed(stream, [first, second])
  assert.equal(output, first + second)
  assert.deepEqual(rewriter.calls, [first, second])
})

test('不满一段时先缓冲，drain 时整段改写', async () => {
  const rewriter = paragraphRewriter()
  const stream = createReplyRewriteStream({ rewriter })
  assert.equal(stream.push('短句。'), '')
  assert.equal(await stream.drain(), '短句。')
  assert.deepEqual(rewriter.calls, ['短句。'])
})

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

test('注册表：重复注册报错，dispose 后不再激活', () => {
  const host = createReplyStreamRewriters()
  assert.equal(host.active, false)
  const plan = () => null
  const rewrite = async text => text
  const off = host.register('a', { plan, rewrite })
  assert.equal(host.active, true)
  assert.throws(() => host.register('a', { plan, rewrite }), /已经注册过/)
  assert.throws(() => host.register('b', { plan }), /需要 plan/)
  off()
  assert.equal(host.active, false)
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

test('plan 抛错或返回非法值时停止改写并吐出原文，不丢字', async () => {
  const stream = createReplyRewriteStream({
    rewriter: { plan() { throw new Error('bad plan') }, async rewrite(text) { return text.toUpperCase() } },
    warn: () => {}
  })
  const text = '一段足够长的正文，长到能触发切点扫描并失败，长度要超过三十二个字符才扫。'
  assert.equal(stream.push(text), text)
  assert.equal(await stream.drain(), '')
})
