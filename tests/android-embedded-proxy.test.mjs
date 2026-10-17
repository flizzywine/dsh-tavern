import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import test from 'node:test'
import { createEmbeddedProxy } from '../android/dsh-tavern-entry/embedded-proxy.mjs'

test('embedded proxy authenticates HTTP/WS, refreshes sessions, and never replays writes', async t => {
  let version = 1, writes = 0
  const upstream = http.createServer((req,res) => {
    if (req.url === '/login') { res.writeHead(303, { location: '/', 'set-cookie': `auth=${version}; HttpOnly` }); res.end(); return }
    if (req.method === 'POST') writes++
    if (req.headers.cookie !== `auth=${version}`) { res.writeHead(401); res.end(); return }
    assert.equal(req.headers.origin, `http://127.0.0.1:${upstream.address().port}`)
    res.end('ready')
  })
  upstream.on('upgrade', (req,socket) => {
    if (req.headers.cookie !== `auth=${version}`) {socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');return}
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
  })
  await new Promise(resolve => upstream.listen(0,'127.0.0.1',resolve))
  const proxy = createEmbeddedProxy({ accessUrl: async () => `http://127.0.0.1:${upstream.address().port}/login` })
  t.after(() => { proxy.close(); upstream.closeAllConnections(); upstream.close() })
  const link = await proxy.url(), origin = new URL(link).origin
  assert.equal((await fetch(origin)).status,403)
  const login = await fetch(link,{redirect:'manual'})
  assert.equal(login.status,303)
  const cookie = login.headers.getSetCookie()[0].split(';')[0]
  const headers = { cookie }
  assert.equal(await (await fetch(origin,{headers})).text(),'ready')
  assert.equal((await fetch(origin,{headers:{...headers,origin:'https://untrusted.example'}})).status,403)
  version++
  assert.equal(await (await fetch(origin,{headers})).text(),'ready')
  version++
  assert.equal((await fetch(origin,{method:'POST',headers,body:'do once'})).status,401)
  assert.equal(writes,1)
  async function upgrade(cookieHeader) {
    return new Promise((resolve,reject) => {
      const s=net.connect(new URL(origin).port,'127.0.0.1',()=>s.write(`GET /ws HTTP/1.1\r\nHost: ${new URL(origin).host}\r\nOrigin: ${origin}\r\nCookie: ${cookieHeader}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`))
      s.setTimeout(3000,()=>{s.destroy();reject(new Error('timeout'))})
      s.once('data',data=>{s.destroy();resolve(data.toString())});s.on('error',reject)
    })
  }
  assert.match(await upgrade(''),/403/)
  assert.match(await upgrade(cookie),/101/)
})
