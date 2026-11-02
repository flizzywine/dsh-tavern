import { fail, TtsError } from '../core.js'
import { providerConfig } from './params.js'

const strings = (value, max = 80) => Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0,32).map(v => v.slice(0,max)) : []
export const usableFishVoice = v => v?.type === 'tts' && v.state === 'trained' && !v.dmca_taken_down && !v.takedown_category && v.pvc_release_state !== 'retiring'
const excludedCatalogueTag = /narrat|announc|newscast|news|audiobook|education|advertis|commercial|播音|旁白|新闻|新聞|有声书|有聲書|有声小说|有聲小說|朗读|朗讀|解说|解說|教学|教學|教育|广告|廣告|ナレーション|アナウン|ニュース|朗読|オーディオブック|教材|広告|解説|学習|コマーシャル|^cm$/i
export const catalogueFishVoice = v => usableFishVoice(v) && v.visibility === 'public' && !(v.tags || []).some(tag => excludedCatalogueTag.test(tag))
export function fishVoiceMetadata(v) {
  if (!usableFishVoice(v) || typeof v._id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(v._id) || typeof v.title !== 'string') fail('VOICE_NOT_FOUND')
  return {voiceId:v._id,name:v.title.slice(0,200),languages:strings(v.languages),gender:null,toneTags:strings(v.tags),likeCount:v.like_count || 0,taskCount:v.task_count || 0,
    sampleUrl:(v.samples || []).map(s => s.audio).find(url => typeof url === 'string' && /^https:\/\//.test(url)) || null,coverImage:typeof v.cover_image === 'string' && /^https:\/\//.test(v.cover_image) ? v.cover_image : null,visibility:['public','unlist','private'].includes(v.visibility) ? v.visibility : 'unknown',licensed:typeof v.licensed === 'boolean' ? v.licensed : null,
    licenseNote:v.licensed === true ? 'Fish reports rights secured from the voice owner; check current service terms before use.' : 'Public visibility is not a license grant; check author permission before use.'}
}
export function createFishDiscovery({fetch = globalThis.fetch} = {}) {
  async function get(provider, secret, route) {
    const config = providerConfig('fish-audio',provider.config), signal = AbortSignal.timeout(10000)
    try {
      const response = await fetch(config.url + route,{method:'GET',headers:secret?.key ? {Authorization:'Bearer ' + secret.key} : {},redirect:'error',signal})
      if (!response.ok) { await response.body?.cancel(); fail(({401:'FISH_AUTH_FAILED',403:'FISH_AUTH_FAILED',404:'VOICE_NOT_FOUND',429:'FISH_RATE_LIMITED'})[response.status] || 'FISH_REQUEST_FAILED') }
      const chunks = []; let size = 0
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 ** 2) fail('FISH_REQUEST_FAILED'); chunks.push(chunk) }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (error) { if (error instanceof TtsError) throw error; fail(signal.aborted ? 'TIMEOUT' : 'FISH_REQUEST_FAILED') }
  }
  return {
    // This optional extension is server-owned metadata, not Fish's cloud voice directory.
    async info(provider, secret) {
      const data = await get(provider, secret, '/v1/info')
      if (!Array.isArray(data.models) || data.models.length > 256) fail('API_INCOMPATIBLE')
      const models = data.models.map(model => {
        if (typeof model?.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(model.id)) fail('API_INCOMPATIBLE')
        return {id:model.id,label:typeof model.label === 'string' ? model.label.slice(0,160) : model.id,
          ...(['free','paid'].includes(model.billing) ? {billing:model.billing} : {}),
          ...(typeof model.voiceDirections === 'boolean' ? {voiceDirections:model.voiceDirections} : {})}
      })
      // Optional service limits (PLAN appendix A): parallel lines it takes, how long a request may wait for its model to load.
      const limit = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : undefined
      // idleUnloadMs: 0 = resident; otherwise the model unloads after that long unused unless a `/v1/hold` lease is live.
      const concurrency = limit(data.capabilities?.concurrency, 16), loadTimeoutMs = limit(data.capabilities?.loadTimeoutMs, 600000), idleUnloadMs = limit(data.capabilities?.idleUnloadMs, 86400000)
      return {voices:[],models,source:'live',state:['loading','ready','sleeping','paused','error'].includes(data.state) ? data.state : 'unknown',capabilities:{prepareVoice:data.capabilities?.prepareVoice === true,voiceDirections:data.capabilities?.voiceDirections === true,
        hold:data.capabilities?.hold === true,...(concurrency ? {concurrency} : {}),...(loadTimeoutMs !== undefined ? {loadTimeoutMs} : {}),...(idleUnloadMs !== undefined ? {idleUnloadMs} : {})}}
    },
    async catalogue(provider, secret, {language} = {}) {
      const languages = ['zh','ja'].includes(language) ? [language] : ['zh','ja']
      const pages = await Promise.all(languages.map(async language => {
        const params = new URLSearchParams({language,sort_by:'task_count',page_size:'100',page_number:'1',self:'false'})
        const data = await get(provider,secret,'/model?' + params)
        if (!Array.isArray(data.items)) fail('FISH_REQUEST_FAILED')
        return data.items.filter(v => catalogueFishVoice(v) && v.languages?.includes(language)).map(fishVoiceMetadata)
      }))
      return [...new Map(pages.flat().map(v => [v.voiceId,v])).values()].sort((a,b) => b.taskCount - a.taskCount || b.likeCount - a.likeCount)
    },
    async validate(provider, secret, {voiceId}) {
      if (typeof voiceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(voiceId)) fail('INVALID_INPUT')
      const result = fishVoiceMetadata(await get(provider,secret,'/model/' + encodeURIComponent(voiceId)))
      if (result.voiceId !== voiceId) fail('FISH_REQUEST_FAILED')
      return result
    },
    async search(provider, secret, {query = '',language,page = 1} = {}) {
      if (typeof query !== 'string' || query.length > 200 || /\0/.test(query) || !Number.isSafeInteger(page) || page < 1 || page > 10000 || (language !== undefined && (typeof language !== 'string' || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(language)))) fail('INVALID_INPUT')
      const params = new URLSearchParams({self:'false',page_size:'20',page_number:String(page),title:query})
      if (language) params.set('language',language)
      const data = await get(provider,secret,'/model?' + params)
      if (!Array.isArray(data.items) || data.items.length > 100 || !Number.isSafeInteger(data.total) || data.total < 0) fail('FISH_REQUEST_FAILED')
      const voices = data.items.filter(v => usableFishVoice(v) && v.visibility === 'public').map(fishVoiceMetadata)
      return {voices,page,pageSize:20,total:data.total,hasMore:typeof data.has_more === 'boolean' ? data.has_more : page * 20 < data.total,windowLimited:data.window_limited === true}
    },
  }
}
