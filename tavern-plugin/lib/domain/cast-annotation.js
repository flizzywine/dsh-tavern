
// The emotion names cast material is keyed by, and a turn's spoken lines for plugins (Wiki「设计：cast-presentation」).
// Settlement no longer annotates dialogue (cast_submit retired) and annotations stored by earlier turns are no longer
// read: the lines are the round body's bubble paragraphs. Pure and import-free, so the browser includes it as is.

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

/**
 * A round body's spoken lines (round-body.js paragraphs; bubble-line.cjs reads them) in the shape of the per-turn
 * cast data, `{ n, quote, speaker, emotion }`: getCast, onCastAnnotated, getStage turns and registerTurnView.
 * The speaker is the name the line was written with, else its handle.
 */
function bubbleCastLines(body) {
  return (body?.paragraphs || []).filter(paragraph => paragraph.kind === 'line' && (paragraph.name || paragraph.alias) && paragraph.segment.text)
    .map((paragraph, index) => ({ n: index + 1, quote: paragraph.segment.text, speaker: paragraph.name || paragraph.alias, emotion: bubbleEmotion(paragraph.mood) }))
}

export { CAST_EMOTIONS, bubbleCastLines }
