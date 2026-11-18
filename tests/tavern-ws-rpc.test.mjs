// 酒馆自建独立 WebSocket RPC 通道（/api/dsh-tavern/ws）：协议编解码、安全围栏、大包多路复用与断线回退单测
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import WebSocket from 'ws'
import vm from './fixtures/client-vm.mjs'

import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'
import { encodeWsFrame, TAVERN_WS_RPC_PATH } from '../tavern-plugin/lib/http/ws-rpc.js'

const require = createRequire(import.meta.url)
const {
  createPresentationQueue,
  rpcFetchPriority,
  createTavernWsRpcClient,
  isIdempotentTavernRpc,
} = require('../tavern-plugin/src/client/rpc-transport.cjs')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function startWsTestHarness(t, { dispatch, authState = { rejection: undefined } } = {}) {
  const routes = new Map()
  const upgrades = new Map()
  const cleanups = []

  const httpServer = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    for (const [prefix, route] of routes) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) {
        await route.handler(req, res)
        return
      }
    }
    res.writeHead(404)
    res.end('not found')
  })

  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const route = upgrades.get(pathname)
    if (!route) {
      socket.destroy()
      return
    }
    route.handler(req, socket, head)
  })

  const webServer = {
    server: httpServer,
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
    registerUpgrade(route) {
      upgrades.set(route.path, route)
      return () => upgrades.delete(route.path)
    },
  }

  const connection = {
    trustedHosts: [],
    requestRejection(req) {
      if (typeof authState.rejection === 'function') return authState.rejection(req)
      return authState.rejection
    },
  }

  const ctx = {
    get(name) {
      if (name === 'webServer') return webServer
      if (name === 'connection') return connection
      return undefined
    },
    effect(fn) {
      const off = fn()
      if (typeof off === 'function') cleanups.push(off)
      return off
    },
    logger: { warn() {} },
  }

  registerTavernHttpRoutes({
    ctx,
    dispatch,
    str: value => String(value ?? ''),
    runtimeGeneration: 'gen-ws-1',
    runtimeReadiness: Promise.resolve({ ok: true }),
    performanceDiagnostics: { http() {} },
  })

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', resolve)
  })
  const port = httpServer.address().port
  const httpBase = `http://127.0.0.1:${port}`
  const wsUrl = `ws://127.0.0.1:${port}${TAVERN_WS_RPC_PATH}`

  t.after(async () => {
    for (const off of cleanups.splice(0)) off()
    await new Promise(resolve => httpServer.close(() => resolve()))
  })

  return { port, httpBase, wsUrl }
}

function wrapNodeWsAsBrowserSocket(url, headers = {}) {
  const raw = new WebSocket(url, {
    headers,
    perMessageDeflate: false,
  })
  return raw
}

test('单条独立 WebSocket 并发承载 40 路 RPC 与 1.5MB 中文快照，HTTP 连接占用为 0', async t => {
  const receivedCalls = []
  const largeStory = '【命运之轮·正文卷】🌅✨——' + '风雪夜归人，灯火照寒江。'.repeat(50000)

  const harness = await startWsTestHarness(t, {
    dispatch: async (method, args, meta) => {
      receivedCalls.push({ method, args, origin: meta?.origin })
      if (method === 'getStoryTranscript') {
        await new Promise(r => setTimeout(r, 15))
        return { transcript: largeStory, count: args.turn || 30 }
      }
      if (method === 'callPluginHandler') {
        await new Promise(r => setTimeout(r, Math.random() * 10))
        return { result: { ok: true, echo: args.args?.idx, plugin: args.name } }
      }
      if (method === 'managedModBroken') {
        throw Object.assign(new Error('模组冲突'), { code: 'MOD_CONFLICT', details: { ids: ['a', 'b'] } })
      }
      return { echoed: args }
    },
  })

  let openedSockets = 0
  const wsClient = createTavernWsRpcClient({
    openSocket: () => {
      openedSockets++
      return wrapNodeWsAsBrowserSocket(harness.wsUrl, {
        Origin: harness.httpBase,
        Cookie: 'dsh_owner=valid',
      })
    },
  }).start()
  t.after(() => wsClient.dispose())

  let httpCalls = 0
  const failIfHttp = () => {
    httpCalls++
    throw new Error('不应回退到 HTTP 连接池')
  }

  // 并发打入 40 路请求（含 1.5MB 大体积快照、插件批调用、普通读写）
  const tasks = []
  tasks.push(wsClient.call('getStoryTranscript', JSON.stringify({ sessionId: 's-1', turn: 30 }), { fallback: failIfHttp }))
  for (let i = 0; i < 38; i++) {
    tasks.push(
      wsClient.call(
        'callPluginHandler',
        JSON.stringify({ name: 'fate-dice:read-turns', args: { idx: i } }),
        { fallback: failIfHttp }
      )
    )
  }
  tasks.push(wsClient.call('managedModBroken', '{}', { fallback: failIfHttp }))

  const results = await Promise.all(tasks)
  assert.equal(httpCalls, 0, '全部请求均通过独立 WebSocket 完成，占用 0 个 HTTP 槽位')
  assert.equal(openedSockets, 1, '全过程仅建立 1 条 WebSocket 连接')
  assert.equal(results[0].ok, true)
  assert.equal(results[0].runtimeGeneration, 'gen-ws-1')
  assert.equal(results[0].transcript, largeStory)

  for (let i = 0; i < 38; i++) {
    assert.equal(results[i + 1].ok, true)
    assert.equal(results[i + 1].result.echo, i)
  }

  // 错误码与 errorDetails 与 HTTP POST 语义完全一致
  const errReply = results[39]
  assert.equal(errReply.ok, false)
  assert.equal(errReply.errorCode, 'MOD_CONFLICT')
  assert.deepEqual(errReply.errorDetails, { ids: ['a', 'b'] })

  // 同源 Origin 被准确还原并传递给 dispatch
  assert.ok(receivedCalls.every(item => item.origin === harness.httpBase))
})

