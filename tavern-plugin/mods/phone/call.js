// a voice call with one phone contact.
//
// A call is a side conversation, not story: it never writes the Story Timeline. Every call is anchored to the story
// position it happened at ({branchId, turn, para?}); a call on another branch, or after that position, has not happened
// (the Story Timeline stays the single truth of what has happened). At dial the host gives the model the latest story
// rounds and every phone record of the story so far (call-context.js); the story itself is read, never written.
//
import { PROMPT_PROSE, bubbleVoiceSwitches } from '../../lib/domain/dialogue-bubbles.js'
import { prompt } from '../../lib/prompt-catalog.js'
import { promptSection } from '../../lib/domain/prompt-section.js'
import { parseBubbles, bubbleSpeechCut, matchBubbleMood, voiceTranslates as languageTranslates, projectVoiceCues } from '../../src/client/bubble-line.cjs'

const LANGUAGE_NAMES = {ja:'Japanese',zh:'Chinese',en:'English',ko:'Korean',yue:'Cantonese'}
const CALL_EXAMPLES = {
  ja:['うん。','どうしたの？','ありがとう。'],
  en:['Yes.','What is it?','Thank you.'],
  ko:['응.','무슨 일이야?','고마워.'],
  yue:['嗯。','咩事呀？','多謝。'],
}
const text = value => typeof value === 'string' ? value : ''
const compact = (value, max) => text(value).replace(/\s+/g, ' ').trim().slice(0, max)
export const speechCut = bubbleSpeechCut
// Foreign subtitles and voice are one paired cue per bubble. Never infer translation alignment from text lengths.
export function createCallReplyParser({language = 'zh', moods = [], defaultEmotion = 'default', contact = {}, voiceTranslates = languageTranslates(language)} = {}) {
  let source = '', finished = false
  const states = [], segments = []
  function project() {
    const events = []
    parseBubbles(source, !finished, {callSpeaker:contact}).filter(row => row.kind === 'bubble').forEach((bubble, index) => {
      const state = states[index] ||= {sent:0, closed:false}
      const mood = matchBubbleMood(bubble.mood, moods)?.id || defaultEmotion
      if (state.closed || bubble.thought) return
      const foreign = voiceTranslates, speech = foreign ? bubble.speech || '' : bubble.speech ?? bubble.text
      const piece = (say, part, sub) => {
        say = say.trim()
        if (!say) return
        const index = segments.length
        sub = projectVoiceCues(sub).trim()
        segments.push({say, sub, mood, ...(part ? {part:true} : {})})
        events.push({type:'say', index, say, mood, ...(part ? {part:true} : {})}, {type:'sub', index, sub})
      }
      if (foreign) {
        if (!bubble.streaming) { piece(speech, false, bubble.text); state.closed = true }
        return
      }
      let rest = speech.slice(state.sent)
      for (let cut; (cut = bubbleSpeechCut(rest, true)) > 0;) {
        const clause = rest.slice(0, cut)
        piece(clause, true, clause.trim()); state.sent += cut; rest = rest.slice(cut)
      }
      if (!bubble.streaming) { piece(rest, false, rest.trim()); state.closed = true }
    })
    return events
  }
  return {
    feed(chunk) { if (finished) return []; source += String(chunk); return project() },
    finish() { if (finished) return []; finished = true; return project() },
    get segments() { return segments.map(row => ({...row})) },
    get count() { return segments.length },
  }
}

/** The story position a call is anchored to: the latest round, or t - the page the reader was on when the call started
 * ({turn, para}) - so the call record stands in the conversation where it
 * happened. t is checked here, once, as it enters: a round of this story up to its latest and a paragraph number. */
export function storyAnchor(chat, at) {
  const turns = (chat?.messages || []).filter(row => row?.role === 'assistant').map(row => Number(row.turn || (row.greeting ? 1 : 0))).filter(Number.isFinite)
  const branchId = text(chat?.timeline?.branchId) || 'main', latest = turns.length ? Math.max(...turns) : 0
  if (Number.isSafeInteger(at?.turn) && at.turn >= 0 && at.turn <= latest && Number.isSafeInteger(at.para) && at.para >= 1) return {branchId, turn:at.turn, para:at.para}
  return {branchId, turn:latest}
}

