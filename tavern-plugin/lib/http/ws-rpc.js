import { createHash } from 'node:crypto'
import { isSameOriginRequest, requestAuthorityOrigin } from './request-origin.js'

export const TAVERN_WS_RPC_PATH = '/api/dsh-tavern/ws'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const METHOD_PATTERN = /^[A-Za-z0-9._-]+$/
const DEFAULT_MAX_FRAME_BYTES = 82 * 1024 * 1024
const DEFAULT_HEARTBEAT_MS = 25000
const DEFAULT_IDLE_TIMEOUT_MS = 75000
const DEFAULT_MAX_CONCURRENT = 128

const STATUS_TEXT = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  426: 'Upgrade Required',
  503: 'Service Unavailable',
}

export function rejectWsUpgrade(socket, statusCode = 403) {
  if (!socket || socket.destroyed) return
  const code = STATUS_TEXT[statusCode] ? statusCode : 403
  try {
    socket.end(
      `HTTP/1.1 ${code} ${STATUS_TEXT[code]}\r\n` +
      'Connection: close\r\n' +
      'Cache-Control: no-store\r\n' +
      'Content-Length: 0\r\n\r\n'
    )
  } catch {
    socket.destroy()
  }
}

export function encodeWsFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8')
  const length = body.length
  let header
  if (length < 126) {
    header = Buffer.allocUnsafe(2)
    header[0] = 0x80 | (opcode & 0x0f)
    header[1] = length
  } else if (length < 65536) {
    header = Buffer.allocUnsafe(4)
    header[0] = 0x80 | (opcode & 0x0f)
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.allocUnsafe(10)
    header[0] = 0x80 | (opcode & 0x0f)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  return length === 0 ? header : Buffer.concat([header, body], header.length + length)
}

function unmaskInPlace(buffer, mask) {
  const m0 = mask[0]
  const m1 = mask[1]
  const m2 = mask[2]
  const m3 = mask[3]
  const len = buffer.length
  let i = 0
  const limit = len - 3
  for (; i < limit; i += 4) {
    buffer[i] ^= m0
    buffer[i + 1] ^= m1
    buffer[i + 2] ^= m2
    buffer[i + 3] ^= m3
  }
  for (; i < len; i++) {
    buffer[i] ^= mask[i & 3]
  }
  return buffer
}

function validHandshakeKey(rawKey) {
  if (typeof rawKey !== 'string') return false
  const trimmed = rawKey.trim()
  if (!trimmed || trimmed.length > 64) return false
  try {
    return Buffer.from(trimmed, 'base64').length === 16
  } catch {
    return false
  }
}

function headerHasUpgradeToken(value) {
  if (typeof value !== 'string') return false
  return value.split(',').some(part => part.trim().toLowerCase() === 'upgrade')
}

