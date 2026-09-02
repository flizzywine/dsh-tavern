/** xAI Images adapter. A single explicit generation, never an automatic retry.
 * https://docs.x.ai/developers/model-capabilities/images/generation
 * Request inline bytes so neither temporary image URLs nor Key forwarding are needed.
 */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

export const GROK_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'] as const
export const GROK_RESOLUTIONS = ['1k', '2k'] as const

export async function generateGrokImage(input: {
  apiKey: string; baseURL: string; model: string; prompt: string
  aspectRatio?: string | undefined; resolution?: string | undefined
  maxBytes: number; signal: AbortSignal
}): Promise<{ data: Uint8Array; mediaType: ImageMediaType }> {
  const base = new URL(input.baseURL)
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('Grok API 根地址必须是无账号、查询参数或片段的 HTTP(S) 地址')
  }
  if (!input.apiKey.trim() || /[\r\n]/.test(input.apiKey)) throw new Error('请配置有效的 XAI_API_KEY')
  if (!input.model.trim() || !input.prompt.trim()) throw new Error('Grok 模型和提示词不能为空')
  const resolution = (input.resolution ?? '1k').toLowerCase()
  const aspectRatio = input.aspectRatio ?? '1:1'
  if (!(GROK_RESOLUTIONS as readonly string[]).includes(resolution)) throw new Error('Grok 分辨率仅支持 1k 或 2k')
  if (!(GROK_RATIOS as readonly string[]).includes(aspectRatio)) throw new Error('不支持的 Grok 画面比例')
  const response = await fetch(base.href.replace(/\/+$/, '') + '/images/generations', {
    method: 'POST', redirect: 'error', signal: input.signal,
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: input.model, prompt: input.prompt, n: 1,
      aspect_ratio: aspectRatio, resolution, response_format: 'b64_json' }),
  })
  // Never include provider response text: errors may echo credentials or private prompts.
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Grok 生图请求失败（HTTP ${response.status}）；未自动重试`)
  }
  const limit = Math.ceil(input.maxBytes * 4 / 3) + 65536
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Grok 未返回图片')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) throw new Error('Grok 图片响应过大')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  let payload: { data?: Array<{ b64_json?: unknown }> }
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof payload }
  catch { throw new Error('Grok 未返回有效的图片 JSON') }
  const encoded = payload?.data?.[0]?.b64_json
  if (typeof encoded !== 'string' || !encoded.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('Grok 未返回内嵌图片；该接口必须支持 response_format=b64_json')
  }
  const data = Buffer.from(encoded, 'base64')
  if (!data.length || data.length > input.maxBytes) throw new Error('Grok 图片为空或超过大小限制')
  // xAI may return JPEG rather than PNG; do not mislabel the attachment.
  let mediaType: ImageMediaType
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mediaType = 'image/png'
  else if (data[0] === 255 && data[1] === 216 && data[2] === 255) mediaType = 'image/jpeg'
  else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') mediaType = 'image/webp'
  else throw new Error('Grok 返回了不支持的图片格式')
  return { data, mediaType }
}