/** The calls with one contact that belong to the story as it now stands. */
export function visibleCalls(document, contactId, anchor) {
  return (document?.threads?.[contactId]?.calls || []).filter(call => call.anchor?.branchId === anchor.branchId && (call.anchor.turn < anchor.turn || (call.anchor.turn === anchor.turn && (!anchor.para || !call.anchor.para || call.anchor.para <= anchor.para))))
}

/** The calls of every contact on the story as it stands at `anchor`: [{contactId, call}]. */
export function storyCalls(document, anchor) {
  return Object.keys(document?.threads || {}).flatMap(contactId => visibleCalls(document, contactId, anchor).map(call => ({contactId, call})))
}

// Her pieces back as the lines she wrote (a line cut for speech is one line again).
function spokenLines(segments, contact, language) {
  const lines = []
  const foreign = contact.voiceRules?.voiceTranslates ?? languageTranslates(language)
  let said = '', mood = ''
  const line = sub => (contact.moods?.find(row => row.id === mood)?.label || '') + '|[' + (foreign ? sub || projectVoiceCues(said) : said) + ']' + (foreign ? '|[' + said + ']' : '')
  for (const row of segments) {
    mood = row.mood
    said += row.say
    if (row.part) continue
    lines.push(line(row.sub)); said = ''
  }
  if (said) lines.push(line(''))
  return lines.join('\n')
}

const utf8 = value => Buffer.byteLength(String(value || ''), 'utf8')

/** The model request of one call turn: the system prompt and this call's lines as messages. `bytes` measures each part
 * (UTF-8), so a slow first token can be told apart from a large or uncached prompt. */
export function callRequest({contact, persona, language, playerName, chat, earlier, lines, context = {}}) {
  const player = playerName || '你'
  // The one 配音语言 rule (bubble-line.cjs): display text is Chinese; a voice language other than 中文 adds voice text.
  const {voiceTranslates:foreign, voiceDirection} = contact.voiceRules || bubbleVoiceSwitches({voice:{enabled:true}}, {voice:true,voiceLang:language,voiceDirection:contact.voiceDirection})
  const variables = {player, name:contact.name}
  const moods = contact.moods || [], defaultMood = moods.find(row => row.id === contact.defaultEmotion)?.label || ''
  const voiceLanguage = LANGUAGE_NAMES[language] || language
  const format = [
    '- Write one clause per line: `variant|[text]' + (foreign ? '|[voice]' : '') + '`.',
    '- ' + (moods.length
      ? 'Choose a variant matching the emotion of the clause from: ' + moods.map(row => '`' + row.label + '`').join(', ') + '. Use `' + defaultMood + '` by default.'
      : 'Leave variant empty; no variants are available.'),
    PROMPT_PROSE.p006.replace('one sentence per marked line', 'one clause per line'),
    foreign ? '- Use Chinese display text and ' + voiceLanguage + ' voice text. Keep this voice language even when the player speaks another language.' : '- Use Chinese text with a single text field; do not append a voice field.',
    ...(foreign ? [PROMPT_PROSE.p013, PROMPT_PROSE.p014, PROMPT_PROSE.p015] : [PROMPT_PROSE.p009]),
    ...(voiceDirection ? [foreign ? PROMPT_PROSE.p020.replace('…|', 'variant|') : PROMPT_PROSE.p020.replace('voice text only', 'the single text field').replace('…|[我没事。真的……]|[{forcing calm}大丈夫。{voice starting to shake}本当に……]', 'variant|[{forcing calm}我没事。{voice starting to shake}真的……]')] : []),
    '- Each line is one subtitle clause, synthesized separately. Split clauses at pauses rather than putting the rest of the sentence on the same line.',
    '- Start with a short first reaction (at most ten Chinese characters); put the rest on new lines so you can begin speaking promptly.',
  ].join('\n')
  const examples = ['嗯。','怎么了？','谢谢你。'].map((display, index) =>
    (index === 2 ? moods.find(row => row.label !== defaultMood)?.label || defaultMood : defaultMood) + '|[' + (!foreign && voiceDirection && index === 2 ? '{small laugh}' : '') + display + ']'
    + (foreign ? '|[' + (voiceDirection && index === 2 ? '{small laugh}' : '') + (CALL_EXAMPLES[language]?.[index] || 'Same clause in ' + voiceLanguage) + ']' : '')).join('\n')
  const parts = [
    ['phone-call', [promptSection('phone_call_role', prompt('phone-call').replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key])), promptSection('call_dialogue_format', format), promptSection('examples', examples)].join('\n\n')],
    ...(context.promptSections || []).map(row => [row.name, row.text]),
  ].filter(([, text]) => text)
  const system = parts.map(([, text]) => text).join('\n\n')
  const messages = []
  for (const line of lines) {
    const content = line.role === 'player' ? line.text : spokenLines(line.segments, contact, language)
    const role = line.role === 'player' ? 'user' : 'assistant'
    if (messages.at(-1)?.role === role) messages.at(-1).content[0].text += '\n' + content
    else messages.push({role, content:[{type:'text', text:content}]})
  }
  const sections = context.turnSections || [], last = messages.at(-1)
  if (last?.role === 'user' && sections.length) last.content[0].text = [
    ...sections.filter(row => row.position === 'before').map(row => row.text),
    last.content[0].text,
    ...sections.filter(row => row.position !== 'before').map(row => row.text),
  ].join('\n\n')
  const bytes = {system:utf8(system), sections:Object.fromEntries(parts.map(([name, text]) => [name, utf8(text)])), messages:messages.reduce((sum, row) => sum + utf8(row.content[0].text), 0), turns:messages.length}
  return {system, messages, bytes}
}

