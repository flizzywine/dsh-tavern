// Dialogue bubbles (docs/design/cast-presentation.md): the story model writes each spoken line on its own line as
// `@bubble:handle|name|variant|[text]` (an inner thought as `[*text*]`); a speaker with a 配音语言 adds the words its voice
// says, `…|[text]|[voice text]` (33/N). The one reader is bubble-line.cjs (parseBubbles), for the host (stage pages, the
// turn's cast lines) and the browser (chat speaker rows); this module maps its segments onto the cast: the 28 emotion
// names, the speaker, the voice and the narration form. Pure and import-free, so the browser includes it as is; the story
// text itself is never rewritten.

// SillyTavern's Character Expressions labels, so an ST sprite pack's file names match.
const CAST_EMOTIONS = Object.freeze({
  admiration: '钦佩', amusement: '逗乐', anger: '生气', annoyance: '烦躁', approval: '赞同', caring: '关心',
  confusion: '困惑', curiosity: '好奇', desire: '渴望', disappointment: '失望', disapproval: '不满', disgust: '嫌弃',
  embarrassment: '害羞', excitement: '兴奋', fear: '害怕', gratitude: '感激', grief: '悲痛', joy: '开心',
  love: '爱慕', nervousness: '紧张', neutral: '平静', optimism: '期待', pride: '得意', realization: '恍然',
  relief: '释然', remorse: '懊悔', sadness: '难过', surprise: '惊讶'
})
const CAST_EMOTION_BY_LABEL = new Map(Object.entries(CAST_EMOTIONS).map(([id, label]) => [label, id]))

/** A variant as one of the 28 emotion names: the name itself or its Chinese label; anything else is neutral. */
function bubbleEmotion(variant) {
  const word = String(variant ?? '').trim()
  return Object.hasOwn(CAST_EMOTIONS, word.toLowerCase()) ? word.toLowerCase() : CAST_EMOTION_BY_LABEL.get(word) || 'neutral'
}

/** A bubble segment's speaker as shown: its name, else its handle. */
function bubbleSpeaker(segment) {
  return segment.name || segment.alias
}

/**
 * What a line's voice says, '' for nothing: its voice text when the line has a voice field (unfinished or missing: '');
 * else its words, unless the speaker's voice speaks another language (`translates`: bubble-line.cjs voiceTranslates),
 * when it never says the display text.
 */
function bubbleSpeech(segment, translates) {
  if (segment.streaming) return ''
  if (segment.voiced) return segment.speech
  return translates ? '' : segment.text
}

/** The turn's spoken lines (parsed segments) in the shape of the per-turn cast data, `{ n, quote, speaker, emotion }`. */
function dialogueBubbleLines(segments) {
  return segments.filter(segment => segment.kind === 'bubble' && bubbleSpeaker(segment) && segment.text)
    .map((segment, index) => ({ n: index + 1, quote: segment.text, speaker: bubbleSpeaker(segment), emotion: bubbleEmotion(segment.mood) }))
}

/** A marked line as narration, `name：“line”` (`name：（thought）`): for a reply still streaming, or one shown without
 * speaker rows. Each stays its own paragraph, as a row would. */
function dialogueBubblePlainLine(segment) {
  const speaker = bubbleSpeaker(segment)
  const open = segment.thought ? '（' : '“', close = segment.streaming ? '' : segment.thought ? '）' : '”'
  return (speaker ? speaker + '：' : '') + open + segment.text + close
}

/** Parsed segments as narration: Markdown runs as they are, each marked line as dialogueBubblePlainLine. */
function dialogueBubblePlainText(segments) {
  return segments.map(segment => segment.kind === 'markdown' ? segment.text : dialogueBubblePlainLine(segment)).join('\n\n')
}

export { CAST_EMOTIONS, bubbleEmotion, bubbleSpeaker, bubbleSpeech, dialogueBubbleLines, dialogueBubblePlainLine, dialogueBubblePlainText }