test('安全围栏：拒绝未认证连接、拒绝跨站 Origin、会话中途失效立即阻断，放行桌面端来源', async t => {
  const authState = { rejection: 401 }
  let dispatched = 0
  const harness = await startWsTestHarness(t, {
    authState,
    dispatch: async (_method, args, meta) => {
      dispatched++
      return { okEcho: args.v, origin: meta?.origin }
    },
  })

  // 1. 未认证 -> 握手返回 401
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(harness.wsUrl, { headers: { Origin: harness.httpBase } })
    ws.once('unexpected-response', (_req, res) => {
      assert.equal(res.statusCode, 401)
      res.resume()
      resolve()
    })
    ws.once('open', () => reject(new Error('未认证连接不应握手成功')))
  })
  assert.equal(dispatched, 0)

  // 2. 认证通过但跨站 Origin -> 握手返回 403
  authState.rejection = undefined
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(harness.wsUrl, { headers: { Origin: 'https://attacker.example' } })
    ws.once('unexpected-response', (_req, res) => {
      assert.equal(res.statusCode, 403)
      res.resume()
      resolve()
    })
    ws.once('open', () => reject(new Error('跨站 Origin 不应握手成功')))
  })
  assert.equal(dispatched, 0)

  // 3. 桌面端 Origin (dsh-app://app) 合法通过并映射为本 Host HTTP 权威源，中途失效后立即以 1008 拒绝
  const desktopClient = createTavernWsRpcClient({
    openSocket: () => wrapNodeWsAsBrowserSocket(harness.wsUrl, { Origin: 'dsh-app://app' }),
  }).start()
  t.after(() => desktopClient.dispose())

  const okRes = await desktopClient.call('getSettings', JSON.stringify({ v: 7 }), {
    fallback: () => { throw new Error('不应回退') },
  })
  assert.equal(okRes.ok, true)
  assert.equal(okRes.okEcho, 7)
  assert.equal(okRes.origin, harness.httpBase)

  // 模拟运行中途登录态失效：后续调用不得执行 dispatch，连接关闭且只读请求自动走 fallback
  authState.rejection = 401
  let fallbackTriggered = false
  const fallbackRes = await desktopClient.call('getSettings', JSON.stringify({ v: 8 }), {
    fallback: async () => {
      fallbackTriggered = true
      return { ok: true, fromFallback: true }
    },
  })
  assert.equal(fallbackTriggered, true)
  assert.equal(fallbackRes.fromFallback, true)
  assert.equal(dispatched, 1, '凭证失效后的请求绝不进入 dispatch')
})

