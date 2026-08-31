// Adapted from dsh-image-gen src/openai-compatible.ts at 0a1bb6d4ad0adb0e676a1193d098bd4c4589d167.
// Copyright (c) 2026 dsh-image-gen contributors. MIT; see vendor/dsh-image-gen-LICENSE.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { imageStyleSettings } from './scene-image-style.js'
import { channelSettings, imageChannelRequest, channelImageResult } from './scene-image-channels.js'

export function imageSettings(value = {}) {
  return {
    ...channelSettings(value),
    enabled: value.enabled === true,
    style: imageStyleSettings(value.style)
  }
}

async function boundedBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('生图响应过大') }
  const chunks = []
  let length = 0
  if (response.body) for await (const chunk of response.body) {
    length += chunk.length
    if (length > limit) throw new Error('生图响应过大')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function imageBytes(data, maxBytes) {
  if (!data.length || data.length > maxBytes) throw new Error('图片为空或超过大小限制')
  let mediaType
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mediaType = 'image/png'
  else if (data[0] === 255 && data[1] === 216 && data[2] === 255) mediaType = 'image/jpeg'
  else if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString())) mediaType = 'image/gif'
  else if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') mediaType = 'image/webp'
  if (!mediaType) throw new Error('服务没有返回支持的图片格式')
  return { data, mediaType }
}

function privateAddress(address) {
  if (isIP(address) !== 4) return true // returned-download IPv6 conservatively excluded in v1
  const [a, b] = address.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

/** Never send generation credentials to a provider-returned image URL. */
export async function validateImageDownload(url, baseURL) {
  const target = new URL(url)
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error('图片下载地址不合法')
  // Explicitly configured self-hosted providers may return their own private origin.
  if (target.origin === new URL(baseURL).origin) return target.href
  if (target.protocol !== 'https:') throw new Error('第三方图片下载地址必须使用 HTTPS')
  const addresses = await lookup(target.hostname, { all: true })
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new Error('拒绝第三方图片的内网下载地址')
  return target.href
}

// Validate the DNS answer used by the socket itself, not just a preliminary
// lookup that a rebinding domain could change before fetch connects.
function downloadPublicImage(url, signal) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { signal, lookup(host, options, callback) {
      lookup(host, { all: true }).then(addresses => {
        if (!addresses.length || addresses.some(item => privateAddress(item.address))) return callback(new Error('拒绝第三方图片的内网下载地址'))
        const first = addresses[0]
        if (options.all) callback(null, [first])
        else callback(null, first.address, first.family)
      }, callback)
    } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('图片下载失败（HTTP ' + response.statusCode + '）')); return }
      const headers = new Headers()
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      resolve(new Response(Readable.toWeb(response), { status: 200, headers }))
    })
    request.on('error', reject)
    request.end()
  })
}

export async function generateSceneImage(input, deps = {}) {
  const request = deps.fetch || fetch
  const maxBytes = input.maxBytes || 20 * 1024 * 1024
  const spec = imageChannelRequest(input)
  const response = await request(spec.url, {
    method: 'POST', redirect: 'error', signal: input.signal,
    headers: spec.headers,
    body: JSON.stringify(spec.body)
  })
  // Provider errors can echo secrets; return status rather than raw bodies.
  if (!response.ok) { await response.body?.cancel(); throw new Error('生图服务请求失败（HTTP ' + response.status + '）') }
  let payload
  try { payload = JSON.parse((await boundedBytes(response, Math.ceil(maxBytes * 1.4) + 4096)).toString('utf8')) }
  catch (error) { if (error.message === '生图响应过大') throw error; throw new Error('生图服务返回的不是有效 JSON') }
  const item = channelImageResult(input.provider, payload)
  if (!item || typeof item !== 'object') throw new Error('生图服务没有返回图片')
  const inline = typeof item.b64_json === 'string' ? item.b64_json : /^data:image\/[\w.+-]+;base64,/i.test(item.url || '') ? item.url.split(',')[1] : null
  if (inline !== null) {
    const clean = inline.replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new Error('图片 base64 数据不合法')
    return imageBytes(Buffer.from(clean, 'base64'), maxBytes)
  }
  if (typeof item.url !== 'string') throw new Error('生图服务没有返回图片数据')
  const baseURL = channelSettings(input).baseURL
  const url = await (deps.validateDownload || validateImageDownload)(item.url, baseURL)
  const downloaded = !deps.fetch && new URL(url).origin !== new URL(baseURL).origin
    ? await downloadPublicImage(url, input.signal)
    : await request(url, { redirect: 'error', signal: input.signal })
  if (!downloaded.ok) { await downloaded.body?.cancel(); throw new Error('图片下载失败（HTTP ' + downloaded.status + '）') }
  return imageBytes(await boundedBytes(downloaded, maxBytes), maxBytes)
}
