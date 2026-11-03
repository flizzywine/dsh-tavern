// bubble-line.cjs includes the protocol's voice cues (`// @include-protocol voice-cues.cjs`); tests that run its raw
// source in a page or vm expand that line as the client build does.
import {readFileSync} from 'node:fs'
const source = readFileSync(new URL('../../tavern-plugin/packages/dsh-presentation-protocol/src/voice-cues.cjs', import.meta.url), 'utf8')
export const withVoiceCues = text => String(text).replace('// @include-protocol voice-cues.cjs', () => source)