test('RFC 6455 分片帧重组与控制帧穿插：跨分片 UTF-8 中文不乱码且正确响应 Ping/Pong', async t => {
  const harness = await startWsTestHarness(t, {
    dispatch: async (_method, args) => ({ text: args.greeting }),
  })

  // 使用原生 TCP 客户端手工构造跨多字节中文边界的 RFC 6455 分片掩码帧 + 中间插入 Ping 控制帧
  const net = await import('node:net')
  const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d])
  function makeMaskedClientFrame(fin, opcode, rawPayload) {
    const body = Buffer.from(rawPayload)
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3]
    const head = Buffer.from([(fin ? 0x80 : 0x00) | opcode, 0x80 | body.length])
    return Buffer.concat([head, mask, body])
  }

  const fullMessage = Buffer.from('Q\t99\tgetEcho\n{"greeting":"你好，命运之骰！🎲"}', 'utf8')
  // 故意切在一个中文字符的 3 字节 UTF-8 中间
  const part1 = fullMessage.subarray(0, 28)
  const part2 = fullMessage.subarray(28, 36)
  const part3 = fullMessage.subarray(36)

  const replyPromise = new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: harness.port }, () => {
      const key = Buffer.alloc(16, 7).toString('base64')
      sock.write(
        `GET ${TAVERN_WS_RPC_PATH} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${harness.port}\r\n` +
        `Origin: ${harness.httpBase}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      )
    })
    let upgraded = false
    let buf = Buffer.alloc(0)
    let gotPong = false

    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk])
      if (!upgraded) {
        const headerEnd = buf.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        const statusLine = buf.subarray(0, headerEnd).toString('utf8').split('\r\n')[0]
        assert.match(statusLine, /101 Switching Protocols/)
        buf = buf.subarray(headerEnd + 4)
        upgraded = true
        // 发送分片1 (FIN=0, TEXT) -> 插入 Ping 控制帧 -> 发送分片2 (FIN=0, CONT) -> 发送分片3 (FIN=1, CONT)
        sock.write(makeMaskedClientFrame(false, 0x01, part1))
        sock.write(makeMaskedClientFrame(true, 0x09, Buffer.from('hb')))
        sock.write(makeMaskedClientFrame(false, 0x00, part2))
        sock.write(makeMaskedClientFrame(true, 0x00, part3))
      }
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f
        let len = buf[1] & 0x7f
        let offset = 2
        if (len === 126) {
          if (buf.length < 4) return
          len = buf.readUInt16BE(2)
          offset = 4
        }
        if (buf.length < offset + len) return
        const payload = buf.subarray(offset, offset + len)
        buf = buf.subarray(offset + len)
        if (opcode === 0x0a) {
          assert.equal(payload.toString('utf8'), 'hb')
          gotPong = true
        } else if (opcode === 0x01) {
          const text = payload.toString('utf8')
          sock.end(encodeWsFrame(0x08, Buffer.alloc(0)))
          resolve({ gotPong, text })
          return
        }
      }
    })
    sock.on('error', reject)
  })

  const { gotPong, text } = await replyPromise
  assert.equal(gotPong, true, '分片传输期间插入的 Ping 控制帧必须立即收到 Pong')
  assert.ok(text.startsWith('R\t99\n'))
  const parsed = JSON.parse(text.slice(text.indexOf('\n') + 1))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.text, '你好，命运之骰！🎲')
})

test('取消与断线恢复语义：AbortSignal 立即取消；中途断线时只读请求自动回退 HTTP，写请求绝不重复重放', async t => {
  const slowHold = deferred()
  let activeServerSocket = null
  const executed = []

  const harness = await startWsTestHarness(t, {
    dispatch: async (method, args) => {
      executed.push({ method, args })
      if (method === 'getSlowSession' || method === 'appendPlayerInput') {
        await slowHold.promise
      }
      return { done: method }
    },
  })

  harness.port // keep ref
  const sockets = []
  const wsClient = createTavernWsRpcClient({
    backoffDelays: [50],
    openSocket: () => {
      const s = wrapNodeWsAsBrowserSocket(harness.wsUrl, { Origin: harness.httpBase })
      sockets.push(s)
      activeServerSocket = s
      return s
    },
  }).start()
  t.after(() => {
    slowHold.resolve()
    wsClient.dispose()
  })

  // 1. AbortSignal 取消挂起请求
  const aborter = new AbortController()
  const slowCall = wsClient.call('getSlowSession', '{"sessionId":"s-cancel"}', {
    signal: aborter.signal,
    fallback: () => { throw new Error('主动取消不应回退 HTTP') },
  })
  await new Promise(r => setTimeout(r, 25))
  aborter.abort()
  await assert.rejects(slowCall, { name: 'AbortError' })

  // 2. 已发出的只读请求 (getSlowSession) 与写请求 (appendPlayerInput) 遇到中途断线
  assert.equal(isIdempotentTavernRpc('getSlowSession'), true)
  assert.equal(isIdempotentTavernRpc('appendPlayerInput'), false)

  let readFallbackCount = 0
  let writeFallbackCount = 0
  const inflightRead = wsClient.call('getSlowSession', '{"sessionId":"s-drop"}', {
    fallback: async () => {
      readFallbackCount++
      return { ok: true, recoveredViaHttp: true }
    },
  })
  const inflightWrite = wsClient.call('appendPlayerInput', '{"sessionId":"s-drop","text":"hello"}', {
    fallback: async () => {
      writeFallbackCount++
      return { ok: true }
    },
  })

  await new Promise(r => setTimeout(r, 25))
  // 模拟手机切后台或网络闪断强行掐断底层 socket
  activeServerSocket.terminate()

  const recovered = await inflightRead
  assert.equal(recovered.recoveredViaHttp, true)
  assert.equal(readFallbackCount, 1, '只读幂等请求中途断线后自动无感回退 HTTP')

  await assert.rejects(inflightWrite, err => {
    assert.equal(err.retryable, true)
    return true
  })
  assert.equal(writeFallbackCount, 0, '已发出的写请求断线后绝不能静默二次提交')

  // 3. 等待 60ms 自动重连完成后，新请求重新走回 WebSocket
  await new Promise(r => setTimeout(r, 90))
  const afterReconnect = await wsClient.call('getCardOpenings', '{}', {
    fallback: () => { throw new Error('重连后应重新走 WebSocket') },
  })
  assert.equal(afterReconnect.ok, true)
  assert.equal(afterReconnect.done, 'getCardOpenings')
  assert.ok(sockets.length >= 2)
})

for (const file of ['../tavern-plugin/src/client/main.js', '../tavern-plugin/lib/client.js']) {
  test(`${file}: rpc() 将常规请求与大体积快照路由到独立 WebSocket，仅保留同源租约投影与 keepalive 走 HTTP`, async t => {
    const harness = await startWsTestHarness(t, {
      dispatch: async (method, args) => ({ method, echoedSession: args.sessionId || null }),
    })
    const wsClient = createTavernWsRpcClient({
      openSocket: () => wrapNodeWsAsBrowserSocket(harness.wsUrl, { Origin: harness.httpBase }),
    }).start()
    t.after(() => wsClient.dispose())

    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    const start = source.indexOf('function rpc(method, args, sessionId, requestOptions)')
    const end = source.indexOf('function rpcWithTimeout', start)
    const httpUrls = []
    const muxCalls = []
    const perfTraces = []

    const sandbox = {
      window: { crypto: globalThis.crypto, setTimeout, clearTimeout },
      TextEncoder,
      Date,
      performance,
      Promise,
      JSON,
      Error,
      Symbol,
      Uint8Array,
      Array,
      Object,
      Number,
      Math,
      clipExportTransport: null,
      roundLoadCounts: new Map(),
      roundLoadTrace: { mark() {} },
      rpcFetchPriority,
      presentationRequest: createPresentationQueue(),
      beginSessionViewRead: () => null,
      historyFromSessions: new Map(),
      tavernPlayEvents: { emit() {} },
      tavernSessionSignals: {
        control: async (method, args) => {
          muxCalls.push(method)
          return { ok: true, method, channel: 'mux', echoedSession: args.sessionId }
        },
      },
      tavernWsRpc: wsClient,
      performanceReportAt: Date.now(),
      pagePerformanceStarted: Date.now(),
      pagePerformance: { slowRpcCount: 0, slowRpcMaxMs: 0 },
      performanceActiveRequests: 0,
      performanceRequests: perfTraces,
      tavernRuntimeGenerationMonitor: { observe() {} },
      readTavernJsonResponse: response => response.json(),
      fetch: async (url, req) => {
        httpUrls.push({ url, keepalive: Boolean(req?.keepalive) })
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ ok: true, channel: 'http', url }),
        }
      },
    }

    const rpc = vm.runInNewContext(source.slice(start, end) + ';rpc', sandbox)

    // 常规会话读取、大体积正文读取、插件调用、非只读舞台请求全部走独立 WebSocket（0 HTTP）
    const [rSession, rTranscript, rPlugin, rStageMut] = await Promise.all([
      rpc('getSession', {}, 'sess-1'),
      rpc('getStoryTranscript', { from: 1, to: 50 }, 'sess-1'),
      rpc('callPluginHandler', { name: 'fate-dice:read-turns', args: { turns: [1, 2, 3] } }),
      rpc('getStageDirection', { turn: 5 }, 'sess-1'),
    ])
    assert.equal(rSession.method, 'getSession')
    assert.equal(rTranscript.method, 'getStoryTranscript')
    assert.equal(rPlugin.method, 'callPluginHandler')
    assert.equal(rStageMut.method, 'getStageDirection')
    assert.equal(httpUrls.length, 0, '常规 RPC 与大体积快照均不占用 HTTP 连接池')
    assert.equal(perfTraces[0]?.transport, 'ws')
    assert.ok(perfTraces[0]?.bodyChars > 0)

    // 轻量控制读取继续走 mux
    const rMux = await rpc('syncSession', {}, 'sess-1')
    assert.equal(rMux.channel, 'mux')
    assert.deepEqual(muxCalls, ['syncSession'])

    // 同源媒体租约投影与页面卸载 keepalive 保存继续走 HTTP
    await rpc('getAssetPackPresentation', { turn: 1 }, 'sess-1')
    await rpc('saveComposerDraft', { text: 'draft' }, 'sess-1', { keepalive: true })
    assert.equal(httpUrls.length, 2)
    assert.ok(httpUrls[0].url.endsWith('/getAssetPackPresentation'))
    assert.equal(httpUrls[1].keepalive, true)
  })
}
