import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'

export const IMAGE_PLUGIN_SOURCE = new URL('../../tavern-plugin/packages/dsh-tavern-image-bundled/', import.meta.url)
export const IMAGE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==', 'base64')
export const imageJson = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

/** Real plugin routes and on-disk state, only the external services are mocked. */
export async function imagePluginFixture(t, { config = {}, definitions, files = {}, llm, tavern } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tavern-image-feature-'))
  const pluginRoot = join(root, 'plugin')
  await cp(IMAGE_PLUGIN_SOURCE, pluginRoot, { recursive: true })
  if (definitions) await writeFile(join(pluginRoot, 'definitions.json'), JSON.stringify(definitions))
  for (const [name, value] of Object.entries(files)) await writeFile(join(pluginRoot, name), JSON.stringify(value))
  const savedFetch = globalThis.fetch
  const runtimes = []
  const logs = []
  t.after(async () => {
    for (const runtime of runtimes) runtime.close()
    globalThis.fetch = savedFetch
    if (!resolve(root).startsWith(resolve(tmpdir())) || !root.includes('tavern-image-feature-')) throw new Error('unexpected fixture cleanup path')
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 20 })
  })
  const defaults = {
    imageBackend: 'atlascloud', activeImageChannel: 'atlas', plannerProvider: 'mock', plannerModel: 'planner',
    characterAutoUpdate: false,
    imageChannels: [{ id: 'atlas', provider: 'atlascloud', name: 'atlas cloud', baseUrl: 'https://atlas.example.test/api/v1', model: 'test-edit', apiKey: 'TEST_SECRET', options: { sizeMode: 'none', pollIntervalMs: 1 } }],
    ...config,
  }
  async function start(overrides = {}) {
    const routes = new Map(), disposers = []
    const ctx = {
      llm, tavern,
      attachments: { saveImage: async () => ({ attachmentId: 'test-attachment' }) },
      logger: Object.fromEntries(['info', 'warn', 'error'].map(key => [key, (...args) => logs.push(args.join(' '))])),
      webServer: { register({ path, handler }) { routes.set(path, handler); return () => routes.delete(path) } },
      inject(names, setup) { if (names.every(name => this[name])) setup(this) },
      effect(setup) { const dispose = setup(); if (typeof dispose === 'function') disposers.push(dispose); return dispose },
      on(event, callback) { if (event === 'dispose') disposers.push(callback) },
    }
    const { apply } = await import(pathToFileURL(join(pluginRoot, 'lib/index.js')).href + '?instance=' + runtimes.length)
    apply(ctx, { ...defaults, ...overrides })
    const runtime = {
      close() { for (const dispose of disposers.splice(0).reverse()) dispose() },
      async request(route, body, method = body === undefined ? 'GET' : 'POST', headers = {}) {
        if (route === 'definitions' && body?.definitions && !Object.hasOwn(body.definitions, 'revision')) {
          const state = await this.request('state')
          body = { ...body, definitions: { ...body.definitions, revision: state.body.definitions.revision } }
        }
        const url = '/plugins/dsh-tavern-image/' + route
        const handler = routes.get(url.split('?')[0])
        if (!handler) throw new Error('unregistered route ' + route)
        return new Promise((done, reject) => {
          const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
          Object.assign(request, { method, url, headers: { host: 'localhost', 'content-type': 'application/json', ...headers } })
          const response = { headersSent: false,
            writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true },
            end(value) {
              const bytes = Buffer.from(value || '')
              try { done({ status: this.status, headers: this.headers, bytes, body: /json/.test(this.headers?.['content-type'] || '') ? JSON.parse(bytes.toString()) : null }) }
              catch (error) { reject(error) }
            },
          }
          Promise.resolve(handler(request, response)).catch(reject)
        })
      },
      async terminal(id) {
        for (let i = 0; i < 300; i++) {
          const result = await this.request('jobs?id=' + id)
          if (['done', 'failed', 'uncertain', 'cancelled'].includes(result.body?.job?.state)) return result.body.job
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        throw new Error('job did not reach terminal state')
      },
    }
    runtimes.push(runtime)
    return runtime
  }
  return { start, root, pluginRoot, logs, read: async name => JSON.parse(await readFile(join(pluginRoot, name), 'utf8')) }
}
