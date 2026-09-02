import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateGrokImage } from '../src/grok.js'
import { Config, resolveProvider } from '../src/config.js'
import { describeStudio, generateFromStudio, studioProfile } from '../src/studio.js'
import { parseStudioGenerateRequest } from '../src/studio-route.js'
import { conversationRegenerateRequest } from '../src/client/conversation-regenerate.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const input = () => ({ apiKey: 'test-secret', baseURL: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0', prompt: 'A quiet mountain lake', maxBytes: 1024, signal: new AbortController().signal })
afterEach(() => vi.unstubAllGlobals())

describe('Grok native generation adapter', () => {
  it('sends exactly one xAI request with inline output and no OpenAI size parameter', async () => {
    const request = vi.fn(async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }))
    vi.stubGlobal('fetch', request)
    const result = await generateGrokImage({ ...input(), aspectRatio: '16:9', resolution: '2k' })
    expect(Buffer.from(result.data)).toEqual(png)
    expect(result.mediaType).toBe('image/png')
    expect(request).toHaveBeenCalledTimes(1)
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.x.ai/v1/images/generations')
    expect(init.redirect).toBe('error')
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-secret' })
    expect(JSON.parse(init.body as string)).toEqual({ model: input().model, prompt: input().prompt,
      n: 1, aspect_ratio: '16:9', resolution: '2k', response_format: 'b64_json' })
  })

  it('labels JPEG output correctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: Buffer.from([255, 216, 255, 224]).toString('base64') }] })))
    expect((await generateGrokImage(input())).mediaType).toBe('image/jpeg')
  })

  it('rejects unsupported parameters and secret-bearing URLs before sending', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request)
    for (const patch of [{ resolution: '4k' }, { aspectRatio: 'wrong' }, { baseURL: 'https://example.test/v1?key=secret' }, { baseURL: 'https://user:pw@example.test' }, { apiKey: '' }]) {
      await expect(generateGrokImage({ ...input(), ...patch })).rejects.toThrow()
    }
    expect(request).not.toHaveBeenCalled()
  })

  it.each([401, 403, 429, 500])('never retries HTTP %s or echoes response secrets', async status => {
    const request = vi.fn(async () => new Response('test-secret private prompt', { status }))
    vi.stubGlobal('fetch', request)
    await expect(generateGrokImage(input())).rejects.toThrow(`HTTP ${status}`)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects URL-only, malformed and oversized data without a second request', async () => {
    for (const payload of [{ data: [{ url: 'https://another.example/image' }] }, { data: [{ b64_json: 'bad!!!' }] }, { data: [{ b64_json: Buffer.alloc(1025).toString('base64') }] }, null]) {
      const request = vi.fn(async () => Response.json(payload)); vi.stubGlobal('fetch', request)
      await expect(generateGrokImage(input())).rejects.toThrow()
      expect(request).toHaveBeenCalledTimes(1)
    }
  })
})

describe('Grok plugin configuration and Studio', () => {
  it('has isolated schema, model, endpoint and credential', () => {
    expect(Config({ provider: 'grok' })).toMatchObject({ grokBaseURL: 'https://api.x.ai/v1', grokModel: input().model })
    expect(resolveProvider({ provider: 'grok', grokModel: 'custom', grokBaseURL: 'https://relay.example/v1', openaiModel: 'not-grok' }))
      .toMatchObject({ provider: 'grok', apiKeyEnv: 'XAI_API_KEY', model: 'custom', baseURL: 'https://relay.example/v1' })
    expect(studioProfile({}, 'grok', true)).toMatchObject({ supportsEditing: false, defaultQuality: '1k', defaultRatio: '1:1' })
    expect(conversationRegenerateRequest({ provider: 'grok', model: input().model, output: '16:9, 2k' }, 'new lake'))
      .toMatchObject({ ratio: '16:9', quality: '2k' })
  })

  it('passes through the Studio contract, reads the plugin Key and saves one DSH attachment', async () => {
    const request = vi.fn(async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }))
    vi.stubGlobal('fetch', request)
    const saveImage = vi.fn(async () => ({ attachmentId: 'sha256:test', mediaType: 'image/png', bytes: png.length, width: 1, height: 1 }))
    const ctx = { credentials: { resolve: vi.fn(async () => ({ value: 'test-secret' })) },
      attachments: { imageLimits: { maxImageBytes: 1024, mediaTypes: ['image/png'] }, saveImage }, logger: { warn: vi.fn() } } as unknown as Context
    const config = { provider: 'grok' as const, saveToWorkspace: false }
    const catalog = await describeStudio(ctx, config)
    expect(catalog.activeProvider).toBe('grok')
    expect(JSON.stringify(catalog)).not.toContain('test-secret')
    expect(request).not.toHaveBeenCalled()
    const req = parseStudioGenerateRequest({ mode: 'generate', provider: 'grok', model: input().model, prompt: input().prompt, ratio: '3:2', quality: '1k' })
    const result = await generateFromStudio(ctx, config, req, input().signal)
    expect(result).toMatchObject({ provider: 'grok', model: input().model, output: '3:2, 1k', attachment: { attachmentId: 'sha256:test' } })
    expect(saveImage).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
    await expect(generateFromStudio(ctx, config, { ...req, mode: 'edit' }, input().signal)).rejects.toThrow('不支持图生图')
    await expect(generateFromStudio(ctx, config, { ...req, model: 'changed' }, input().signal)).rejects.toThrow('模型配置已变化')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
