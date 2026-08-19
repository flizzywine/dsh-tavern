const PROVIDER = 'dsh-tavern-preview'
const MODEL = 'fixed-preview'
const NOTICE = '没有模型配置，无法回复'

const adapter = {
  providerInfo(provider) {
    return { id: provider, name: 'DSH Tavern 预览模型' }
  },
  providerRetryPolicy() {
    return undefined
  },
  listModels(provider) {
    return Promise.resolve([{ provider, id: MODEL, name: '固定预览回复', inputModalities: ['text'] }])
  },
  resolveModel(provider, model) {
    return Promise.resolve({
      provider,
      id: model,
      name: '固定预览回复',
      inputModalities: ['text'],
      context: { contextWindow: 128000 },
      defaultMaxTokens: 64,
    })
  },
  async *stream() {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: NOTICE }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: NOTICE } }
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

export async function apply(ctx) {
  if (process.env.VERCEL) {
    ctx.provide('hmr', {
      registerConfig: async () => async () => {},
    })

    const webServer = ctx.get('webServer')
    const apiProxy = ctx.get('apiProxy')
    if (webServer === undefined || apiProxy === undefined) {
      throw new Error('dsh-tavern-preview: Vercel 预览缺少 webServer 或 apiProxy 服务')
    }
    ctx.effect(() => webServer.tapIndex((html) => html.replace(
      '<head>',
      `<head><script>${sseWebSocketPolyfill}</script>`,
    )), 'dsh-tavern-preview: SSE browser transport')

    const fetchHandler = toFetchHandler(apiProxy)
    for (const eventPath of ['/api/events.mux', '/api/events.host']) {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: eventPath,
        handler: async (req, res) => {
          const controller = new AbortController()
          res.once('close', () => controller.abort())
          const request = new Request(new URL(req.url || eventPath, 'http://preview.local'), {
            method: 'GET',
            headers: req.headers,
            signal: controller.signal,
          })
          const response = await fetchHandler.fetch(request)
          res.writeHead(response.status, Object.fromEntries(response.headers))
          res.flushHeaders()
          if (response.body !== null) {
            for await (const chunk of response.body) res.write(Buffer.from(chunk))
          }
          res.end()
        },
      }), `dsh-tavern-preview: SSE ${eventPath}`)
    }
  }
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('dsh-tavern-preview: 缺少 llm 服务')
  ctx.effect(() => llm.registerAdapter([PROVIDER], adapter), 'dsh-tavern-preview: mock model')
  const workspaceRegistry = ctx.get('workspaceRegistry')
  const workspacePath = process.env.DSH_TAVERN_PREVIEW_WORKSPACE
  if (workspaceRegistry !== undefined && typeof workspacePath === 'string' && workspacePath !== '') {
    await workspaceRegistry.create(workspacePath, 'DSH Tavern 公开预览')
  }
}
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { sseWebSocketPolyfill } from './sse-websocket-polyfill.js'
