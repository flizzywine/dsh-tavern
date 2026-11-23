import {readFile} from 'node:fs/promises'
import resolution from '../../dsh-presentation-protocol/src/figure-resolution.cjs'
import {AUTO_CAST_TIERS} from './domain/auto-cast-priority.js'
import voiceAutoCastRule from '../../dsh-asset-library/lib/shared/voice-auto-cast.cjs'

const {resolveFigureName, normalizeCatalogueText} = resolution
const {castLanguage} = voiceAutoCastRule
// 选角助理: one background model task per round with new speakers, apart from the director;
// it adds nothing to the director or the foreground prompt. It decides, for each new speaker, before anything is created:
// an existing figure of the card under another name (not created, not drawn), a figure copied from the library, or a new one
// with its 外貌 and voice. Its output is checked only in its tools; an error is the tool result, for the model to correct.
export const AUTO_CAST_TASK = 'auto-cast'
const PROMPT = new URL('../../../presets/auto-cast/assistant.md', import.meta.url)
const SNIPPET = 600, RESULTS = 8, TEXT = 400, CALLS_PER_SPEAKER = 9
// A new speaker's voice is chosen language first (owner 11-22): it speaks 中文 unless the data says it speaks another
// language — a line of the card or of the round that says so (search_lore / 本轮正文, quoted), or the same person recorded in
// the library with a voice of that language (search_library). Then it is cast only with voices of that language
// (castLanguage, the voice's own language: never another language's voice relabelled), else that language's 默认通用声音
// (fallback, may be shared); a language without any 通用声音 leaves it unvoiced and says so in its 人物介绍.
const LANGUAGE_NAMES = new Intl.DisplayNames(['zh-Hans'], {type:'language'})
export const languageName = language => language === 'zh' ? '中文' : LANGUAGE_NAMES.of(language) || language
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i

// The round the new speakers came on in: the player's input (the round's latest user message) and the reply as the story shows
// it (the round body auto-cast counts: a line is its speaker's name and words).
export function roundStory(chat, body) {
  const input = chat.messages.findLast(row => row.role === 'user'), said = String(input?.sourceText ?? input?.text ?? '').trim()
  const reply = body.paragraphs.map(row => row.kind === 'line' ? row.name + '：' + row.text : row.text).filter(text => String(text || '').trim()).join('\n')
  return [['玩家', said], ['正文', reply]].filter(([, text]) => text).map(([label, text]) => label + '：' + text).join('\n\n')
}

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
  {name:'copy_figure', description:'把素材库里搜到的人物复制给新人物，沿用立绘和表情。是否保留声音由自动配音设置决定。', parameters:{type:'object', properties:{figure:figureArg,
    packId:{type:'string', description:'search_library 结果里的 packId'}, figureId:{type:'string', description:'search_library 结果里的 figureId'}}, required:['figure', 'packId', 'figureId']}},
  {name:'write_appearance', description:'写新人物的人物介绍和外貌：介绍进素材包，外貌进配图人物库，之后按它画人设图、立绘和场景配图（人物档案里已写过的项不覆盖）。', parameters:{type:'object', properties:{figure:figureArg,
    about:{type:'string', description:'人物介绍：他在这个故事里是谁（身份、和主角的关系、性格），一两句'},
    face:{type:'string', description:'五官、发型、发色、瞳色、年龄感'}, body:{type:'string', description:'体型、身高感、常穿的服装和配饰'},
    importance:{type:'string', enum:AUTO_CAST_TIERS, description:'重要度：core 故事的主要人物，recurring 会再出场的人物，extra 只为这一场出现的路人'}}, required:['figure', 'about', 'face', 'body', 'importance']}},
  {name:'speaks_language', description:'数据里明确写着这个新人物说中文以外的语言时调用（默认中文，不用调用）。依据二选一：quote 原样摘录卡里或本轮正文里写明他说这种语言的那句话；或 packId + figureId 指向 search_library 搜到的同一个人，库里记录的他的声音就是这种语言。', parameters:{type:'object', properties:{figure:figureArg,
    language:{type:'string', description:'语言代码，如 ja、en、ko'}, quote:{type:'string', description:'写明他说这种语言的原文，原样摘录'},
    packId:{type:'string', description:'search_library 结果里同一个人的 packId'}, figureId:{type:'string', description:'search_library 结果里同一个人的 figureId'}}, required:['figure', 'language']}},
  {name:'list_library_voices', description:'列出说某种语言的通用声线（language 不填是中文）。先按性别、年龄感筛选，再按性格和说话风格匹配 figures 里的通用人物原型及 usage 使用情景。没有合适的原型再选通用路人声线。inUse 表示本卡或本轮已占用的实际声线；fallback 为 true 的是这种语言的默认通用声音，别的都不合适或已占用时用它，可以多人共用。', parameters:{type:'object', properties:{language:{type:'string', description:'新人物说的语言代码：zh（默认）、ja、en…'}}}},
  {name:'assign_voice', description:'给不复制的新人物绑定最贴合人设、尚未占用、和他说同一种语言的声线；只借用通用原型的声音，不复制该原型的名字或外貌。性别相符时，优先比较年龄感、性格和说话风格。', parameters:{type:'object', properties:{figure:figureArg,
    packId:{type:'string', description:'结果里声音的 packId'}, voiceId:{type:'string', description:'结果里声音的 voiceId'},
    reason:{type:'string', description:'给主人看的一句配音理由，结合具体音色或说话方式与人设。例如：她说话干脆、不爱绕弯，选咬字清楚、语速利落的年轻女声。'}}, required:['figure', 'packId', 'voiceId', 'reason']}},
  {name:'finish', description:'全部新人物都处理完了。', parameters:{type:'object', properties:{}}},
]

