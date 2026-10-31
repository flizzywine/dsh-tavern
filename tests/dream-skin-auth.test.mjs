// /dream-skin/api requires the host session (connection.requestRejection) after its Host/Origin fence.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import * as skin from '../tavern-plugin/packages/dsh-dream-skin/lib/index.js'

function mount(requestRejection, routePath = "/dream-skin/api") {
  let handler
  const services = { connection: { trustedHosts: [], requestRejection } }
  skin.apply({ effect: fn => fn(), get: key => services[key], webServer: { register: row => { if (row.path === routePath) handler = row.handler } } })
  return handler
}

async function call(handler, headers, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.headers = { host: '127.0.0.1:4000', 'content-type': 'application/json', ...headers }
  const res = { status: 0, body: '', writeHead(code) { this.status = code }, end(text) { this.body = text } }
  await handler(req, res)
  return { status: res.status, json: JSON.parse(res.body) }
}

test('dream-skin API: 401 without session, 403 wrong origin, works when authenticated', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-auth-'))
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    let authenticated = false
    const handler = mount(req => authenticated ? undefined : 401)
    assert.equal((await call(handler, {}, { method: 'get' })).status, 401)
    authenticated = true
    assert.equal((await call(handler, { origin: 'https://evil.test' }, { method: 'get' })).status, 403)
    assert.equal((await call(handler, { origin: 'http://127.0.0.1:4000' }, { method: 'set', patch: { accent: 'blue' } })).status, 200)
    assert.deepEqual((await call(handler, {}, { method: 'get' })).json, { ok: true, value: { accent: 'blue' } })
    assert.equal((await call(mount(undefined), {}, { method: 'get' })).status, 503)
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('CSS skins use the authenticated plugin route and keep legacy profile files', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-profile-'))
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const dir = path.join(home,'profile-data/tavern/data/interface-skins')
  fs.mkdirSync(dir,{recursive:true})
  fs.writeFileSync(path.join(dir,'index.json'),JSON.stringify({active:'0123456789ab',skins:[{id:'0123456789ab',name:'旧皮肤'}]}))
  fs.writeFileSync(path.join(dir,'0123456789ab.css'),'body {color:red}')
  try {
    const handler = mount(() => undefined)
    const old = await call(handler,{}, {method:'getActiveInterfaceSkin'})
    assert.deepEqual(old.json.value,{id:'0123456789ab',css:'body {color:red}'})
    assert.equal((await call(mount(()=>401),{}, {method:'importInterfaceSkin',args:{name:'拒绝',css:'body{}'}})).status,401)
    assert.equal((await call(handler,{origin:'https://evil.test'}, {method:'deleteInterfaceSkin',args:{id:'0123456789ab'}})).status,403)
    const imports = await Promise.all(['A','B'].map(name=>call(handler,{}, {method:'importInterfaceSkin',args:{name,css:'body {color:blue}'}})))
    for (const result of imports) assert.equal(result.status,200)
    const list = (await call(handler,{}, {method:'listInterfaceSkins'})).json.value
    assert.deepEqual(list.skins.map(row=>row.name).sort(),['A','B','旧皮肤','纸感'].sort())
    assert.equal((await call(handler,{}, {method:'selectInterfaceSkin',args:{id:'../../outside'}})).status,400)
    await call(handler,{}, {method:'selectInterfaceSkin',args:{id:'builtin:paper'}})
    assert.match((await call(handler,{}, {method:'getActiveInterfaceSkin'})).json.value.css,/@font-face/)
    // Re-mounting the plugin retains selection without loading Tavern.
    assert.equal((await call(mount(()=>undefined),{}, {method:'listInterfaceSkins'})).json.value.active,'builtin:paper')
    await call(handler,{}, {method:'deleteInterfaceSkin',args:{id:'0123456789ab'}})
    assert.equal(fs.existsSync(path.join(dir,'0123456789ab.css')),false)
  } finally {
    if(saved===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=saved
    fs.rmSync(home,{recursive:true,force:true})
  }
})

test('font catalog and file routes require the skin plugin host session',async()=>{
  const catalog=await call(mount(()=>undefined),{}, {method:'listFonts'})
  assert.equal(catalog.status,200)
  assert.ok(catalog.json.value.fonts.length>=5)
  assert.ok(catalog.json.value.fonts.every(font=>font.files.every(face=>face.url.startsWith('/dream-skin/fonts/'))))
  assert.equal((await call(mount(()=>401,'/dream-skin/fonts/'),{},{})).status,401)
  assert.equal((await call(mount(()=>undefined,'/dream-skin/fonts/'),{origin:'https://evil.test'},{})).status,403)
})
