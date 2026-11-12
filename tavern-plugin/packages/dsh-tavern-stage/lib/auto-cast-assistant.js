import {readFile} from 'node:fs/promises'
import resolution from '../../dsh-presentation-protocol/src/figure-resolution.cjs'
import {voiceSourceKey} from './auto-cast-library.js'

const {resolveFigureName, normalizeCatalogueText} = resolution
// 选角助理: one background model task per round with new speakers, apart from the director;
// it adds nothing to the director or the foreground prompt. It decides, for each new speaker, before anything is created:
// an existing figure of the card under another name (not created, not drawn), a figure copied from the library, or a new one
// with its 外貌 and voice. Its output is checked only in its tools; an error is the tool result, for the model to correct.
export const AUTO_CAST_TASK = 'auto-cast'
const PROMPT = new URL('../../../presets/auto-cast/assistant.md', import.meta.url)
const SNIPPET = 600, RESULTS = 8, TEXT = 400, BACKEND = 40, CALLS_PER_SPEAKER = 9

// The card's text as searchable pieces: card-stage.js cardLorePieces.
export function searchLore(pieces, query) {
  const needle = normalizeCatalogueText(query)
  if (!needle) return []
  return pieces.filter(piece => normalizeCatalogueText(piece.text + ' ' + (piece.keys || []).join(' ')).includes(needle)).slice(0, RESULTS)
    .map(piece => ({source:piece.source, text:piece.text.length > SNIPPET ? piece.text.slice(0, SNIPPET) + '…' : piece.text}))
}

const figureArg = {type:'string', description:'新人物的名字'}
const TOOLS = [
  {name:'search_lore', description:'按名字、别名或关键词搜本卡的原文、世界书和人物档案，返回命中的原文片段。', parameters:{type:'object', properties:{query:{type:'string', description:'一个名字或关键词'}}, required:['query']}},
  {name:'search_library', description:'在整个素材库里按名字、别名、人物介绍或声音的使用场景搜人物和声音。', parameters:{type:'object', properties:{query:{type:'string', description:'一个名字或关键词，如「雪乃」「毒舌」「中年男性」'}}, required:['query']}},
  {name:'same_as', description:'新人物其实是本卡已有的某个人物换了个叫法（两个名字有包含关系，如「晓美焰」和「晓美焰·麻花辫」）：不新建、不画。', parameters:{type:'object', properties:{figure:figureArg, existing:{type:'string', description:'本卡已有人物的名字'}}, required:['figure', 'existing']}},
  {name:'copy_figure', description:'把素材库里搜到的人物复制给新人物（立绘、表情、声音一起带，改成新人物的名字），不再画。', parameters:{type:'object', properties:{figure:figureArg,
    packId:{type:'string', description:'search_library 结果里的 packId'}, figureId:{type:'string', description:'search_library 结果里的 figureId'}}, required:['figure', 'packId', 'figureId']}},
  {name:'write_appearance', description:'写新人物的人物介绍和外貌：介绍进素材包，外貌进配图人物库，之后按它画人设图、立绘和场景配图（人物档案里已写过的项不覆盖）。', parameters:{type:'object', properties:{figure:figureArg,
    about:{type:'string', description:'人物介绍：他在这个故事里是谁（身份、和主角的关系、性格），一两句'},
    face:{type:'string', description:'五官、发型、发色、瞳色、年龄感'}, body:{type:'string', description:'体型、身高感、常穿的服装和配饰'}}, required:['figure', 'about', 'face', 'body']}},
  {name:'list_backend_voices', description:'列出配音后端现在能用的声音（素材库里搜不到合适的声音时再用）。', parameters:{type:'object', properties:{language:{type:'string', description:'只列会说这种语言的，如 zh、ja'}}}},
  {name:'assign_voice', description:'给新人物配一个声音：素材库里搜到的（带 packId），或配音后端列出的（不带 packId）。', parameters:{type:'object', properties:{figure:figureArg,
    packId:{type:'string', description:'search_library 结果里声音的 packId；配音后端的声音不填'}, voiceId:{type:'string', description:'声音的 voiceId'},
    language:{type:'string', description:'配音后端的声音要填：这个人物说话的语言，如 zh、ja'}}, required:['figure', 'voiceId']}},
  {name:'finish', description:'全部新人物都处理完了。', parameters:{type:'object', properties:{}}},
]

