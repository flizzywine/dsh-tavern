import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createFullPromptTemplateAssetReader, FULL_PROMPT_TEMPLATE_ASSET_PREFIX as prefix } from '../tavern-plugin/lib/domain/full-prompt-template-assets.js'

test('模板静态服务仅提供清单内的文件',async()=>{ // vendored files are not re-hashed per request
  let body=Buffer.from('export const ready = true;')
  const manifest={upstreamCommit:'d6f520d149aba146305b0b781ddd691d449c28d2',files:{'index.js':{bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')}}}
  const read=createFullPromptTemplateAssetReader({read:async url=>url.pathname.endsWith('manifest.json')?JSON.stringify(manifest):body})
  const asset=await read(prefix+'index.js')
  assert.match(asset.mediaType,/javascript/)
  assert.equal(asset.etag,'"sha256-'+manifest.files['index.js'].sha256+'"')
  assert.equal(await read(prefix+'missing.js'),undefined)
  assert.equal(await read(prefix+'../index.js'),undefined)
})

test('模板 HTTP 条件请求返回 304，不重复传输资源正文', async () => {
  const { registerTavernHttpRoutes } = await import('../tavern-plugin/lib/http/routes.js')
  let handler
  registerTavernHttpRoutes({ ctx: { get() {} }, exposeHandler: value => { handler = value } })
  async function request(etag, host = '127.0.0.1:43170') {
    const response = {}
    await handler({ method: 'GET', url: prefix + 'index.js', headers: { host, 'if-none-match': etag } }, {
      writeHead(status, headers) { response.status = status; response.headers = headers },
      end(body) { response.body = body }
    })
    return response
  }
  assert.equal((await request('"outdated"', 'untrusted.invalid')).status, 403)
  const first = await request('"outdated"')
  assert.equal(first.status, 200)
  assert.ok(first.body.length > 0)
  const cached = await request('"old", W/' + first.headers.ETag)
  assert.equal(cached.status, 304)
  assert.equal(cached.body, undefined)
  assert.equal(cached.headers.ETag, first.headers.ETag)
})
