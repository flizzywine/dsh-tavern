// Dialogue bubbles (docs/design/cast-presentation.md): the story model writes each spoken line on its own line as
// `@bubble:handle|name|variant|[text]` (an inner thought as `[*text*]`); a speaker with a 配音语言 adds the words its voice
// says, `…|[text]|[voice text]` (33/N). One reader for the host (stage pages, the turn's cast lines) and the browser
// (chat speaker rows); the story text itself is never rewritten.

// SillyTavern's Character Expressions labels, so an ST sprite pack's file names match.
const CAST_EMOTIONS = Object.freeze({
  admiration: '钦佩', amusement: '逗乐', anger: '生气', annoyance: '烦躁', approval: '赞同', caring: '关心',
  confusion: '困惑', curiosity: '好奇', desire: '渴望', disappointment: '失望', disapproval: '不满', disgust: '嫌弃',
  embarrassment: '害羞', excitement: '兴奋', fear: '害怕', gratitude: '感激', grief: '悲痛', joy: '开心',
  love: '爱慕', nervousness: '紧张', neutral: '平静', optimism: '期待', pride: '得意', realization: '恍然',
  relief: '释然', remorse: '懊悔', sadness: '难过', surprise: '惊讶'
})
const CAST_EMOTION_BY_LABEL = new Map(Object.entries(CAST_EMOTIONS).map(([id, label]) => [label, id]))

