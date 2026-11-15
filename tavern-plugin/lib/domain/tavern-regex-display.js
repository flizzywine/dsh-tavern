import { createTavernRegexEngine } from './tavern-regex-engine.js'

// Host projections and Helper iframes use the same replacement implementation.
const { applyTavernRegexText } = createTavernRegexEngine()

export { applyTavernRegexText }