export function createTavernWsRpcServer({
  ctx,
  executeRpc,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  maxConcurrentPerClient = DEFAULT_MAX_CONCURRENT,
  now = Date.now,
} = {}) {
  const clients = new Set()
  const topicHandlers = new Map()
  let closed = false
  let heartbeatTimer = null

  function ensureHeartbeat() {
    if (heartbeatTimer || closed || heartbeatIntervalMs <= 0) return
    heartbeatTimer = setInterval(() => {
      const current = now()
      for (const client of [...clients]) {
        if (current - client.lastSeenAt > idleTimeoutMs) {
          client.terminate()
          continue
        }
        client.sendControl(0x09, Buffer.alloc(0))
      }
      if (clients.size === 0 && heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }, heartbeatIntervalMs)
    heartbeatTimer.unref?.()
  }

  function handleUpgrade(req, socket, head) {
    if (closed) {
      rejectWsUpgrade(socket, 503)
      return
    }
    if (req.method !== 'GET') {
      rejectWsUpgrade(socket, 400)
      return
    }
    const connection = ctx?.get?.('connection')
    const rejection = connection ? connection.requestRejection(req) : 503
    if (rejection) {
      rejectWsUpgrade(socket, rejection)
      return
    }
    const origin = req.headers.origin
    const fetchSite = req.headers['sec-fetch-site']
    if (!isSameOriginRequest({ host: req.headers.host, origin, fetchSite })) {
      rejectWsUpgrade(socket, 403)
      return
    }
    const upgradeHeader = String(req.headers.upgrade || '').trim().toLowerCase()
    const versionHeader = String(req.headers['sec-websocket-version'] || '').trim()
    const wsKey = req.headers['sec-websocket-key']
    if (upgradeHeader !== 'websocket' || !headerHasUpgradeToken(req.headers.connection)) {
      rejectWsUpgrade(socket, 400)
      return
    }
    if (versionHeader !== '13') {
      rejectWsUpgrade(socket, 426)
      return
    }
    if (!validHandshakeKey(wsKey)) {
      rejectWsUpgrade(socket, 400)
      return
    }

    const trustedOrigin = requestAuthorityOrigin({ host: req.headers.host, origin, fetchSite })
    const accept = createHash('sha1').update(wsKey.trim() + WS_GUID).digest('base64')
    try {
      socket.setNoDelay?.(true)
      socket.setKeepAlive?.(true, 30000)
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      )
    } catch {
      socket.destroy()
      return
    }

    const chunks = []
    let bufferedBytes = 0
    let fragmentOpcode = 0
    let fragments = []
    let fragmentedBytes = 0
    let socketClosing = false
    let activeCalls = 0
    const pendingQueue = []
    const inflightAborters = new Map()
    const cancelledIds = new Set()
    const subscriptions = new Map()

    function attachSubscription(subId, entry) {
      entry.stop?.()
      entry.stop = null
      const handler = topicHandlers.get(entry.topic)
      if (typeof handler !== 'function') return
      let active = true
      const push = payload => {
        if (!active || socketClosing || subscriptions.get(subId) !== entry) return false
        return client.sendText('E\t' + subId + '\n' + JSON.stringify(payload ?? null))
      }
      const closeSub = () => {
        if (!active) return
        active = false
        entry.stop = null
        if (subscriptions.get(subId) === entry) {
          subscriptions.delete(subId)
          client.sendText('X\t' + subId)
        }
      }
      try {
        const off = handler({ args: entry.args, trustedOrigin, push, close: closeSub })
        if (!active) {
          if (typeof off === 'function') { try { off() } catch {} }
          return
        }
        entry.stop = () => {
          if (!active) return
          active = false
          if (typeof off === 'function') { try { off() } catch {} }
        }
      } catch {
        closeSub()
      }
    }

    const client = {
      lastSeenAt: now(),
      activateTopic(topic) {
        if (socketClosing) return
        for (const [subId, entry] of subscriptions) {
          if (entry.topic === topic && !entry.stop) attachSubscription(subId, entry)
        }
      },
      closeTopic(topic) {
        if (socketClosing) return
        for (const [subId, entry] of [...subscriptions]) {
          if (entry.topic !== topic) continue
          subscriptions.delete(subId)
          entry.stop?.()
          entry.stop = null
          client.sendText('X\t' + subId)
        }
      },
      sendControl(opcode, payload) {
        if (socketClosing || socket.destroyed || !socket.writable) return false
        try {
          socket.write(encodeWsFrame(opcode, payload))
          return true
        } catch {
          terminate()
          return false
        }
      },
      sendText(text) {
        if (socketClosing || socket.destroyed || !socket.writable) return false
        try {
          socket.write(encodeWsFrame(0x01, Buffer.from(text, 'utf8')))
          return true
        } catch {
          terminate()
          return false
        }
      },
      closeWithCode(code = 1000, reason = '') {
        if (socketClosing) return
        socketClosing = true
        const reasonBytes = reason ? Buffer.from(String(reason).slice(0, 80), 'utf8') : Buffer.alloc(0)
        const payload = Buffer.allocUnsafe(2 + reasonBytes.length)
        payload.writeUInt16BE(code, 0)
        if (reasonBytes.length) reasonBytes.copy(payload, 2)
        try {
          socket.end(encodeWsFrame(0x08, payload))
        } catch {
          socket.destroy()
        }
        cleanup()
      },
      terminate,
    }

    function cleanup() {
      socketClosing = true
      clients.delete(client)
      pendingQueue.length = 0
      cancelledIds.clear()
      for (const aborter of inflightAborters.values()) {
        try { aborter.abort() } catch {}
      }
      inflightAborters.clear()
      for (const sub of subscriptions.values()) {
        sub.stop?.()
      }
      subscriptions.clear()
      chunks.length = 0
      bufferedBytes = 0
      fragments = []
      fragmentedBytes = 0
    }

    function terminate() {
      cleanup()
      if (!socket.destroyed) socket.destroy()
    }

    function peekHeader(count) {
      if (bufferedBytes < count) return null
      if (chunks[0].length >= count) return chunks[0].subarray(0, count)
      const out = Buffer.allocUnsafe(count)
      let copied = 0
      for (let i = 0; i < chunks.length && copied < count; i++) {
        const piece = chunks[i]
        const take = Math.min(piece.length, count - copied)
        piece.copy(out, copied, 0, take)
        copied += take
      }
      return out
    }

    function consumeBytes(count) {
      if (count === 0) return Buffer.alloc(0)
      if (chunks[0].length === count) {
        bufferedBytes -= count
        return chunks.shift()
      }
      if (chunks[0].length > count) {
        const slice = chunks[0].subarray(0, count)
        chunks[0] = chunks[0].subarray(count)
        bufferedBytes -= count
        return Buffer.from(slice)
      }
      const out = Buffer.allocUnsafe(count)
      let copied = 0
      while (copied < count && chunks.length > 0) {
        const front = chunks[0]
        const need = count - copied
        if (front.length <= need) {
          front.copy(out, copied)
          copied += front.length
          chunks.shift()
        } else {
          front.copy(out, copied, 0, need)
          chunks[0] = front.subarray(need)
          copied += need
        }
      }
      bufferedBytes -= count
      return out
    }

    function drainQueue() {
      while (!socketClosing && activeCalls < maxConcurrentPerClient && pendingQueue.length > 0) {
        const task = pendingQueue.shift()
        if (cancelledIds.has(task.reqId)) {
          cancelledIds.delete(task.reqId)
          continue
        }
        runTask(task)
      }
    }

    function runTask({ reqId, method, rawBody }) {
      const liveConn = ctx?.get?.('connection')
      const liveRejection = liveConn ? liveConn.requestRejection(req) : 503
      if (liveRejection) {
        client.closeWithCode(1008, 'unauthorized')
        return
      }
      activeCalls++
      const aborter = new AbortController()
      inflightAborters.set(reqId, aborter)
      const byteLength = Buffer.byteLength(rawBody, 'utf8')
      Promise.resolve()
        .then(() => executeRpc({
          method,
          rawBody,
          byteLength,
          trustedOrigin,
          signal: aborter.signal,
        }))
        .then(serializedReply => {
          if (socketClosing || cancelledIds.has(reqId)) return
          client.sendText('R\t' + reqId + '\n' + serializedReply)
        })
        .catch(err => {
          if (socketClosing || cancelledIds.has(reqId)) return
          const fallback = JSON.stringify({
            ok: false,
            error: String(err?.message || err || '请求执行失败'),
            ...(typeof err?.code === 'string' && err.code ? { errorCode: err.code } : {}),
          })
          client.sendText('R\t' + reqId + '\n' + fallback)
        })
        .finally(() => {
          activeCalls--
          inflightAborters.delete(reqId)
          cancelledIds.delete(reqId)
          drainQueue()
        })
    }

    function onTextMessage(text) {
      if (text === 'P') {
        client.sendText('O')
        return
      }
      if (text === 'O') return

      if (text.startsWith('C\t')) {
        const reqId = text.slice(2).trim()
        if (!reqId || reqId.length > 48) return
        const aborter = inflightAborters.get(reqId)
        if (aborter) {
          cancelledIds.add(reqId)
          try { aborter.abort() } catch {}
          return
        }
        const queuedIndex = pendingQueue.findIndex(item => item.reqId === reqId)
        if (queuedIndex >= 0) pendingQueue.splice(queuedIndex, 1)
        else {
          if (cancelledIds.size >= 512) cancelledIds.clear()
          cancelledIds.add(reqId)
        }
        return
      }

      if (text.startsWith('U\t')) {
        const subId = text.slice(2).trim()
        if (!subId || subId.length > 48) return
        const existing = subscriptions.get(subId)
        if (existing) {
          subscriptions.delete(subId)
          existing.stop?.()
        }
        return
      }

      if (text.startsWith('S\t')) {
        const liveConn = ctx?.get?.('connection')
        const liveRejection = liveConn ? liveConn.requestRejection(req) : 503
        if (liveRejection) {
          client.closeWithCode(1008, 'unauthorized')
          return
        }
        const newlineAt = text.indexOf('\n')
        const headerLine = newlineAt >= 0 ? text.slice(2, newlineAt) : text.slice(2)
        const rawArgs = newlineAt >= 0 ? text.slice(newlineAt + 1) : '{}'
        const tabAt = headerLine.indexOf('\t')
        if (tabAt <= 0) {
          client.closeWithCode(1002, 'malformed subscribe header')
          return
        }
        const subId = headerLine.slice(0, tabAt)
        const topic = headerLine.slice(tabAt + 1)
        if (!subId || subId.length > 48 || !METHOD_PATTERN.test(topic)) {
          if (subId && subId.length <= 48) client.sendText('X\t' + subId)
          return
        }
        if (subscriptions.size >= 64 && !subscriptions.has(subId)) {
          client.sendText('X\t' + subId)
          return
        }
        let args = {}
        try {
          args = rawArgs.trim() === '' ? {} : JSON.parse(rawArgs)
        } catch {
          client.sendText('X\t' + subId)
          return
        }
        const previous = subscriptions.get(subId)
        if (previous) {
          subscriptions.delete(subId)
          previous.stop?.()
        }
        const entry = { topic, args, stop: null }
        subscriptions.set(subId, entry)
        attachSubscription(subId, entry)
        return
      }

      if (!text.startsWith('Q\t')) {
        client.closeWithCode(1003, 'unsupported message')
        return
      }
      const newlineAt = text.indexOf('\n')
      const headerLine = newlineAt >= 0 ? text.slice(2, newlineAt) : text.slice(2)
      const rawBody = newlineAt >= 0 ? text.slice(newlineAt + 1) : '{}'
      const tabAt = headerLine.indexOf('\t')
      if (tabAt <= 0) {
        client.closeWithCode(1002, 'malformed request header')
        return
      }
      const reqId = headerLine.slice(0, tabAt)
      const method = headerLine.slice(tabAt + 1)
      if (!reqId || reqId.length > 48 || !METHOD_PATTERN.test(method)) {
        const errJson = JSON.stringify({ ok: false, error: '非法的 RPC 方法名', errorCode: 'INVALID_METHOD' })
        if (reqId && reqId.length <= 48) client.sendText('R\t' + reqId + '\n' + errJson)
        return
      }
      if (cancelledIds.delete(reqId)) return
      const task = { reqId, method, rawBody }
      if (activeCalls < maxConcurrentPerClient) runTask(task)
      else pendingQueue.push(task)
    }

    function parseFrames() {
      while (!socketClosing && bufferedBytes >= 2) {
        const head2 = peekHeader(2)
        const b0 = head2[0]
        const b1 = head2[1]
        const fin = (b0 & 0x80) !== 0
        const rsv = b0 & 0x70
        const opcode = b0 & 0x0f
        const masked = (b1 & 0x80) !== 0
        const len7 = b1 & 0x7f

        if (rsv !== 0 || !masked) {
          client.closeWithCode(1002, 'protocol error')
          return
        }
        const isControl = (opcode & 0x08) !== 0
        if (isControl && (!fin || len7 > 125)) {
          client.closeWithCode(1002, 'invalid control frame')
          return
        }

        let headerBytes = 2
        let payloadLen = len7
        if (len7 === 126) {
          headerBytes = 4
          if (bufferedBytes < 4) return
          payloadLen = peekHeader(4).readUInt16BE(2)
        } else if (len7 === 127) {
          headerBytes = 10
          if (bufferedBytes < 10) return
          const bigLen = peekHeader(10).readBigUInt64BE(2)
          if (bigLen > BigInt(maxFrameBytes)) {
            client.closeWithCode(1009, 'frame too large')
            return
          }
          payloadLen = Number(bigLen)
        }

        if (payloadLen > maxFrameBytes || (!isControl && fragmentedBytes + payloadLen > maxFrameBytes)) {
          client.closeWithCode(1009, 'message too large')
          return
        }

        const totalFrameBytes = headerBytes + 4 + payloadLen
        if (bufferedBytes < totalFrameBytes) return

        const frame = consumeBytes(totalFrameBytes)
        const mask = frame.subarray(headerBytes, headerBytes + 4)
        const payload = unmaskInPlace(frame.subarray(headerBytes + 4), mask)

        if (isControl) {
          if (opcode === 0x08) {
            let closeCode = 1000
            if (payload.length === 1) closeCode = 1002
            else if (payload.length >= 2) {
              const peerCode = payload.readUInt16BE(0)
              const validPeerCode = (peerCode >= 1000 && peerCode <= 1003)
                || (peerCode >= 1007 && peerCode <= 1011)
                || (peerCode >= 3000 && peerCode <= 4999)
              closeCode = validPeerCode ? peerCode : 1002
            }
            client.closeWithCode(closeCode)
            return
          }
          if (opcode === 0x09) {
            client.sendControl(0x0a, payload)
          }
          continue
        }

        if (opcode === 0x01 || opcode === 0x02) {
          if (fragmentOpcode !== 0) {
            client.closeWithCode(1002, 'unexpected new data frame during fragmentation')
            return
          }
          if (opcode === 0x02) {
            client.closeWithCode(1003, 'binary frames unsupported')
            return
          }
          if (fin) {
            onTextMessage(payload.toString('utf8'))
          } else {
            fragmentOpcode = opcode
            fragments.push(Buffer.from(payload))
            fragmentedBytes = payload.length
          }
        } else if (opcode === 0x00) {
          if (fragmentOpcode === 0) {
            client.closeWithCode(1002, 'unexpected continuation frame')
            return
          }
          fragments.push(Buffer.from(payload))
          fragmentedBytes += payload.length
          if (fin) {
            const full = Buffer.concat(fragments, fragmentedBytes)
            fragmentOpcode = 0
            fragments = []
            fragmentedBytes = 0
            onTextMessage(full.toString('utf8'))
          }
        } else {
          client.closeWithCode(1002, 'unknown opcode')
          return
        }
      }
    }

    function onChunk(chunk) {
      if (socketClosing || !chunk || chunk.length === 0) return
      client.lastSeenAt = now()
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (bufferedBytes + buf.length > maxFrameBytes + 65536) {
        client.closeWithCode(1009, 'buffer limit exceeded')
        return
      }
      chunks.push(buf)
      bufferedBytes += buf.length
      parseFrames()
    }

    clients.add(client)
    ensureHeartbeat()
    socket.on('data', onChunk)
    socket.once('end', () => client.closeWithCode(1000))
    socket.once('close', cleanup)
    socket.on('error', terminate)

    if (head && head.length > 0) {
      onChunk(head)
    }
  }

  function registerTopic(topic, handler) {
    if (typeof topic !== 'string' || !METHOD_PATTERN.test(topic) || typeof handler !== 'function') {
      throw new Error('Invalid WebSocket topic registration')
    }
    topicHandlers.set(topic, handler)
    if (!closed) {
      for (const client of clients) client.activateTopic(topic)
    }
    return () => {
      if (topicHandlers.get(topic) !== handler) return
      topicHandlers.delete(topic)
      for (const client of clients) client.closeTopic(topic)
    }
  }

  function close() {
    closed = true
    topicHandlers.clear()
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    for (const client of [...clients]) {
      client.closeWithCode(1001, 'server shutting down')
    }
    clients.clear()
  }

  return {
    handleUpgrade,
    registerTopic,
    close,
    get clientCount() {
      return clients.size
    },
  }
}
