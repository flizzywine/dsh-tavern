import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createTavernStaticResourceCache,
  normalizeCacheableResourceUrl,
  projectCachedResourceBody
} from '../tavern-plugin/lib/domain/tavern-static-resource-cache.js'

function response(body, mediaType, url) {
  const bytes = Buffer.from(body)
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: function (name) { return String(name).toLowerCase() === 'content-type' ? mediaType : (String(name).toLowerCase() === 'content-length' ? String(bytes.length) : null) } },
    arrayBuffer: async function () { return bytes }
  }
}

test('静态资源首次下载后持久复用且保持二进制内容', async function (t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-static-cache-'))
  t.after(async function () { await rm(rootDir, { recursive: true, force: true }) })
  const url = 'https://assets.example.test/cg/scene.png'
  const bytes = Buffer.from([0, 1, 2, 255, 128])
  let requests = 0
  const online = createTavernStaticResourceCache({
    rootDir,
    fetch: async function () { requests++; return response(bytes, 'image/png', url) }
  })
  const first = await online.get(url)
  assert.equal(first.cache, 'miss')
  assert.deepEqual(first.body, bytes)
  assert.equal(requests, 1)

  const offline = createTavernStaticResourceCache({ rootDir, fetch: async function () { throw new Error('不应访问网络') } })
  const second = await offline.get(url)
  assert.equal(second.cache, 'hit')
  assert.deepEqual(second.body, bytes)
})

test('缓存的 ESM、CSS 和 HTML 子资源继续改写到本地缓存入口', function () {
  const moduleBody = projectCachedResourceBody({
    url: 'https://cdn.example.test/pkg/main.js',
    mediaType: 'application/javascript',
    body: Buffer.from('import x from "/dep.js"; import("https://other.example/a.js")')
  }).toString('utf8')
  assert.match(moduleBody, /static-assets\?url=https%3A%2F%2Fcdn\.example\.test%2Fdep\.js/)
  assert.match(moduleBody, /static-assets\?url=https%3A%2F%2Fother\.example%2Fa\.js/)

  const cssBody = projectCachedResourceBody({
    url: 'https://cdn.example.test/css/all.min.css',
    mediaType: 'text/css',
    body: Buffer.from('@import url(theme/base.css); @import "../shared/tokens.css"; @font-face{src:url(../webfonts/icons.woff2)}')
  }).toString('utf8')
  assert.match(cssBody, /static-assets\?url=https%3A%2F%2Fcdn\.example\.test%2Fcss%2Ftheme%2Fbase\.css/)
  assert.match(cssBody, /static-assets\?url=https%3A%2F%2Fcdn\.example\.test%2Fshared%2Ftokens\.css/)
  assert.match(cssBody, /static-assets\?url=https%3A%2F%2Fcdn\.example\.test%2Fwebfonts%2Ficons\.woff2/)

  const htmlBody = projectCachedResourceBody({
    url: 'https://cards.example.test/ui/index.html',
    mediaType: 'text/plain',
    body: Buffer.from('<link href="/ui.css"><img src="https://img.example/cg.png"><a href="https://example.org">原链接</a>')
  }).toString('utf8')
  assert.match(htmlBody, /static-assets\?url=https%3A%2F%2Fcards\.example\.test%2Fui\.css/)
  assert.match(htmlBody, /static-assets\?url=https%3A%2F%2Fimg\.example%2Fcg\.png/)
  assert.match(htmlBody, /<a href="https:\/\/example\.org">/)
})

test('静态缓存拒绝非 HTTPS、本机和内网地址', function () {
  assert.throws(function () { normalizeCacheableResourceUrl('http://example.com/a.js') }, /HTTPS/)
  assert.throws(function () { normalizeCacheableResourceUrl('https://localhost/a.js') }, /内网/)
  assert.throws(function () { normalizeCacheableResourceUrl('https://127.0.0.1/a.js') }, /内网/)
  assert.throws(function () { normalizeCacheableResourceUrl('https://192.168.1.2/a.js') }, /内网/)
})

test('超出单文件上限或不支持的响应不会写入缓存', async function (t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-static-cache-limit-'))
  t.after(async function () { await rm(rootDir, { recursive: true, force: true }) })
  const oversized = createTavernStaticResourceCache({ rootDir, maxEntryBytes: 4, fetch: async function (url) { return response('12345', 'image/png', url) } })
  await assert.rejects(oversized.get('https://assets.example.test/large.png'), /上限/)
  const unsupported = createTavernStaticResourceCache({ rootDir, fetch: async function (url) { return response('zip', 'application/zip', url) } })
  await assert.rejects(unsupported.get('https://assets.example.test/archive.zip'), /不支持/)
})

test('下载前校验每一跳主机且只接受有限 HTTPS 重定向', async function (t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-static-cache-redirect-'))
  t.after(async function () { await rm(rootDir, { recursive: true, force: true }) })
  const verified = []
  const cache = createTavernStaticResourceCache({
    rootDir,
    verifyHostname: async function (url) { verified.push(url) },
    fetch: async function (url) {
      if (url === 'https://assets.example.test/start') return { ok: false, status: 302, headers: { get: function (name) { return String(name).toLowerCase() === 'location' ? 'https://cdn.example.test/final.png' : null } } }
      return response('image', 'image/png', url)
    }
  })
  assert.equal((await cache.get('https://assets.example.test/start')).finalUrl, 'https://cdn.example.test/final.png')
  assert.deepEqual(verified, ['https://assets.example.test/start', 'https://cdn.example.test/final.png'])
})
