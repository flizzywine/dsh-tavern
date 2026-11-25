// Lyria through the Gemini API (generativelanguage.googleapis.com or a gateway with the same routes): the first 音乐生成
// adapter (music.js). models() reads the API's own catalogue; generate() asks for one instrumental track.
import { isGeminiMusicModel } from './params.js'

// What one track is expected to cost, for the optional spend guard (spend.js); the account's own billing is the truth.
const TRACK_USD = 0.08

export function createLyriaAdapter({fetch = globalThis.fetch} = {}) {
  const refused = (what, status) => Object.assign(new Error(`${what} HTTP ${status}`), {status})
  return {
    estimateUsd() { return TRACK_USD },
    // The generateContent music models the key may use, every page of the catalogue.
    async models(p, secret, {signal = AbortSignal.timeout(15000)} = {}) {
      const models = new Map(), tokens = new Set(), url = new URL(p.config.url + '/v1beta/models')
      for (;;) {
        const response = await fetch(url.href, {headers:{'x-goog-api-key':secret.key},redirect:'error',signal})
        if (!response.ok) throw refused('Gemini models', response.status)
        const page = await response.json()
        for (const row of page.models || []) {
          const id = row.name?.replace(/^models\//, '')
          if (isGeminiMusicModel(id) && row.supportedGenerationMethods?.includes('generateContent')) models.set(id, {id,label:row.displayName || id})
        }
        if (!page.nextPageToken) break
        if (tokens.has(page.nextPageToken)) throw new Error('Gemini 模型目录分页无效')
        tokens.add(page.nextPageToken)
        url.searchParams.set('pageToken', page.nextPageToken)
      }
      return [...models.values()]
    },
    // → {bytes, mimeType, model}. An HTTP refusal carries its `status`.
    async generate(p, secret, {prompt, signal}) {
      const {url, model} = p.config
      const response = await fetch(`${url}/v1beta/models/${model}:generateContent`, {
        redirect:'error', method:'POST',
        headers:{'Content-Type':'application/json','x-goog-api-key':secret.key},
        signal:AbortSignal.any([AbortSignal.timeout(90_000), ...(signal ? [signal] : [])]),
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig:{responseModalities:['AUDIO','TEXT']}}),
      })
      if (!response.ok) throw refused('Lyria', response.status)
      const parts = (await response.json()).candidates?.[0]?.content?.parts ?? []
      const audio = parts.find(part => part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData.data)?.inlineData
      if (!audio) throw new Error('Lyria returned no audio')
      return {bytes:Buffer.from(audio.data, 'base64'), mimeType:audio.mimeType, model}
    },
  }
}
