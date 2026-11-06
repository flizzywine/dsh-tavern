import { projectDisplayParts } from './reply-presentation.js'
import { stripBubbleCodeQuote } from '../../src/client/bubble-line.cjs'
import { stageDisplayUnits } from './stage-display-units.js'

export function stageParagraphs(source, parts = projectDisplayParts(String(source || '')).parts, streaming = false) {
  return stageDisplayUnits(parts, stripBubbleCodeQuote, undefined, streaming)
}