// One casting run over the round's new speakers [{name, aliases}]. rows: the card's whole cast (the shared resolver's rows);
// search(query): the library's whole-library search (null: no library tools); libraryVoices(): the library's 通用声音
// ({voices, more}; null: none); pieces: cardLorePieces (card-stage.js); story: the round's text (roundStory), where a speaker
// the card never names comes on and is first described. A voice is chosen only among the library's 通用声音 (those
// offered to it, voiceAutoCast in voice-auto-cast.cjs; library-search.js filters): never a figure's own, nor a bare 配音后端 voice.
// voices: false (自动配音 off) offers no voice tools and lists no voices: new people are created without one.
// → {same:{[name]:ref}, copy:{[name]:{source, revision}}, appearance:{[name]:{face, bodySFW}}, about:{[name]:人物介绍}, importance:{[name]:tier}, voice:{[name]:{from, revision, reason}},
//    language:{[name]:tag} (only another language than 中文), unvoiced:{[name]:tag} (its language has no 通用声音), finished}
export async function runCastingAssistant({runAgent, selection, sessionId, turn, signal, speakers, rows, voiceKeys = new Set(), pieces, story = '', search, libraryVoices = null, voices = true}) {
  const result = {same:{}, copy:{}, appearance:{}, about:{}, importance:{}, voice:{}, language:{}, unvoiced:{}, finished:false}
  const seen = {figures:new Map(), voices:new Map()}
  const picked = new Map()
  const speaker = name => speakers.find(row => resolveFigureName([{actorKey:'n', name:row.name, aliases:row.aliases || [], enabled:true}], {name:String(name || '')}).status === 'resolved')
  const fail = message => JSON.stringify({ok:false, error:message})
  const unknown = name => fail('没有叫「' + name + '」的新人物；新人物是：' + speakers.map(row => row.name).join('、'))
  const spoken = name => result.language[name] || 'zh'
  const taken = (sound, target) => voiceKeys.has(sound)
    || [...picked].some(([name, key]) => name !== target && key === sound && !result.copy[name] && !result.same[name])
  // A library voice as the model reads it (search_library and list_library_voices); remembered for assign_voice.
  const voiceRow = row => {
    seen.voices.set(row.packId + '/' + row.voiceId, row)
    return {packId:row.packId, voiceId:row.voiceId, name:row.name, language:row.language, ...(row.guidance ? {usage:row.guidance} : {}), pack:row.packName,
      ...(row.figures?.length ? {figures:row.figures} : {}), inUse:taken(row.sound), ...(row.fallback ? {fallback:true} : {})}
  }
  const tools = {
    search_lore:({query}) => JSON.stringify({ok:true, results:searchLore(pieces, String(query || ''))}),
    async search_library({query}) {
      const found = await search(String(query || ''))
      for (const row of found.figures) seen.figures.set(row.packId + '/' + row.ref.figureId, row)
      return JSON.stringify({ok:true,
        figures:found.figures.map(row => ({packId:row.packId, figureId:row.ref.figureId, name:row.name, aliases:row.aliases, pack:row.packName, ...(row.description ? {description:row.description} : {}), canCopy:row.copyable, ...(voices ? {voice:row.voice ? {name:row.voice.name, language:row.voice.language} : null} : {})})),
        ...(voices ? {voices:found.voices.map(voiceRow)} : {})})
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
    write_appearance({figure, about, face, body, importance}) {
      const target = speaker(figure)
      if (!target) return unknown(figure)
      const traits = {face:String(face || '').trim(), bodySFW:String(body || '').trim()}
      if (!traits.face || !traits.bodySFW || traits.face.length > TEXT || traits.bodySFW.length > TEXT) return fail('face 和 body 都要写，各不超过 ' + TEXT + ' 字')
      if (!AUTO_CAST_TIERS.includes(importance)) return fail('importance 只能是 ' + AUTO_CAST_TIERS.join('、') + ' 之一')
      result.appearance[target.name] = traits
      result.importance[target.name] = importance
      if (String(about || '').trim()) result.about[target.name] = String(about).trim().slice(0, TEXT)
      return JSON.stringify({ok:true})
    },
    speaks_language({figure, language, quote, packId, figureId}) {
      const target = speaker(figure)
      if (!target) return unknown(figure)
      if (!LANGUAGE_TAG.test(String(language || ''))) return fail('language 写语言代码，如 ja、en、ko')
      const tag = castLanguage(language)
      if (result.same[target.name] || result.copy[target.name]) return fail('已有或复制的人物保留原本的配音和语言')
      if (tag === 'zh') return fail('默认就是中文，不用调用')
      const needle = normalizeCatalogueText(quote)
      const quoted = [...pieces.map(piece => piece.text), story].some(text => needle.length >= 2 && normalizeCatalogueText(text).includes(needle))
      const recorded = seen.figures.get(packId + '/' + figureId)
      if (!quoted && !recorded) return fail('给出依据：quote 原样摘录卡里或本轮正文写明他说' + languageName(tag) + '的话（search_lore 搜得到），或 packId + figureId 指向 search_library 搜到的同一个人；没有依据就是中文，不用调用')
      if (!quoted && recorded.voice?.language !== tag) return fail('库里的「' + recorded.name + '」' + (recorded.voice ? '声音是' + languageName(recorded.voice.language) : '没有声音') + '，不能作为他说' + languageName(tag) + '的依据')
      result.language[target.name] = tag
      // a voice chosen before the language was known is another language's
      if (result.voice[target.name] && castLanguage(seen.voices.get(result.voice[target.name].from.packId + '/' + result.voice[target.name].from.voiceId)?.language) !== tag) { picked.delete(target.name); delete result.voice[target.name] }
      return JSON.stringify({ok:true, note:'之后用 list_library_voices 传 language:"' + tag + '"，只从' + languageName(tag) + '的声音里挑'})
    },
    async list_library_voices({language} = {}) {
      if (language !== undefined && !LANGUAGE_TAG.test(String(language))) return fail('language 写语言代码，如 zh、ja、en；不填是中文')
      const tag = castLanguage(language), found = await libraryVoices(tag)
      if (!found.voices.length) return JSON.stringify({ok:true, voices:[], note:'素材库里没有' + languageName(tag) + '的通用声音：说' + languageName(tag) + '的新人物不配声音，系统会记在人物介绍里；不要改用别的语言的声音'})
      return JSON.stringify({ok:true, voices:found.voices.map(voiceRow), ...(found.more ? {more:found.more} : {})})
    },
    assign_voice({figure, packId, voiceId, reason}) {
      const target = speaker(figure)
      if (!target) return unknown(figure)
      const row = seen.voices.get(packId + '/' + voiceId)
      if (!row) return fail('先用 list_library_voices 或 search_library 找到这个通用声音，再用结果里的 packId 和 voiceId')
      if (result.same[target.name] || result.copy[target.name]) return fail('已有或复制的人物保留原本的配音')
      const tag = spoken(target.name)
      if (castLanguage(row.language) !== tag) return fail('「' + target.name + '」说' + languageName(tag) + '，这条声音说' + languageName(castLanguage(row.language)) + '：只从' + languageName(tag) + '的声音里挑（list_library_voices 传 language:"' + tag + '"）' + (tag === 'zh' ? '；数据里明确写着他说别的语言时先调用 speaks_language' : ''))
      if (!row.fallback && taken(row.sound, target.name)) return fail('这条声线已有人在用；换一条适合该人物且未被占用的声线，都不合适时用这种语言 fallback 为 true 的默认通用声音')
      reason = String(reason || '').trim()
      if (!reason || reason.length > TEXT) return fail('用一句话说明音色或说话方式为什么符合人设，不超过 ' + TEXT + ' 字')
      picked.set(target.name, row.sound)
      result.voice[target.name] = {from:{packId, voiceId}, revision:row.revision, reason}
      return JSON.stringify({ok:true})
    },
    finish() { result.finished = true; return JSON.stringify({ok:true}) },
  }
  const offered = TOOLS.filter(tool => (search || !['search_library', 'copy_figure'].includes(tool.name))
    && (voices && libraryVoices || tool.name !== 'list_library_voices') && (voices && (search || libraryVoices) || !['assign_voice', 'speaks_language'].includes(tool.name)))
  const taskText = JSON.stringify({新人物:speakers.map(row => row.name), 本卡已有人物:rows.map(row => [row.name, ...row.aliases].join(' / ')), ...(story ? {本轮正文:story} : {})})
  // Each speaker takes a few searches and decisions (lore, library, appearance, voices): the runner's call budget grows with them.
  await runAgent({task:AUTO_CAST_TASK, sessionId, turn, selection, ownPrefix:true, system:await readFile(PROMPT, 'utf8'), taskText, messages:[], signal,
    maxToolCalls:CALLS_PER_SPEAKER * speakers.length + 2, toolLimitMessage:'工具次数用完了：已做的决定都有效，请调用 finish 结束。',
    tools:offered.map(tool => tool.name === 'finish' ? {...tool, countsTowardLimit:false} : tool), onToolCall:async call => tools[call.name] && offered.some(tool => tool.name === call.name) ? tools[call.name](call.arguments || {}) : fail('没有这个工具')})
  // Said plainly, never filled with another language's voice: a new speaker left without a voice because its language has
  // no 通用声音 at all.
  if (voices && libraryVoices) {
    const none = new Map()
    for (const {name} of speakers) {
      if (result.same[name] || result.copy[name] || result.voice[name]) continue
      const tag = spoken(name)
      if (!none.has(tag)) none.set(tag, !(await libraryVoices(tag)).voices.length)
      if (none.get(tag)) result.unvoiced[name] = tag
    }
  }
  return result
}

// 借用形象: the 立绘 each new speaker stands in with until their own is drawn, chosen the moment their line is written (one
// short call, apart from the 选角助理, which takes seconds per person: the round's director has finished long before it).
// figures: the library's 通用人物原型 a look can be lent from (auto-cast-library.js lendable()). → {[name]: {packId, figureId}}.
const LEND_PROMPT = new URL('../../../presets/auto-cast/lend.md', import.meta.url)
export const AUTO_CAST_LEND_TASK = 'auto-cast-lend'
export async function runLookLender({runAgent, selection, sessionId, turn, signal, speakers, story = '', figures}) {
  const looks = {}
  const speaker = name => speakers.find(row => resolveFigureName([{actorKey:'n', name:row.name, aliases:row.aliases || [], enabled:true}], {name:String(name || '')}).status === 'resolved')
  const fail = message => JSON.stringify({ok:false, error:message})
  const tools = [
    {name:'lend', description:'给一个新人物借一个通用人物的立绘。', parameters:{type:'object', properties:{figure:figureArg, figureId:{type:'string', description:'可借的通用人物里的 figureId'}}, required:['figure', 'figureId']}},
    {name:'finish', description:'每个新人物都借好了。', parameters:{type:'object', properties:{}}, countsTowardLimit:false},
  ]
  const calls = {
    lend({figure, figureId}) {
      const target = speaker(figure), row = figures.find(candidate => candidate.figureId === figureId)
      if (!target) return fail('没有叫「' + figure + '」的新人物；新人物是：' + speakers.map(row => row.name).join('、'))
      if (!row) return fail('figureId 要从「可借的通用人物」里选')
      looks[target.name] = {packId:row.packId, figureId:row.figureId}
      return JSON.stringify({ok:true})
    },
    finish:() => JSON.stringify({ok:true}),
  }
  const taskText = JSON.stringify({新人物:speakers.map(row => row.name), 可借的通用人物:figures.map(row => ({figureId:row.figureId, name:row.name, ...(row.heightCm ? {身高:row.heightCm} : {})})), ...(story ? {本轮正文:story} : {})})
  await runAgent({task:AUTO_CAST_LEND_TASK, sessionId, turn, selection, ownPrefix:true, system:await readFile(LEND_PROMPT, 'utf8'), taskText, messages:[], signal,
    maxToolCalls:speakers.length + 2, toolLimitMessage:'工具次数用完了：已借的都有效，请调用 finish 结束。',
    tools, onToolCall:async call => calls[call.name] ? calls[call.name](call.arguments || {}) : fail('没有这个工具')})
  return looks
}