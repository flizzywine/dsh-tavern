import { afterEach, describe, expect, it, vi } from 'vitest'
import { editSeedreamImage } from '../src/seedream.js'

const signal = new AbortController().signal

afterEach(() => { vi.unstubAllGlobals() })

describe('editSeedreamImage', () => {
  it('uses Ark images/generations with a data-url image array', async () => {
    const output = Buffer.from('edited').toString('base64')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: output }] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(editSeedreamImage({
      apiKey: 'ark-key', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-5-0-260128',
      prompt: 'change the background', sourceImages: [
        { data: new Uint8Array(Buffer.from('source 1')), mediaType: 'image/jpeg' },
        { data: new Uint8Array(Buffer.from('source 2')), mediaType: 'image/png' },
      ],
      size: '2K', maxBytes: 1024, signal,
    })).resolves.toEqual({ data: new Uint8Array(Buffer.from('edited')), mediaType: 'image/png' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(init.headers).toMatchObject({ authorization: 'Bearer ark-key', 'content-type': 'application/json' })
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      model: 'doubao-seedream-5-0-260128', prompt: 'change the background', size: '2K', response_format: 'b64_json',
    })
    expect(body.image).toHaveLength(2)
    expect(body.image[0]).toMatch(/^data:image\/jpeg;base64,/)
    expect(body.image[1]).toMatch(/^data:image\/png;base64,/)
    expect(body.resolution).toBeUndefined()
  })
})

it.each(['', ' \n\t'])('uses the image URL when Seedream returns blank base64 (%s)', async (b64_json) => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ b64_json, url: 'https://image.example/result' }] }))
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } }))
  vi.stubGlobal('fetch', request)
  await expect(editSeedreamImage({ apiKey: 'fixture', baseURL: 'https://ark.example/v3', model: 'seedream', prompt: 'fixture',
    sourceImages: [{ data: new Uint8Array([1]), mediaType: 'image/png' }], size: '2K', maxBytes: 1024, signal
  })).resolves.toEqual({ data: new Uint8Array([1, 2]), mediaType: 'image/png' })
  expect(request).toHaveBeenCalledTimes(2)
})
