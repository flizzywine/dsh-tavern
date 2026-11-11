import { stageParagraphs } from './stage-paragraphs.js'
import { parseBubbles, applyVoiceBackfill, applyNarrationBackfill, bubbleCharacter, lineVoiceLanguage, voiceBackfillKey, voiceBackfillNeeded, narrationVoiceKey, narrationBackfillNeeded } from '../../src/client/bubble-line.cjs'
import { stagePagePlain } from '../../src/client/stage-page-index.cjs'

// One host-owned body contract for director anchors, reading and voice identities.
// voiceBackfill: the round's 配音补译 record (message.voiceBackfill); a streaming round holds its unvoiced lines.
export function roundBody(parts, {chatId = '', branchId = '', turn = 0, streaming = false, pageVersion = streaming ? 2 : 1, voiceBackfill = null} = {}) {
  const displayUnits = stageParagraphs('', parts, streaming)
  if (pageVersion >= 2) for (const unit of displayUnits) unit.pageVersion = pageVersion
  const paragraphs = displayUnits.map((source, ordinal) => applyNarrationBackfill(paragraphOf(source, ordinal), voiceBackfill, streaming))
  return {streaming, displayUnits, paragraphs}
  function paragraphOf(source, ordinal) {
    const pending = streaming && ordinal === displayUnits.length - 1 && !String(parts.at(-1)?.text || '').endsWith('\n')
    const segment = source.kind === 'line' ? applyVoiceBackfill(parseBubbles(source.text, pending).find(item => item.kind === 'bubble'), voiceBackfill, streaming)
      : {kind:'markdown', text:source.text}
    return {kind:source.kind, para:ordinal + 1, paragraphId:JSON.stringify([chatId,branchId,turn,ordinal]),
      index:ordinal, source, segment, ...(source.pageVersion ? {pageVersion:source.pageVersion} : {}),
      ...(source.kind === 'line' ? {alias:segment.alias, name:segment.name, mood:segment.mood,
        text:segment.thought ? '\uff08' + segment.text + (segment.streaming ? '' : '\uff09') : segment.text,
        thought:segment.thought, pending:!!segment.streaming}
        : {block:source.text, text:stagePagePlain(source.text), pending})}
  }
}

// A streaming tail unit is final once its break arrived: a blank line after any unit (the paragraph
// split of stageDisplayUnits), or the newline ending a bubble line, which is a unit by itself.
export function streamTailClosed(text, displayUnits) {
  const tail = displayUnits.at(-1)
  return !!tail && (/\n[ \t]*\n\s*$/.test(text) || tail.kind === 'line' && /\n\s*$/.test(text))
}

/** 配音补译: the body's lines that need a voice text (the single rule is bubble-line.cjs voiceBackfillNeeded), one per key;
 * while 旁白 reads translated (config.narrator.wholeParagraph) its narration paragraphs too (narrationBackfillNeeded). */
export function voiceBackfillLines(paragraphs, config) {
  const lines = new Map()
  for (const paragraph of paragraphs || []) {
    if (config?.narrator?.wholeParagraph && narrationBackfillNeeded(paragraph)) {
      const key = narrationVoiceKey(paragraph.text)
      if (!lines.has(key)) lines.set(key, {key, name:'旁白', language:config.narrator.language, text:paragraph.text, narration:true})
      continue
    }
    if (paragraph.kind !== 'line' || paragraph.pending) continue
    const segment = paragraph.segment, character = bubbleCharacter(config, segment), language = lineVoiceLanguage(config, character, segment)
    if (!voiceBackfillNeeded(segment, language)) continue
    const key = voiceBackfillKey(segment)
    if (!lines.has(key)) lines.set(key, {key, name:String(character?.name || segment.name || segment.alias), language, text:segment.text})
  }
  return [...lines.values()]
}

/** The voice texts the body already has from its 配音补译 record, so a rerun asks only for what is missing. */
export function voiceBackfillKept(paragraphs) {
  return Object.fromEntries((paragraphs || []).flatMap(row => row.voiceBackfilled ? [[narrationVoiceKey(row.text), row.speech]] : row.segment?.voiceBackfilled ? [[voiceBackfillKey(row.segment), row.segment.speech]] : []))
}

export function replyBody(projection, chat, message = {}) {
  return roundBody(projection.parts || [{kind:projection.mode === 'html' ? 'html' : 'markdown',text:projection.text}],
    {chatId:chat.id, branchId:chat.timeline?.branchId, turn:projection.turn, pageVersion:message.stagePageVersion || 1, voiceBackfill:message.voiceBackfill || null})
}
