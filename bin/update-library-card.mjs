#!/usr/bin/env node
// Update through the running Tavern, using the same backup/rollback path as the UI.
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function connectTavern({ url, accessPin, fetchImpl = fetch }) {
  const endpoint = new URL(url)
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('服务地址需要 HTTP 或 HTTPS')
  const cookies = new Map()
  function remember(response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0], at = pair.indexOf('=')
      if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1))
    }
  }
  const cookieHeader = () => [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
  if (accessPin) {
    const login = await fetchImpl(new URL('/pocket-login', endpoint), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: accessPin }), redirect: 'manual',
    })
    remember(login)
    if (login.status !== 302 || !cookies.size) throw new Error('桌面访问密码认证失败')
    let next = new URL(login.headers.get('location'), endpoint)
    let initialized = false
    for (let count = 0; count < 8; count++) {
      if (next.origin !== endpoint.origin) throw new Error('拒绝向其他服务发送桌面凭据')
      const response = await fetchImpl(next, { headers: { cookie: cookieHeader(), accept: 'text/html' }, redirect: 'manual' })
      remember(response)
      if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
        next = new URL(response.headers.get('location'), next)
        continue
      }
      if (!response.ok) throw new Error('桌面会话初始化失败，HTTP ' + response.status)
      initialized = true
      break
    }
    if (!initialized) throw new Error('桌面会话初始化重定向过多')
  }
  async function request(route, body, binary = false) {
    const target = new URL(endpoint)
    target.pathname = '/api/dsh-tavern/' + route
    target.hash = ''
    const response = await fetchImpl(target, { method: 'POST', headers: { 'content-type': binary ? 'application/octet-stream' : 'application/json', ...(cookies.size ? { cookie: cookieHeader() } : {}) }, body: binary ? body : JSON.stringify(body), redirect: 'error' })
    if (response.status === 401 || response.status === 403) throw new Error('桌面服务认证失败，请使用当前桌面版的 Web 访问地址（通过 DSH_TAVERN_URL 环境变量传入）')
    let result
    try { result = await response.json() } catch { throw new Error('服务没有返回 JSON，HTTP ' + response.status) }
    if (!response.ok || result.ok === false) throw new Error(result.error || '更新失败，HTTP ' + response.status)
    return result
  }
  return request
}

export async function updateLibraryCard({ url, cardPath, file, password, accessPin, fetchImpl = fetch }) {
  if (!cardPath?.startsWith('cards/')) throw new Error('请指定库中原卡路径，例如 cards/人物卡.json')
  const bytes = await readFile(file), name = basename(file)
  if (!/\.(json|png|charx|dshcard)$/i.test(name)) throw new Error('支持 JSON、PNG、CHARX 和 DSHCARD')
  const request = await connectTavern({ url, accessPin, fetchImpl })
  // Verify the selected target exists before uploading anything.
  const existing = await request('getCard', { path: cardPath })
  if (!existing.card) throw new Error('库中没有这张卡')
  if (existing.replacementSupported !== true) throw new Error('当前服务尚未支持安全原位更新，请先同步并重启本体。未上传或修改任何卡片。')
  let result
  if (/\.json$/i.test(name)) {
    JSON.parse(bytes.toString('utf8'))
    result = await request('importCard', { replacePath: cardPath, payload: { kind: 'text', name, text: bytes.toString('utf8') } })
  } else {
    const upload = await request('card-upload', bytes, true)
    try { result = await request('importCardUpload', { uploadId: upload.uploadId, replacePath: cardPath, name, ...(password ? { password } : {}) }) }
    finally { await request('discardCardUpload', { uploadId: upload.uploadId }).catch(() => {}) }
  }
  if (!result.card?.updated || result.card.path !== cardPath) throw new Error('运行中的本体未确认原位更新，请先重启已同步的桌面版；检查卡库是否产生了额外副本')
  return result.card
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [cardPath, file] = process.argv.slice(2)
  if (!cardPath || !file || !process.env.DSH_TAVERN_URL) {
    console.error('用法：设置 DSH_TAVERN_URL 为当前桌面版的 Web 访问地址，再运行 node bin/update-library-card.mjs "cards/原卡.json" "新版.dshcard"。桌面访问密码通过 DSH_TAVERN_ACCESS_PIN、加密卡密码通过 DSH_CARD_PASSWORD 传入。不会启动其他服务。')
    process.exitCode = 1
  } else {
    try {
      const result = await updateLibraryCard({ url: process.env.DSH_TAVERN_URL, cardPath, file: resolve(file), password: process.env.DSH_CARD_PASSWORD, accessPin: process.env.DSH_TAVERN_ACCESS_PIN })
      console.log(JSON.stringify({ updated: true, path: result.path, name: result.name, backupPath: result.backupPath, plugins: result.plugins, notices: result.libraryNotices }, null, 2))
    } catch (error) { console.error(String(error.message).replace(/([?&]token=)[^\s&]+/g, '$1<redacted>')); process.exitCode = 1 }
  }
}
