// Both the local worker and this host load the same versioned, non-secret file.
import { readFileSync } from 'node:fs'
import { createReadingLexicon } from './domain/voice-readings.js'

export const speechReadings = createReadingLexicon(readFileSync(new URL('../../scripts/tts/readings/ja.json', import.meta.url)))
console.info('[voice-readings] version=%s sha256=%s', speechReadings.version, speechReadings.sha256)