// One casting run over the round's new speakers [{name, aliases}]. rows: the card's whole cast (the shared resolver's rows);
// search(query): the library's whole-library search (null: no library tools); pieces: cardLorePieces (card-stage.js); backend: the 配音后端's
// voices {voices(), spec(voiceId, language)} (null: none); spoken: what the cast speaks with (voiceSourceKey).
// → {same:{[name]:ref}, copy:{[name]:{source, revision}}, appearance:{[name]:{face, bodySFW}}, about:{[name]:人物介绍}, voice:{[name]:{from, revision} | {spec}}, finished}
export async function runCastingAssistant({runAgent, selection, sessionId, turn, signal, speakers, rows, pieces, search, backend = null, spoken = new Set()}) {
  const result = {same:{}, copy:{}, appearance:{}, about:{}, voice:{}, finished:false}
  const seen = {figures:new Map(), voices:new Map(), backend:new Map()}
  const speaker = name => speakers.find(row => resolveFigureName([{actorKey:'n', name:row.name, aliases:row.aliases || [], enabled:true}], {name:String(name || '')}).status === 'resolved')
  const fail = message => JSON.stringify({ok:false, error:message})
  const unknown = name => fail('没有叫「' + name + '」的新人物；新人物是：' + speakers.map(row => row.name).join('、'))
  const taken = (packId, voiceId) => rows.some(row => row.ref.packId === packId && row.figure?.voice?.voice === voiceId)
    || Object.values(result.voice).some(row => row.from?.packId === packId && row.from?.voiceId === voiceId)
  const spokenBy = spec => [spoken, new Set(Object.values(result.voice).filter(row => row.spec).map(row => voiceSourceKey(row.spec.sources[row.spec.defaultSource])))]
    .some(keys => keys.has(voiceSourceKey(spec.sources[spec.defaultSource])))
  const tools = {
    search_lore:({query}) => JSON.stringify({ok:true, results:searchLore(pieces, String(query || ''))}),
    async search_library({query}) {
      const found = await search(String(query || ''))
      for (const row of found.figures) seen.figures.set(row.packId + '/' + row.ref.figureId, row)
      for (const row of found.voices) seen.voices.set(row.packId + '/' + row.voiceId, row)
      return JSON.stringify({ok:true,
        figures:found.figures.map(row => ({packId:row.packId, figureId:row.ref.figureId, name:row.name, aliases:row.aliases, pack:row.packName, ...(row.description ? {description:row.description} : {}), canCopy:row.copyable, voice:row.voice?.name || null})),
        voices:found.voices.map(row => ({packId:row.packId, voiceId:row.voiceId, name:row.name, language:row.language, ...(row.guidance ? {usage:row.guidance} : {}), inUse:taken(row.packId, row.voiceId)}))})
    },
    same_as({figure, existing}) {
      const target = speaker(figure)
      if (!target) return unknown(figure)
      const found = resolveFigureName(rows, {name:String(existing || '')})
      if (found.status !== 'resolved') return fail('本卡没有唯一叫「' + existing + '」的人物；已有：' + rows.map(row => row.name).join('、'))
      // Another way of naming only: the speaker's name and one of that figure's names or aliases contain one another
      // (晓美焰 / 晓美焰·麻花辫; an equal name another figure also bears counts). Anything else is a new figure.
      const spoken = normalizeCatalogueText(target.name), names = [found.row.name, ...found.row.aliases].map(normalizeCatalogueText).filter(Boolean)
      if (!names.some(name => name.includes(spoken) || spoken.includes(name))) return fail('「' + target.name + '」和「' + found.row.name + '」的名字对不上，不是同一个人物；请把「' + target.name + '」当新人物处理')
      result.same[target.name] = found.row.ref
      return JSON.stringify({ok:true})
    },
    copy_figure({figure, packId, figureId}) {
      const target = speaker(figure), row = seen.figures.get(packId + '/' + figureId)
      if (!target) return unknown(figure)
      if (!row) return fail('先用 search_library 搜到这个人物，再用结果里的 packId 和 figureId')
      if (!row.copyable) return fail('这个人物的图片格式不能复制，换一个或改为写外貌')
      result.copy[target.name] = {source:{packId, figureId}, revision:row.revision}
      return JSON.stringify({ok:true})
    },
    write_appearance({figure, about, face, body}) {
      const target = speaker(figure)
      if (!target) return unknown(figure)
      const traits = {face:String(face || '').trim(), bodySFW:String(body || '').trim()}
      if (!traits.face || !traits.bodySFW || traits.face.length > TEXT || traits.bodySFW.length > TEXT) return fail('face 和 body 都要写，各不超过 ' + TEXT + ' 字')
      result.appearance[target.name] = traits
      if (String(about || '').trim()) result.about[target.name] = String(about).trim().slice(0, TEXT)
      return JSON.stringify({ok:true})
    },
    async list_backend_voices({language}) {
      const voices = (await backend.voices()).filter(row => !language || !row.languages.length || row.languages.includes(String(language)))
      for (const row of voices) seen.backend.set(row.voiceId, row)
      return JSON.stringify({ok:true, voices:voices.slice(0, BACKEND).map(row => ({voiceId:row.voiceId, name:row.name, languages:row.languages})), ...(voices.length > BACKEND ? {more:voices.length - BACKEND} : {})})
    },
    async assign_voice({figure, packId, voiceId, language}) {
      const target = speaker(figure)
      if (!target) return unknown(figure)
      if (!packId) {
        const row = seen.backend.get(voiceId)
        if (!row) return fail('先用 list_backend_voices 列出声音，再用结果里的 voiceId；素材库的声音要带 packId')
        if (!language || (row.languages.length && !row.languages.includes(String(language)))) return fail('填这个人物说话的语言（language），并选会说这种语言的声音；这个声音会说：' + row.languages.join('、'))
        const spec = await backend.spec(voiceId, String(language)).catch(() => null)
        if (!spec?.sources[spec.defaultSource]?.voiceName) return fail('这个声音不能放进素材包，换一个')
        if (spokenBy(spec)) return fail('本卡已有人物在用这个声音，换一个')
        result.voice[target.name] = {spec}
        return JSON.stringify({ok:true})
      }
      const row = seen.voices.get(packId + '/' + voiceId)
      if (!row) return fail('先用 search_library 搜到这个声音，再用结果里的 packId 和 voiceId')
      if (taken(packId, voiceId)) return fail('本卡已有人物在用这个声音，换一个')
      result.voice[target.name] = {from:{packId, voiceId}, revision:row.revision}
      return JSON.stringify({ok:true})
    },
    finish() { result.finished = true; return JSON.stringify({ok:true}) },
  }
  const offered = TOOLS.filter(tool => (search || !['search_library', 'copy_figure'].includes(tool.name)) && (backend || tool.name !== 'list_backend_voices') && (search || backend || tool.name !== 'assign_voice'))
  const taskText = JSON.stringify({新人物:speakers.map(row => row.name), 本卡已有人物:rows.map(row => [row.name, ...row.aliases].join(' / '))})
  // Each speaker takes a few searches and decisions (lore, library, appearance, voices): the runner's call budget grows with them.
  await runAgent({task:AUTO_CAST_TASK, sessionId, turn, selection, ownPrefix:true, system:await readFile(PROMPT, 'utf8'), taskText, messages:[], signal,
    maxToolCalls:CALLS_PER_SPEAKER * speakers.length + 2, toolLimitMessage:'工具次数用完了：已做的决定都有效，请调用 finish 结束。',
    tools:offered.map(tool => tool.name === 'finish' ? {...tool, countsTowardLimit:false} : tool), onToolCall:async call => tools[call.name] && offered.some(tool => tool.name === call.name) ? tools[call.name](call.arguments || {}) : fail('没有这个工具')})
  return result
}