/**
 * The calls of every chat, one contact at a time. `store` reads/updates one chat's call document; `model` streams one
 * turn's text; `now` and `id` are injected for tests. Each turn makes exactly one model request.
 * `hold` takes the contact's voice residency lease for the whole call (ringing to hang-up) and resolves to its release.
 * A call its page stopped answering for (`aliveMs` without any request: a reload, a closed window) ends by itself, so
 * neither the lease nor the deployment busy signal outlive it.
 */
export function createPhoneCalls({store, model, serviceState = async () => ({state:'unsupported'}), hold = async () => null, context = async () => ({}), now = Date.now, clock = () => performance.now(), id = () => Math.random().toString(36).slice(2),
  aliveMs = 75000, timer = {set:(fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t }, clear:t => clearTimeout(t)}}) {
  const calls = new Map()
  function touch(call) { timer.clear(call.expiry); call.expiry = timer.set(() => { if (calls.get(call.id) === call) void hangUp(call).catch(() => {}) }, aliveMs) }
  // Every way a call stops: its reply, its expiry and its residency lease go with it.
  function close(call) {
    stopTurn(call); timer.clear(call.expiry); calls.delete(call.id)
    void call.lease.then(release => release?.())
  }
  async function hangUp(call) { close(call); call.endedAt = now(); await persist(call) }
  const clientFields = ['origin','speechEndMs','endpointMs','endpoint','asrFinalMs','rpcSentMs','hostStartMs','clockErrorMs','ttsRequestMs','ringToFirstPcmMs','firstPcmMs','scheduledMs','audibleMs','outputLatencyMs','interruptions','stalls','backchannels','outcome']
  function readTiming(value) {
    if (value === undefined) return {}
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, n]) => !clientFields.includes(key) || typeof n !== 'number' || !Number.isFinite(n)))
      throw Object.assign(new Error('Invalid call timing'), {code:'INVALID_INPUT'})
    return value
  }
  function receipt(turn, value) { Object.assign(turn.log.client, readTiming(value)) }
  function owned(sessionId, callId) {
    const call = calls.get(callId)
    if (!call || call.sessionId !== sessionId) throw Object.assign(new Error('通话已经结束'), {code:'PHONE_CALL_GONE'})
    touch(call)
    return call
  }
  async function persist(call) {
    if (!call.lines.length && !Object.keys(call.timings).length && !call.persisted) return
    call.persisted = true
    await store.update(call.chatId, document => {
      const next = document && document.version === 1 ? document : {version:1, threads:{}}
      const thread = next.threads[call.contact.id] ||= {calls:[]}
      const record = {id:call.id, startedAt:call.startedAt, endedAt:call.endedAt || null, anchor:call.anchor, ...(call.video ? {video:true} : {}), timingModel:{slot:'dsh.phone/call', model:call.selection?.model || null, provider:call.selection?.provider || null, reasoningEffort:call.selection?.reasoningEffort || null}, timings:structuredClone(call.timings),
        lines:call.lines.map(line => line.role === 'player' ? {role:'player', text:line.text, at:line.at, ...(line.cue ? {cue:true} : {})}
          : {role:'contact', text:line.segments.map(row => projectVoiceCues(row.say)).join(''), sub:line.segments.map(row => row.sub || '').join(''), segments:line.segments, at:line.at, ...(line.interrupted ? {interrupted:true} : {})})}
      const at = thread.calls.findIndex(row => row.id === call.id)
      if (at >= 0) thread.calls[at] = record; else thread.calls.push(record)
      return next
    })
  }
  // Only an audio-clock receipt may enter the player's transcript; generated text stays in the model log.
  function acknowledge(call, turn, heard = []) {
    if (!Array.isArray(heard)) throw Object.assign(new Error('Invalid playback receipt'), {code:'INVALID_INPUT'})
    const kept = []; let previous = -1
    for (const index of heard) {
      const segment = turn.segments[index]
      if (!Number.isSafeInteger(index) || index <= previous || !segment)
        throw Object.assign(new Error('Invalid playback receipt'), {code:'INVALID_INPUT'})
      previous = index
      kept.push({...segment})
    }
    if (turn.transcript) call.lines.splice(call.lines.indexOf(turn.transcript),1)
    const complete = turn.done && heard.length === turn.segments.length
    turn.transcript = kept.length ? {role:'contact',segments:kept,at:turn.transcript?.at || now(), ...(!complete ? {interrupted:true} : {})} : null
    if (turn.transcript) call.lines.push(turn.transcript)
    return kept
  }
  function stopTurn(call) {
    const turn = call.turn
    if (turn && !turn.done) { turn.controller.abort(); turn.done = true; turn.wake() }
    return turn
  }
  return Object.freeze({
    activeCount() { return calls.size },
    /** The dialled contact's design persona, when her round has no card worldbook entries. */
    persona({sessionId,contactId}) {
      const call = [...calls.values()].find(row => row.sessionId === sessionId && row.contact.id === contactId)
      return call ? promptSection('call_contact_persona', call.persona || '') : ''
    },
    /** The page's heartbeat while a call is open (ringing included). */
    alive({sessionId, callId}) { owned(sessionId, callId); return {alive:true} },
    async start({sessionId, chat, contact, persona, language, playerName, at, origin}) {
      for (const row of [...calls.values()]) if (row.sessionId === sessionId) close(row)
      const document = await store.read(chat.id), anchor = storyAnchor(chat, at)
      const call = {id:id(), sessionId, chatId:chat.id, contact:structuredClone(contact), persona, language, playerName, anchor, startedAt:now(), endedAt:null, lines:[], turn:null, timings:{}, messages:[]}
      calls.set(call.id, call)
      // Taken as she starts ringing, never awaited by the dial; a voice without a provider to hold resolves to null.
      call.lease = hold({sessionId, contact:call.contact, origin}).catch(() => null)
      touch(call)
      try {
        const extra = await context({sessionId, chat, contact, anchor, phase:'start', calls:storyCalls(document, anchor), playerName:playerName || '你'})
        call.fixed = callRequest({contact:call.contact, language, playerName, lines:[], context:extra})
        call.selection = extra.selection
      } catch (error) { close(call); throw error }
      return {callId:call.id, contact, language, anchor}
    },
    /** The call became a FaceTime video call: its record says so. */
    async video({sessionId, callId}) {
      const call = owned(sessionId, callId)
      call.video = true
      await persist(call)
      return {video:true}
    },
    /** The player said `said`; any reply still under way goes no further. Returns the new turn's id. `note`: a quiet
     * line for the model only, before the words (the player's camera turned on or off) - never in the transcript. */
    async turn({sessionId, callId, said, chat, cue = false, note = '', timing:clientTiming}) {
      const initialTiming = readTiming(clientTiming)
      const call = owned(sessionId, callId)
      stopTurn(call)
      call.lines.push({role:'player', text:compact(said, 1200), at:now(), ...(cue ? {cue:true} : {})})
      const controller = new AbortController()
      // Where the model's time goes, per turn (poll's `timing`): context assembly, the request's first reasoning and text
      // bytes, how the text arrived (deltas), the first spoken piece and the end; token usage when the model reports it.
      const timing = {contextMs:null, requestMs:null, thinkMs:null, textMs:null, deltas:0, textEndMs:null, firstSayMs:null, totalMs:null, bytes:null, usage:null}
      const turn = call.turn = {id:id(), controller, segments:[], done:false, error:null, started:clock(), timing, waiters:new Set(), wake() { for (const fn of turn.waiters) fn(); turn.waiters.clear() }}
      turn.log = {cue:Number(cue), client:{...initialTiming}, model:timing}
      call.timings[turn.id] = turn.log
      const since = () => Math.round((clock() - turn.started) * 10) / 10
      await persist(call)
      timing.contextStartMs = since()
      let extra
      try { extra = await context({sessionId, chat, contact:call.contact, anchor:call.anchor, input:said, phase:'turn'}) }
      catch (error) { if (call.turn === turn) stopTurn(call); timing.status = 3; timing.totalMs = since(); await persist(call); throw error }
      controller.signal.throwIfAborted()
      const spoken = call.lines.at(-1), quiet = note ? {...spoken, text:note + '\n' + spoken.text} : spoken
      const assembled = callRequest({contact:call.contact, language:call.language, playerName:call.playerName, lines:[quiet], context:{turnSections:extra.turnSections}})
      const prefix = call.messages.reduce((n, row) => n + utf8(row.content[0].text), 0)
      call.messages.push(...assembled.messages)
      const request = {system:call.fixed.system, messages:structuredClone(call.messages), bytes:{...call.fixed.bytes,
        messages:prefix + assembled.bytes.messages, turns:call.messages.length,
        prefix:call.requested ? call.previousInputBytes : 0}}
      call.requested = true
      call.previousInputBytes = request.bytes.system + request.bytes.messages
      timing.contextMs = since(); timing.bytes = request.bytes
      const take = events => {
        for (const event of events) {
          if (event.type === 'say') { turn.segments[event.index] = {say:event.say, sub:null, mood:event.mood, ...(event.part ? {part:true} : {})}; timing.firstSayMs ??= since() }
          else if (turn.segments[event.index]) turn.segments[event.index].sub = event.sub
        }
        if (events.length) turn.wake()
      }
      const parser = createCallReplyParser({language:call.language, moods:call.contact.moods, defaultEmotion:call.contact.defaultEmotion, contact:call.contact, voiceTranslates:call.contact.voiceRules?.voiceTranslates})
      let whole = ''
      timing.requestMs = since()
      void model({sessionId:call.sessionId,selection:call.selection,system:request.system,messages:request.messages,signal:controller.signal,onText:chunk => {
        if (controller.signal.aborted) return
        timing.textMs ??= since(); timing.deltas++
        whole += chunk
        take(parser.feed(chunk))
      },onChunk:chunk => {
        if (chunk.type === 'block-start' && chunk.blockType === 'reasoning') timing.thinkMs ??= since()
        else if (chunk.type === 'block-end' && chunk.block?.type === 'text') timing.textEndMs = since()
        else if (chunk.type === 'usage') timing.usage = Object.fromEntries(Object.entries(chunk.usage || {}).filter(([,value]) => typeof value === 'number' && Number.isFinite(value)))
      }}).then(async () => {
        if (controller.signal.aborted) return
        take(parser.finish(whole))
        call.messages.push({role:'assistant', content:[{type:'text', text:spokenLines(parser.segments, call.contact, call.language)}]})
        turn.recorded = true
        await persist(call)
      }).catch(error => { if (!controller.signal.aborted) turn.error = String(error?.message || error) })
        .finally(async () => { turn.done = true; timing.status = controller.signal.aborted ? 2 : turn.error ? 3 : 1; timing.totalMs = since(); turn.wake(); await persist(call) }).catch(() => { turn.error = '通话计时没能保存'; turn.wake() })
      return {turnId:turn.id, elapsedMs:since()}
    },
    /** A turn's segments so far, once there are more than `says` spoken lines or `subs` subtitles (or it is done),
     * waiting up to `waitMs`. A segment is handed over as soon as its spoken line closes; its subtitle follows. */
    async poll({sessionId, callId, turnId, says = 0, subs = 0, waitMs = 8000}) {
      const call = owned(sessionId, callId), turn = call.turn
      if (!turn || turn.id !== turnId) return {segments:[], done:true, superseded:true}
      const count = () => { const rows = turn.segments.filter(Boolean); return [rows.length, rows.filter(row => row.sub !== null).length] }
      const ready = () => { const [a, b] = count(); return turn.done || a > says || b > subs }
      if (!ready() && waitMs > 0) await new Promise(resolve => { const timer = setTimeout(resolve, Math.min(waitMs, 15000)); turn.waiters.add(() => { clearTimeout(timer); resolve() }) })
      const out = []
      for (let i = 0; i < turn.segments.length; i++) { const row = turn.segments[i]; if (!row) break; out.push({index:i, say:row.say, sub:row.sub, mood:row.mood, ...(row.part ? {part:true} : {})}) }
      return {segments:out, done:turn.done, error:turn.error, timing:turn.timing}
    },
    async ttsRequested({sessionId, callId, turnId, origin}) {
      const call = owned(sessionId, callId), turn = call.turn
      if (!turn || turn.id !== turnId) return {accepted:false}
      if (!turn.serviceState) turn.serviceState = (async () => {
        const requestedAt = now()
        const state = await serviceState({sessionId, contact:call.contact, origin}).catch(() => ({state:'unavailable'}))
        turn.log.ttsService = {...state, requestedAt, observedAt:now()}
        await persist(call)
      })()
      await turn.serviceState
      return {accepted:true}
    },
    async heard({sessionId, callId, turnId, heard, timing}) {
      const call = owned(sessionId, callId), turn = call.turn
      if (!turn || turn.id !== turnId || turn.interrupted) return {accepted:false}
      receipt(turn, timing)
      acknowledge(call, turn, heard)
      await persist(call)
      return {accepted:true}
    },
    /** The player cut in: only audibly started clauses survive; none heard drops the reply.
     * `retract`: the player had not finished (the turn was started early, at a pause); their line goes too, and what
     * they say next is the whole utterance. */
    async interrupt({sessionId, callId, turnId, heard = [], retract = false, timing}) {
      const call = owned(sessionId, callId), turn = call.turn
      if (!turn || turn.id !== turnId) return {interrupted:false}
      receipt(turn, timing)
      turn.log.client.interruptions = 1
      stopTurn(call); turn.interrupted = true
      const kept = acknowledge(call, turn, retract ? [] : heard)
      if (turn.transcript) turn.transcript.interrupted = true
      if (retract && call.lines.at(-1)?.role === 'player') { call.lines.pop(); call.turn = null }
      // The audible transcript may shrink, but already sent model input never does.
      if (!turn.recorded && kept.length) call.messages.push({role:'assistant', content:[{type:'text', text:spokenLines(kept, call.contact, call.language)}]})
      call.messages.push({role:'user', content:[{type:'text', text:retract
        ? '（通话说明：刚才是句中停顿，玩家尚未说完；抢先生成的回复没有播出。以下以玩家接下来完整的一句话为准。）'
        : '（通话说明：玩家打断了回复。实际已开口的内容：' + (spokenLines(kept, call.contact, call.language) || '无') + '；其余内容没有说给玩家听，请接着听玩家说话。）'}]})
      await persist(call)
      return {interrupted:true, kept:kept.length}
    },
    async end({sessionId, callId, turnId, heard, timing}) {
      const call = calls.get(callId)
      if (!call || call.sessionId !== sessionId) return {ended:false}
      if (call.turn?.id === turnId && heard !== undefined && !call.turn.interrupted) {
        receipt(call.turn, timing)
        acknowledge(call, call.turn, heard)
      }
      await hangUp(call)
      return {ended:true, seconds:Math.round((call.endedAt - call.startedAt) / 1000), lines:call.lines.length}
    },
    /** Every contact's calls on the story as it now stands, for the phone's 电话 app (recent calls and each call's 通话记录:
     * a line's `at` gives its time into the call). */
    async threads({chat}) {
      const document = await store.read(chat.id), anchor = storyAnchor(chat), out = {}
      for (const contactId of Object.keys(document?.threads || {})) {
        const rows = visibleCalls(document, contactId, anchor)
        if (rows.length) out[contactId] = rows.map(call => ({id:call.id, startedAt:call.startedAt, endedAt:call.endedAt, turn:call.anchor.turn, ...(call.anchor.para ? {para:call.anchor.para} : {}), ...(call.video ? {video:true} : {}),
          lines:call.lines.filter(line => !line.cue).map(line => ({role:line.role, text:line.text, ...(line.sub ? {sub:line.sub} : {}), ...(line.interrupted ? {interrupted:true} : {}), ...(line.at ? {at:line.at} : {})}))}))
      }
      return {threads:out, anchor}
    },
    dispose() { for (const call of [...calls.values()]) close(call) },
  })
}
