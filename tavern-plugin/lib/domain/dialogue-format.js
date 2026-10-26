// The story model's dialogue format (docs/design/cast-presentation.md): with 对话气泡 on, the story model writes each
// spoken line as a dialogue bubble naming its speaker, so no background call has to find out who spoke. The format and
// the speaker roster reach the game's model context as one update, sent again only when they change: every other turn
// keeps the cached prefix.
import { createHash } from 'node:crypto'
import { CAST_EMOTIONS } from './dialogue-bubbles.js'
import { liveContextUpdate } from './card-system-prompt.js'

// The rule that keeps a character's way of speaking; with voice text the voiced rules say it for both fields instead.
const KEEP_VOICE = "- Keep each character's voice: self-reference, sentence endings, verbal tics, tone and forms of address. For characters from existing works, follow how they speak in the original."
const FORMAT = [
  "Mark speech and inner thoughts as below; each marked line is shown as a speech bubble under its speaker's name. Use the marked form even when the opening or card examples use bare quotes, keeping their narrative person and voice inside it.",
  '- Narration and actions: plain prose, unmarked.',
  '- Spoken line: `@bubble:handle|name|variant|[text]`, e.g. `@bubble:lin_yue|林月|开心|[你好。]`.',
  '- Inner thought: `@bubble:handle|name|variant|[*text*]`, e.g. `@bubble:ellie_hart|Ellie Hart|紧张|[*终于赶上了。*]`.',
  '- Fields: handle identifies the speaker; name is their displayed name; variant selects the expression shown with the line; text is their words.',
  '- Copy `handle|name` from the speaker roster as written, and choose one variant from the `Variants:` line. For an unlisted speaker, use their name; make a handle from a lowercase name or romanization with underscores for spaces, reuse it, and add _2, _3 for collisions.',
  "- Words a person speaks or writes, in any medium, are spoken lines under that person's handle; narrate the surrounding actions. This includes a short reply, a remote or overheard speaker, a message or note being read, and words recalled from earlier. Give each quoted sentence its own marked line with the original speaker, so the name stays visible during a recap. An unnamed speaker takes a short description as name; bare quotes show no speaker.",
  '- Line rules: one sentence per marked line; no `|`, `[` or `]` within each bracketed text field, and no backticks around the line.'
]
// Fixed examples (a mascot, a recap after narration, an unnamed overheard speaker) so speakers vary.
const EXAMPLES = section('examples', '@bubble:niangao|年糕|开心|[喵～]\nYou reread Hinata\'s message.\n@bubble:hinata|桐谷ひなた|期待|[明天见。]\nA voice whispers from the dark alley.\n@bubble:hooded_girl|兜帽少女|紧张|[别出声。]')
// Speakers whose voice speaks another language (33/N): every line of theirs also carries what the voice says, in that
// language, for speech synthesis; the reader shows the display text and voices only the voice text.
const VOICED = section('voiced_bubbles', [
  "Speakers whose roster entry carries a voice language tag are voiced. Every bubble for one of these speakers, inner thoughts included, has two text fields: display text, then voice text in that speaker's voice language. Speakers without the tag keep the one-field forms above.",
  '- Spoken line with voice text: `@bubble:handle|name|variant|[display text]|[voice text]`, e.g. `@bubble:hinata|桐谷ひなた|开心|[早上好。]|[おはよう。]`.',
  '- Inner thought with voice text: `@bubble:handle|name|variant|[*display text*]|[*voice text*]`, e.g. `@bubble:hinata|桐谷ひなた|紧张|[*终于赶上了。*]|[*やっとまにあった。*]`. Asterisks wrap both fields.',
  '- Voice text says what the display text says, as natural speech in the voice language.',
  "- Keep the character's way of speaking in both fields: self-reference, sentence endings, verbal tics, tone and forms of address. For a character from an existing work, match how that character speaks in the original's voice-language version.",
  '- Voice text feeds speech synthesis, so write it with no reading ambiguity. For Japanese, write personal names, place names and proper nouns in hiragana or katakana (ひなた、きりたに、しぶや、ニャンコ); rewrite kanji words with several or rare readings in kana (今日→きょう, 一日→ついたち/いちにち, 何→なに/なん, 上手→じょうず); spell numbers as read (三人→さんにん); use no romaji, bracketed readings or emoji. Common kanji with a single reading may stay.'
].join('\n'))

// A language tag's English name for the roster (`ja` → Japanese); the tag itself when the runtime does not know it.
function languageName(tag) {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) || tag } catch { return tag }
}

function section(tag, text) {
  return `<${tag}>\n${text}\n</${tag}>`
}

// A handle the model copies: the first romanized alias, else the name, lowercased with underscores; _2, _3 for collisions.
function handleStem(character) {
  const readable = (character.aliases || []).find(value => /^[a-z][a-z0-9 _-]*$/i.test(value)) || character.name
  return [...String(readable).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')].slice(0, 24).join('') || 'speaker'
}

/**
 * The dialogue format with the card's speakers (`[{ name, aliases, voiceLanguage? }]`, the cast of 舞台素材 and plugins).
 * Every speaker picks a variant from the 28 emotion names' labels, which the bubble reader maps back to the emotion. A
 * speaker with a `voiceLanguage` (their 配音语言, given only while 配音 is on) is tagged with it, and the voiced rules join
 * the format; without any the text is byte for byte what it was.
 */
export function dialogueFormatText(speakers = []) {
  const taken = new Set(), names = new Set(), lines = []
  let voiced = false
  for (const character of speakers) {
    const name = String(character?.name || '').trim()
    if (!name || names.has(name)) continue
    names.add(name)
    const stem = handleStem({ ...character, name })
    let handle = stem
    for (let suffix = 2; taken.has(handle); suffix++) handle = stem + '_' + suffix
    taken.add(handle)
    const language = String(character.voiceLanguage || '').trim()
    if (language) voiced = true
    lines.push('- ' + handle + '|' + name + (language ? ' [Voice language: ' + languageName(language) + ']' : ''))
  }
  const roster = section('speaker_roster', 'The `Variants:` line gives the options for the speakers listed under it and for unlisted speakers.\n'
    + (voiced ? 'A `[Voice language: ...]` tag after the name gives the translation language.\n' : '') + 'Variants: '
    + Object.values(CAST_EMOTIONS).join('、') + (lines.length ? '\n' + lines.join('\n') : ''))
  return section('dialogue_format', [...FORMAT, ...(voiced ? [] : [KEEP_VOICE]), EXAMPLES, ...(voiced ? [VOICED] : []), roster].join('\n'))
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
