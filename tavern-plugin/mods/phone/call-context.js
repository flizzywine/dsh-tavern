import { promptSection } from '../../lib/domain/prompt-section.js'

export function callRecognitionContext(contact, people = []) {
  const names = [...new Set([contact.name, ...people.map(row => row.name)].filter(name => typeof name === 'string' && name.trim()))]
  return names.length ? promptSection('call_speech_recognition', "- The player's words come from speech recognition. If a misheard word sounds like one of these names and fits the context, read it as that name; if unsure, ask briefly.\n- Names: " + names.join(', ')) : ''
}

// Reuse rendered recall output, not today's worldbook or a second name matcher.
export async function callRoundWorldbook({chat, turn, recallLog, fallback}) {
  // The recall reader treats numeric zero as "latest"; a call always asks for an explicit round.
  const {log} = await recallLog.read(chat, String(turn))
  // Recall refs identify the source: entry:* is the card's bound book, not system/plugin injections.
  const texts = (log?.outputs || []).filter(output => output.ref.startsWith('entry:'))
    .map(output => output.text).filter(text => typeof text === 'string' && text.trim())
  return texts.length ? promptSection('call_round_worldbook', texts.join('\n\n')) : fallback()
}

// The phone's own story context (phone-call.md 「上下文」): the latest four rounds in full, then every phone record of
// this story in story order. Both are frozen at dial and follow the stable sections, ahead of the call's own lines.
export const CALL_STORY_ROUNDS = 4
export const phoneMark = op => op?.op === 'mod.command' && op.modId === 'dsh.phone' && op.commandId === 'mark'
/** The rounds whose director record marks a phone message (records: turn → record). */
export const phoneMarkRounds = records => [...records].flatMap(([turn, record]) => record?.binding?.mods?.sourceViews?.phone && record.entries?.some(entry => entry.ops?.some(phoneMark)) ? [turn] : [])
const label = (turn, para) => '[Round ' + turn + (para ? ', page ' + para : '') + ']'

const turnOf = row => Number(row.turn || (row.greeting ? 1 : 0))
/** The latest `count` rounds through `turn`, each with its messages: the player's input is the user messages just
 * before the round's first reply (user messages carry no round number). */
export function storyRoundMessages(messages, turn, count = CALL_STORY_ROUNDS) {
  const turns = [...new Set(messages.filter(row => row?.role === 'assistant').map(turnOf).filter(number => number && number <= turn))].sort((a, b) => a - b).slice(-count)
  const rounds = new Map(turns.map(number => [number, {turn:number, input:[], replies:[]}]))
  let pending = []
  for (const row of messages) {
    if (row?.role === 'user') { pending.push(row); continue }
    if (row?.role !== 'assistant') continue
    const round = rounds.get(turnOf(row))
    if (round) { if (!round.replies.length) round.input.push(...pending); round.replies.push(row) }
    pending = []
  }
  return [...rounds.values()]
}

/** rounds: [{turn, input, text}] oldest first - the round text as the story model reads it (projectAgentMessageText). */
export function callStorySection(rounds) {
  const body = rounds.filter(row => row.text.trim()).map(row => label(row.turn) + (row.input.trim() ? '\nPlayer: ' + row.input.trim() : '') + '\n' + row.text.trim()).join('\n\n')
  return body ? promptSection('call_recent_story', '- The latest story rounds, in full, up to this call. You know these events; do not retell them on the call.\n\n' + body) : ''
}

/** One round's phone messages: each mark through `para`, with the text of the paragraph it marks. */
export function roundPhoneMessages(turn, record, paragraphs, para) {
  return (record?.entries || []).flatMap(entry => para && entry.at > para ? [] : (entry.ops || []).filter(phoneMark).map(op => ({kind:'message', turn, para:entry.at, params:op.params, text:paragraphs[entry.at - 1]?.text || ''})))
    .filter(row => row.text.trim())
}

/**
 * Every phone record of the story as it now stands, in story order: round, then page (a call dialled without a page
 * came at the end of its round), then start time. calls: [{contactId, call}] (visible calls of every contact);
 * messages: roundPhoneMessages rows; names: id → display name ('$player' and group thread ids included).
 */
export function callPhoneRecords({calls = [], messages = [], photos = [], chatId, anchor, names = new Map(), contact, player}) {
  const name = id => id === '$player' ? player : names.get(id) || '未知联系人'
  const rows = [
    // A call nobody spoke on (rang out, hung up at once) records nothing.
    ...calls.filter(({call}) => call.lines.some(line => !line.cue)).map(({contactId, call}) => ({turn:call.anchor.turn, para:call.anchor.para, at:call.startedAt, id:call.id || '', text:label(call.anchor.turn, call.anchor.para) + ' ' + (call.video ? 'FaceTime call' : 'Phone call') + ': ' + player + ' ↔ ' + name(contactId)
      + ' (' + new Date(call.startedAt).toLocaleString('zh-CN', {hour12:false}) + ')\n'
      + call.lines.filter(line => !line.cue).map(line => (line.role === 'player' ? player : name(contactId)) + '：' + (line.sub || line.text)).join('\n')})),
    ...photos.filter(row => row.anchor?.chatId && row.anchor.chatId === chatId && anchor &&
      (row.anchor.turn < anchor.turn || row.anchor.turn === anchor.turn && (!anchor.para || row.anchor.para && row.anchor.para <= anchor.para)))
      .map(row => ({turn:row.anchor.turn, para:row.anchor.para, at:0, id:row.file,
        text:label(row.anchor.turn, row.anchor.para) + ' FaceTime photo: ' + (row.name || 'FaceTime snapshot').replace(/\s+/g, ' ').trim().slice(0, 64)})),
    ...messages.map(row => {
      const {contact:other, to, thread, sender, side, form} = row.params
      const kind = form === 'voice' ? 'Voice message' : 'Message'
      const head = thread !== undefined ? kind + ' in group 「' + name(thread) + '」 from ' + name(sender)
        : kind + ' ' + (side === 'out' ? player + ' → ' + name(other) : name(other) + ' → ' + (to ? name(to) : player))
      return {turn:row.turn, para:row.para, at:0, id:'', text:label(row.turn, row.para) + ' ' + head + '：' + row.text.trim()}
    }),
  ].sort((a, b) => a.turn - b.turn || (a.para ?? Infinity) - (b.para ?? Infinity) || a.at - b.at || a.id.localeCompare(b.id))
  return rows.length ? promptSection('call_phone_records', '- Every phone record of this story so far, in story order, each labelled with the round (and page) it happened at. ' + contact + ' knows only the records they took part in, unless the story says she was told.\n\n' + rows.map(row => row.text).join('\n\n')) : ''
}

export function callDesignPersona(design = {}) {
  return [design.identity, design.personality, design.appearance, design.speechStyle, design.narrativeRole]
    .filter(value => typeof value === 'string' && value.trim()).join('\n').slice(0, 1500)
}
