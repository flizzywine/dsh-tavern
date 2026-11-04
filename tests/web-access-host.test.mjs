import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createBackgroundNativeRuntime } from './fixtures/background-native-runtime.mjs'
import { createNetworkToolPolicy, installNetworkToolPolicy } from '../tavern-plugin/lib/domain/network-tools.js'

test('原生 DSH 网页读取在工作台直接可用；游玩仍遵守本局联网开关', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  let host, mode = 'card', enabled = false, requests = 0
  const searches = []
  const native = await import(new URL('../../dsh-tool-web/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const runtime = await createBackgroundNativeRuntime(process.env.DSH_BOOT_MODULE, { setupHost(ctx) {
    host = ctx
    ctx.provide('web', {
      searchReady: () => true, fetchReady: () => true,
      async search(request) { searches.push(request); return { sources: [{ url: 'https://example.com/work', title: '原生搜索结果', snippet: '资料' }], truncated: false } },
      async fetch() { requests++; return { url: 'https://example.com/work', statusCode: 200, body: { kind: 'text', content: '原生网页正文' }, truncated: false } }
    })
    if (native.applyWebSearchTool.length >= 6) native.applyWebSearchTool(ctx, native.WEB_SEARCH_MAX_RESULTS, native.WEB_SEARCH_MAX_QUERIES, 800, native.DEFAULT_WEB_TOOL_TIMEOUT_MS, true)
    else native.applyWebSearchTool(ctx, native.WEB_SEARCH_MAX_RESULTS, native.WEB_SEARCH_MAX_QUERIES, native.DEFAULT_WEB_TOOL_TIMEOUT_MS, true)
    installNetworkToolPolicy(ctx, createNetworkToolPolicy({
      readHeader: async () => ({ mode, webSearchEnabled: enabled }), backgroundContext: () => null,
      capabilityFor: () => undefined, settings: () => ({ fetchEnabled: false })
    }))
  } })
  t.after(() => runtime.dispose())
  native.applyWebFetchTool(host, native.DEFAULT_WEB_TOOL_TIMEOUT_MS, native.DEFAULT_FETCH_MAX_OUTPUT_CHARS)
  const runTool = async (callId, name, args) => {
    const agent = host.agents.get('scene-parent'), signal = new AbortController().signal
    if (typeof host.tools.selectExecutor === 'function') {
      const toolSet = await host.tools.resolve({ agent, modelSelection: { provider: 'scene-fixture', model: 'fixture-text' }, signal })
      const batch = await host.tools.execute({ calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }], agent, toolSet, signal })
      toolSet.dispose()
      return batch.results[0].result
    }
    return host.tools.execute({ callId, name, arguments: args, agent, signal })
  }
  const call = () => runTool('test-fetch', 'web_fetch', { url: 'https://example.com/work' })
  const search = await runTool('native-search', 'web_search', { queries: ['作品资料'] })
  assert.equal(search.isError, false, JSON.stringify(search))
  assert.match(JSON.stringify(search.content), /原生搜索结果/)
  assert.equal(searches[0].query, '作品资料')
  const on = await call()
  assert.equal(on.isError, false, JSON.stringify(on))
  assert.match(JSON.stringify(on.content), /原生网页正文/)
  assert.equal(requests, 1)
  assert.equal(host.tools.get('tavern_research'), undefined)
  mode = 'story'
  assert.equal((await call()).isError, true)
  assert.equal(requests, 1)
  enabled = true
  assert.equal((await call()).isError, false)
  assert.equal(requests, 2)
})
