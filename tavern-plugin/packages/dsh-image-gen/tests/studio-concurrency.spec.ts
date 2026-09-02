import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../src/config.js'
import { createImageConfiguration } from '../src/configuration.js'
import { prepareStudioGeneration } from '../src/studio.js'

vi.mock('@deepseek-ai/dsh-settings', () => ({ SettingsProvider: class { installSection() {} } }))
vi.mock('../src/studio-route.js', () => ({ serveStudio: vi.fn() }))
import { serveStudio } from '../src/studio-route.js'
import { apply, STUDIO_ROUTE } from '../src/index.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const input = { provider: 'grok', mode: 'generate', model: 'grok-imagine-image-2.0', prompt: 'a lake', ratio: '1:1', quality: '1k' } as const
async function promptly<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Studio blocked configuration')), 1000) })]) }
  finally { clearTimeout(timer) }
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('the registered Studio route releases the configuration lock before image HTTP', async () => {
  let value: Config = { provider: 'grok', registerAgentTools: false, saveToWorkspace: false, grokBaseURL: 'https://api.x.ai/v1', grokModel: input.model }
  let key = 'original-key'
  let service: ReturnType<typeof createImageConfiguration>
  const register = vi.fn()
  const settings = {
    installSection(_ctx: unknown, _ns: unknown, _schema: unknown, _entry: unknown, hooks: { setSource: (source: () => Config) => void }) { hooks.setSource(() => value) },
    async update(_ns: unknown, patch: object) { value = { ...value, ...patch } },
  }
  const ctx = {
    credentials: { resolve: async () => ({ value: key }), set: async (_ref: string, next: string) => { key = next } },
    attachments: { imageLimits: { maxImageBytes: 1024 * 1024, mediaTypes: ['image/png'] }, saveImage: async () => ({ attachmentId: 'test-image' }) },
    get: () => settings, provide: (_name: string, provided: typeof service) => { service = provided },
    inject: (_names: string[], callback: (owner: unknown) => void) => callback({ settings }),
    effect: (setup: () => unknown) => setup(), webServer: { register }, logger: { warn: vi.fn() },
  } as unknown as Context
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const fetchMock = vi.fn(async () => { entered.resolve(); await release.promise; return Response.json({ data: [{ b64_json: png }] }) })
  vi.stubGlobal('fetch', fetchMock)
  apply(ctx, value)
  const route = register.mock.calls.find(([route]) => route.path === STUDIO_ROUTE)![0]
  route.handler({}, {})
  const handlers = vi.mocked(serveStudio).mock.calls[0]![2]
  const generation = handlers.generate(input, new AbortController().signal)
  try {
    await promptly(entered.promise)
    await promptly(service!.configure({ provider: 'grok', baseURL: 'https://new.example/v1', apiKey: 'new-key' }))
    expect((await promptly(service!.capture('grok'))).apiKey).toBe('new-key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://api.x.ai/v1/images/generations', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer original-key' }) }))
  } finally { release.resolve(); await generation }
})

it('prepared Studio work freezes credentials and settings, and cancellation prevents HTTP', async () => {
  const credential = { value: 'old-key' }
  const config: Config = { provider: 'grok', grokBaseURL: 'https://api.x.ai/v1', saveToWorkspace: false }
  const ctx = { credentials: { resolve: async () => credential }, attachments: { imageLimits: { maxImageBytes: 1024 * 1024, mediaTypes: ['image/png'] }, saveImage: async () => ({ attachmentId: 'test' }) } } as unknown as Context
  const fetchMock = vi.fn(async () => Response.json({ data: [{ b64_json: png }] }))
  vi.stubGlobal('fetch', fetchMock)
  const controller = new AbortController()
  const generate = await prepareStudioGeneration(ctx, config, input, controller.signal)
  config.grokBaseURL = 'https://new.example/v1'
  credential.value = 'new-key'
  await generate()
  expect(fetchMock).toHaveBeenCalledWith('https://api.x.ai/v1/images/generations', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer old-key' }) }))
  const cancelled = await prepareStudioGeneration(ctx, config, input, controller.signal)
  controller.abort()
  await expect(cancelled()).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