const BUBBLE_LINE = /^\s*@bubble\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[(.*)\]\s*$/
// A line with a fifth field, the voice text: its display text has closed and a separator follows. The voice field may
// still be open (a live tail) or missing; a separator after it is formatting, there is no sixth field.
const BUBBLE_VOICED = /^\s*@bubble\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[([^\]\n]*)\]\s*[|｜]\s*(?:\[([^\]\n]*)(\])?)?(?:\s*[|｜])?\s*$/
// A complete line that lost its brackets: everything after the third separator is the text.
const BUBBLE_BARE = /^\s*@bubble\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*([^[\s][^\n]*?)\s*$/
// The live tail of a streaming reply whose bracket has not closed yet.
const BUBBLE_PARTIAL = /^\s*@bubble\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[(.*)$/
const BUBBLE_START = /^\s*@bubble(?:\s*[:：]|$)/
const BUBBLE_PREFIX = /^\s*@(?:b(?:u(?:b(?:b(?:l(?:e)?)?)?)?)?)?$/

/** A variant as one of the 28 emotion names: the name itself or its Chinese label; anything else is neutral. */
function bubbleEmotion(variant) {
  const word = String(variant ?? '').trim()
  return Object.hasOwn(CAST_EMOTIONS, word.toLowerCase()) ? word.toLowerCase() : CAST_EMOTION_BY_LABEL.get(word) || 'neutral'
}

// Story models sometimes wrap a whole marked line in a code quote or Markdown emphasis (`*@bubble…]*`); the markers
// outside the bracket are formatting, not text. An inner thought keeps its `[*…*]` inside the bracket.
function stripBubbleWrapping(line) {
  const opening = /^([\t ]*)(?:`{1,2}|[*_~]{1,3})(?=@bubble(?:\s*[:：]|$))/.exec(line)
  const value = opening ? opening[1] + line.slice(opening[0].length) : line
  if (!/^[\t ]*@bubble/.test(value)) return line
  return value.replace(/(\])[\t ]*[`*_~]+[\t ]*(\r?)$/, '$1$2')
}

// A line that starts with @bubble but does not parse is never shown raw: its bracketed (or last) field reads as
// narration, without the prefix.
function bubbleFallbackText(line) {
  const rest = String(line).replace(/^\s*@bubble\s*[:：]?\s*/, '')
  const bracket = /\[([^\]\n]*)(?:\]([^|｜[\n]*))?/.exec(rest), fields = rest.split(/[|｜]/)
  const text = bracket ? bracket[1].trim().replace(/^\*([\s\S]*)\*$/, '$1') + (bracket[2] || '') : fields.length > 1 ? fields[fields.length - 1] : ''
  return text.trim()
}

function bubbleSegment(match, streaming) {
  const raw = String(match[4] || '').trim()
  const thought = /^\*[\s\S]*\*$/.test(raw) || (streaming && raw.startsWith('*'))
  const handle = match[1].trim().toLowerCase(), name = match[2].trim()
  return { kind: 'bubble', handle, speaker: name || handle, variant: match[3].trim(), emotion: bubbleEmotion(match[3]),
    text: thought ? raw.replace(/^\*|\*$/g, '') : raw, thought, streaming: Boolean(streaming) }
}

// `voice`: the line's voice text, '' while it is unfinished or when the reply ended without it (never the display text).
function voicedSegment(match, live) {
  const segment = bubbleSegment(match, live)
  segment.voice = match[6] ? match[5].trim().replace(/^\*([\s\S]*)\*$/, '$1').trim() : ''
  return segment
}

/**
 * A speaker's 配音语言 as it is shown and spoken: their `voiceLanguage` (a BCP 47 tag), '' (unset) is 中文, the story's
 * language. The 配音语言 control shows this; choosing 中文 stores ''.
 */
function castVoiceLanguage(voiceLanguage) {
  return String(voiceLanguage || '').trim() || 'zh'
}

/**
 * Whether a speaker's voice needs its own voice text: their 配音语言 is not 中文, by primary subtag (`zh-CN` is 中文).
 * Only then are their lines written with voice text.
 */
function voiceTranslates(voiceLanguage) {
  return castVoiceLanguage(voiceLanguage).split('-')[0].toLowerCase() !== 'zh'
}

/**
 * What a line's voice says, '' for nothing: its voice text when it has one; else its words, unless the speaker's voice
 * speaks another language (voiceTranslates), when it never says the display text.
 */
function bubbleSpeech(segment, voiceLanguage) {
  if (segment.streaming) return ''
  if (segment.voice !== undefined) return segment.voice
  return voiceTranslates(voiceLanguage) ? '' : segment.text
}

/**
 * Split a story text into Markdown narration runs and marked lines, in reading order. `streaming`: the text is a reply
 * still being written, so its last line may be unfinished (a bubble whose bracket has not closed, or `@bub` held back).
 */
function parseDialogueBubbles(text, streaming = false) {
  const lines = String(text ?? '').split('\n')
  const segments = []
  let buffer = []
  function flush() { const markdown = buffer.join('\n'); if (markdown.trim() !== '') segments.push({ kind: 'markdown', text: markdown }); buffer = [] }
  lines.forEach((original, index) => {
    const line = stripBubbleWrapping(original), live = Boolean(streaming) && index === lines.length - 1
    const voiced = BUBBLE_VOICED.exec(line)
    if (voiced) { flush(); segments.push(voicedSegment(voiced, live)); return }
    const match = BUBBLE_LINE.exec(line) || BUBBLE_BARE.exec(line) || (live ? BUBBLE_PARTIAL.exec(line) : null)
    if (match) { flush(); segments.push(bubbleSegment(match, live)); return }
    if (live && (BUBBLE_START.test(line) || BUBBLE_PREFIX.test(line))) { flush(); return }
    if (BUBBLE_START.test(line)) {
      const fallback = bubbleFallbackText(line)
      if (fallback) buffer.push(fallback)
      return
    }
    buffer.push(original)
  })
  flush()
  return segments
}

/** The turn's spoken lines in the shape of the per-turn cast data, `{ n, quote, speaker, emotion }`. */
function dialogueBubbleLines(text) {
  return parseDialogueBubbles(text).filter(segment => segment.kind === 'bubble' && segment.speaker && segment.text)
    .map((segment, index) => ({ n: index + 1, quote: segment.text, speaker: segment.speaker, emotion: segment.emotion }))
}

/** A marked line as narration, `name：“line”` (`name：（thought）`): for a reply still streaming, or one shown without
 * speaker rows. Each stays its own paragraph, as a row would. */
function dialogueBubblePlainLine(segment) {
  const open = segment.thought ? '（' : '“', close = segment.streaming ? '' : segment.thought ? '）' : '”'
  return (segment.speaker ? segment.speaker + '：' : '') + open + segment.text + close
}

function dialogueBubblePlainText(text, streaming = false) {
  const source = String(text ?? '')
  if (!source.includes('@')) return source
  return parseDialogueBubbles(source, streaming).map(segment => segment.kind === 'markdown' ? segment.text : dialogueBubblePlainLine(segment)).join('\n\n')
}

export { CAST_EMOTIONS, bubbleEmotion, bubbleSpeech, castVoiceLanguage, voiceTranslates, parseDialogueBubbles, dialogueBubbleLines, dialogueBubblePlainLine, dialogueBubblePlainText }
