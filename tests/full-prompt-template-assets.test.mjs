import test from 'node:test'
import assert from 'node:assert/strict'
import { FULL_PROMPT_TEMPLATE_ASSET_PREFIX as prefix } from '../tavern-plugin/lib/domain/full-prompt-template-assets.js'

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
