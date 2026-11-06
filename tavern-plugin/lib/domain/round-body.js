import { stageParagraphs } from './stage-paragraphs.js'
import { parseBubbles } from '../../src/client/bubble-line.cjs'
import { stagePagePlain } from '../../src/client/stage-page-index.cjs'

// One host-owned body contract for director anchors, reading and voice identities.
export function roundBody(parts, {chatId = '', branchId = '', turn = 0, streaming = false, pageVersion = streaming ? 2 : 1} = {}) {
  const displayUnits = stageParagraphs('', parts, streaming)
  if (pageVersion >= 2) for (const unit of displayUnits) unit.pageVersion = pageVersion
  const paragraphs = displayUnits.map((source, ordinal) => {
    const pending = streaming && ordinal === displayUnits.length - 1 && !String(parts.at(-1)?.text || '').endsWith('\n')
    const segment = source.kind === 'line' ? parseBubbles(source.text, pending).find(item => item.kind === 'bubble')
      : {kind:'markdown', text:source.text}
    return {kind:source.kind, para:ordinal + 1, paragraphId:JSON.stringify([chatId,branchId,turn,ordinal]),
      index:ordinal, source, segment, ...(source.pageVersion ? {pageVersion:source.pageVersion} : {}),
      ...(source.kind === 'line' ? {alias:segment.alias, name:segment.name, mood:segment.mood,
        text:segment.thought ? '\uff08' + segment.text + (segment.streaming ? '' : '\uff09') : segment.text,
        thought:segment.thought, pending:!!segment.streaming}
        : {block:source.text, text:stagePagePlain(source.text), pending})}
  })
  return {streaming, displayUnits, paragraphs}
}

// A streaming tail unit is final once its break arrived: a blank line after any unit (the paragraph
// split of stageDisplayUnits), or the newline ending a bubble line, which is a unit by itself.
export function streamTailClosed(text, displayUnits) {
  const tail = displayUnits.at(-1)
  return !!tail && (/\n[ \t]*\n\s*$/.test(text) || tail.kind === 'line' && /\n\s*$/.test(text))
}

export function replyBody(projection, chat, message = {}) {
  return roundBody(projection.parts || [{kind:projection.mode === 'html' ? 'html' : 'markdown',text:projection.text}],
    {chatId:chat.id, branchId:chat.timeline?.branchId, turn:projection.turn, pageVersion:message.stagePageVersion || 1})
}
