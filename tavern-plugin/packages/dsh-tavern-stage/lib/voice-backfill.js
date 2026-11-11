// 配音补译: a speaker whose voice language is not Chinese can speak in a round
// without having been recalled, so the story model wrote only the Chinese display text for that line. Once the text is
// written, a background task translates exactly those lines into the speaker's voice language for synthesis only and
// stores them with the round (message.voiceBackfill). The subtitle stays Chinese; the foreground prompt is untouched.
export const VOICE_BACKFILL_TASK = Object.freeze({task:'voice-backfill', name:'配音补译', lane:'ephemeral', member:'',
  does:'正文写完后，把配音语言不是中文、却没写配音文本的台词译成说话人的配音语言（路人和没有自己声音的人物按通用声音的配音语言）；旁白的配音语言不是中文时，旁白段落也整段译好；译文只用来合成语音，字幕仍是中文。',
  reads:'本轮台词与旁白、人物和旁白的配音语言', writes:'本轮台词与旁白的配音文本（按回合，剧情回退或改写后作废）',
  note:'不等结算；这几句的语音等它译完，失败时照旧朗读中文'})

export const VOICE_BACKFILL_PROMPT = [
  '你在为一部中文角色扮演故事补写配音台词。下面几句台词的说话人用别的语言配音；你的译文只交给语音合成朗读，玩家看到的字幕仍是中文原句。',
  '请把每句译成该人物配音语言里自然的口语，就像这个人物本人开口说话：保留语气、称呼和情绪，人名用原作里的写法。心里话也照样翻译。',
  '输入每行是「编号. 人物〔配音语言〕：台词」。请按同样的编号逐行只写译文，一行一句，不加引号、注释或其他内容。说话人是「旁白」的一行是一整段叙述：照样译成该语言自然的叙述，整段写在同一行。',
  '例：\n输入\n1. 杏子〔日语〕：哼，这点小事也要我帮忙？\n输出\n1. ふん、こんなことでもあたしに頼むわけ？'
].join('\n\n')

const languageNames = new Intl.DisplayNames(['zh-CN'], {type:'language'})

export function voiceBackfillTaskText(lines) {
  // a narration paragraph may hold line breaks; it is one numbered line here.
  return lines.map((line, index) => `${index + 1}. ${line.name}〔${languageNames.of(line.language)}〕：${line.narration ? line.text.replace(/\s*\n\s*/g, ' ') : line.text}`).join('\n')
}

/** The model's numbered reply as {key: voice text}; null unless every line came back exactly once. */
export function readVoiceBackfill(text, lines) {
  const found = new Map()
  for (const row of String(text || '').split('\n')) {
    const match = /^\s*(\d+)\s*[.．、]\s*(\S.*?)\s*$/u.exec(row)
    if (match) found.set(Number(match[1]), match[2])
  }
  if (found.size !== lines.length || lines.some((_, index) => !found.has(index + 1))) return null
  return Object.fromEntries(lines.map((line, index) => [line.key, found.get(index + 1)]))
}

// The reply the record belongs to; a regenerated, edited or rolled-back round no longer matches it.
const prose = message => JSON.stringify([message?.role, Number(message?.turn), message?.sourceText, message?.text, message?.displayText, message?.swipeId ?? null])
const stale = () => Object.assign(new Error('本轮正文已变化，配音补译作废'), {code:'VOICE_BACKFILL_STALE'})

// One task per game at a time (queued), started by 正文写完, cancelled by 回合作废 and 剧情回退或改写. It runs a fresh
// background Agent with its own short prompt (the game's background model, official max output, its reasoning level),
// never during a compaction, and never blocks play: a failure leaves the record failed and the lines speak Chinese.
// The round's lines that need a voice text and those it already has come from the core round body (round-body.js
// voiceBackfillLines / voiceBackfillKept), reached through the stage's core contract.
export function createVoiceBackfill({workflow, chatHeaderForSession, dialogueBubbles, chatForSession, bodyForTurn, voiceBackfillLines, voiceBackfillKept, writeMessage, runAgent, selection, blocked}) {
  let active = true
  const queues = new Map(), controllers = new Map()
  async function enabled(sessionId) {
    if (!active) return false
    const header = await chatHeaderForSession(String(sessionId), ['cardPath','mode','regenInProgress'])
    if (!active || !header?.cardPath || !['story','script'].includes(header.mode) || header.regenInProgress) return false
    const config = await dialogueBubbles.read(header.cardPath)
    return active && config?.enabled === true && config.voice?.enabled !== false
  }
  async function backfill(sessionId, signal) {
    const chat = await chatForSession(sessionId)
    if (!active || signal.aborted || !chat || chat.regenInProgress) return {lines:0}
    const index = chat.messages.findLastIndex(row => row?.role === 'assistant'), message = chat.messages[index]
    if (!message || message.greeting) return {lines:0}
    const turn = Number(message.turn), fence = prose(message)
    const [config, body] = await Promise.all([dialogueBubbles.read(chat.cardPath), bodyForTurn(chat, turn)])
    const lines = voiceBackfillLines(body?.paragraphs, config)
    if (!active || signal.aborted || !lines.length) return {lines:0}
    const kept = voiceBackfillKept(body.paragraphs), keys = lines.map(line => line.key)
    const write = record => writeMessage(chat.id, index, current => {
      if (prose(current) !== fence) throw stale()
      current.voiceBackfill = {...record, keys}
    })
    // No background task starts while the game is compacted (ADR 0003): those lines speak Chinese.
    if (blocked(chat)) { await write({status:'failed', lines:kept}); return {lines:lines.length, translated:0} }
    await write({status:'pending', lines:kept})
    let reply
    try {
      reply = await runAgent({task:'voice-backfill', sessionId, turn, selection:await selection(sessionId), ownPrefix:true,
        system:VOICE_BACKFILL_PROMPT, taskText:voiceBackfillTaskText(lines), messages:[], tools:[], signal})
    } catch (error) {
      if (!signal.aborted) await write({status:'failed', lines:kept}).catch(() => {})
      throw error
    }
    const translated = readVoiceBackfill(reply?.text, lines)
    if (!translated) {
      await write({status:'failed', lines:kept})
      throw new Error('配音补译没有逐句返回译文')
    }
    await write({status:'done', lines:{...kept, ...translated}})
    return {lines:lines.length, translated:lines.length}
  }
  function run({gameId}) {
    const id = String(gameId)
    const previous = queues.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(() => {
      if (!active) return {lines:0}
      const controller = new AbortController()
      controllers.set(id, controller)
      return backfill(id, controller.signal).finally(() => { if (controllers.get(id) === controller) controllers.delete(id) })
    })
    queues.set(id, current)
    return current.finally(() => { if (queues.get(id) === current) queues.delete(id) })
  }
  function cancel({gameId}) {
    controllers.get(String(gameId))?.abort(stale())
  }
  const stop = workflow.job({taskInfo:VOICE_BACKFILL_TASK, id:'voice-backfill', task:'voice-backfill', name:'配音补译', on:'reply-committed',
    condition:'开启对话气泡与配音、本轮有缺配音文本的外语配音台词时', enabled:({gameId}) => enabled(gameId), run, cancelOn:['turn-discarded','story-rewound'], cancel})
  return {
    pending:() => queues.size,
    dispose() { active = false; stop(); for (const controller of controllers.values()) controller.abort(stale()) }
  }
}
