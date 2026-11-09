import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createTavernStaticResourceCache, projectCachedResourceBody } from '../tavern-plugin/lib/domain/tavern-static-resource-cache.js'

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
    body: Buffer.from('<link href="/ui.css"><img src="https://img.example/cg.png"><a href="https://example.org">原链接</a><iframe src="https://app.example/hud/"></iframe>')
  }).toString('utf8')
  assert.match(htmlBody, /static-assets\?url=https%3A%2F%2Fcards\.example\.test%2Fui\.css/)
  assert.match(htmlBody, /static-assets\?url=https%3A%2F%2Fimg\.example%2Fcg\.png/)
  assert.match(htmlBody, /<a href="https:\/\/example\.org">/)
  assert.match(htmlBody, /<iframe src="https:\/\/app\.example\/hud\/">/)
})

test('默认下载链路不预先拒绝 DNS 或私网地址，重定向后仍可加载', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-private-cache-'))
  t.after(() => rm(rootDir, {recursive:true, force:true}))
  const calls = [], originalFetch = globalThis.fetch
  let cache
  try {
    globalThis.fetch = async url => {
      calls.push(url)
      if (url === 'https://cdn.invalid/module.js') return {status:302,headers:{get:()=> 'https://[fdfe:dcba:9876::52]/module.js'}}
      return response('export const ready=true;', 'application/javascript', url)
    }
    // Use the production default fetch path: no test-only DNS verifier bypass.
    cache = createTavernStaticResourceCache({rootDir})
  } finally { globalThis.fetch = originalFetch }
  const result = await cache.get('https://cdn.invalid/module.js')
  assert.match(result.body.toString(), /ready=true/)
  assert.deepEqual(calls, ['https://cdn.invalid/module.js', 'https://[fdfe:dcba:9876::52]/module.js'])
  await cache.get('https://192.168.1.2/module.js')
  assert.equal(calls.at(-1), 'https://192.168.1.2/module.js')
})
