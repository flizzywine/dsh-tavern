// The story model's dialogue format (docs/design/cast-presentation.md): with 对话气泡 on, the story model writes each
// spoken line as a dialogue bubble naming its speaker, so no background call has to find out who spoke. The format and
// the speaker roster reach the game's model context as one update, sent again only when they change: every other turn
// keeps the cached prefix.
import { createHash } from 'node:crypto'
import { CAST_EMOTIONS } from './dialogue-bubbles.js'
import { liveContextUpdate } from './card-system-prompt.js'

const FORMAT = [
  "Mark speech and inner thoughts as below; each marked line is shown as a speech bubble under its speaker's name. Use the marked form even when the opening or card examples use bare quotes, keeping their narrative person and voice inside it.",
  '- Narration and actions: plain prose, unmarked.',
  '- Spoken line: `@bubble:handle|name|variant|[text]`, e.g. `@bubble:lin_yue|林月|开心|[你好。]`.',
  '- Inner thought: `@bubble:handle|name|variant|[*text*]`, e.g. `@bubble:ellie_hart|Ellie Hart|紧张|[*终于赶上了。*]`.',
  '- Fields: handle identifies the speaker; name is their displayed name; variant selects the expression shown with the line; text is their words.',
  '- Copy `handle|name` from the speaker roster as written, and choose one variant from the `Variants:` line. For an unlisted speaker, use their name; make a handle from a lowercase name or romanization with underscores for spaces, reuse it, and add _2, _3 for collisions.',
  "- Words a person speaks or writes, in any medium, are spoken lines under that person's handle; narrate the surrounding actions. This includes a short reply, a remote or overheard speaker, a message or note being read, and words recalled from earlier. Give each quoted sentence its own marked line with the original speaker, so the name stays visible during a recap. An unnamed speaker takes a short description as name; bare quotes show no speaker.",
  '- Line rules: one sentence per marked line; no `|`, `[` or `]` within each bracketed text field, and no backticks around the line.',
  "- Keep each character's voice: self-reference, sentence endings, verbal tics, tone and forms of address. For characters from existing works, follow how they speak in the original.",
  // Fixed examples (a mascot, a recap after narration, an unnamed overheard speaker) so speakers vary.
  section('examples', '@bubble:niangao|年糕|开心|[喵～]\nYou reread Hinata\'s message.\n@bubble:hinata|桐谷ひなた|期待|[明天见。]\nA voice whispers from the dark alley.\n@bubble:hooded_girl|兜帽少女|紧张|[别出声。]')
].join('\n')

function section(tag, text) {
  return `<${tag}>\n${text}\n</${tag}>`
}

// A handle the model copies: the first romanized alias, else the name, lowercased with underscores; _2, _3 for collisions.
function handleStem(character) {
  const readable = (character.aliases || []).find(value => /^[a-z][a-z0-9 _-]*$/i.test(value)) || character.name
  return [...String(readable).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')].slice(0, 24).join('') || 'speaker'
}

/**
 * The dialogue format with the card's speakers (`[{ name, aliases }]`, the cast of 舞台素材 and plugins). Every speaker
 * picks a variant from the 28 emotion names' labels, which the bubble reader maps back to the emotion.
 */
export function dialogueFormatText(speakers = []) {
  const taken = new Set(), names = new Set(), lines = []
  for (const character of speakers) {
    const name = String(character?.name || '').trim()
    if (!name || names.has(name)) continue
    names.add(name)
    const stem = handleStem({ ...character, name })
    let handle = stem
    for (let suffix = 2; taken.has(handle); suffix++) handle = stem + '_' + suffix
    taken.add(handle)
    lines.push('- ' + handle + '|' + name)
  }
  const roster = section('speaker_roster', 'The `Variants:` line gives the options for the speakers listed under it and for unlisted speakers.\nVariants: '
    + Object.values(CAST_EMOTIONS).join('、') + (lines.length ? '\n' + lines.join('\n') : ''))
  return section('dialogue_format', FORMAT + '\n' + roster)
}

/** The update to send before this turn's frame when the format the model sees differs from `text`; null when it is the same. */
export function dialogueFormatUpdate(session, text, pendingMessages = []) {
  text = String(text || '').trim()
  const previousText = liveContextUpdate(session, 'dialogueFormatSnapshot', pendingMessages)?.text || ''
  if (previousText === text) return null
  const version = createHash('sha256').update(text).digest('hex').slice(0, 16)
  const rendered = text
    ? `【对白格式 · ${version}】\n以下是当前完整版本，替代此前所有对白格式说明；只用于正文写作，后台任务仍遵循本轮任务协议。\n${text}`
    : `【对白格式 · ${version}】\n此前的对白格式说明全部失效：台词照常写进正文，不再加 @bubble 标记。`
  return { schemaVersion: 1, text, version, rendered }
}
