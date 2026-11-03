// The voice-service boundary: the core and the stage reach a TTS plugin only through the contract in
// dsh-presentation-protocol/src/types/tts.d.ts (ctx.get('tts' | 'ttsClient' | 'ttsControl')), never through its files or
// its HTTP root. Ceilings are shrink-only: they may go down as code moves, never up. Generated outputs
// (tavern-plugin/lib/client.js, lib/host/**, the stage's lib/client* and lib/host/**) are excluded.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const PLUGIN = /^tavern-plugin\/packages\/dsh-(?:tavern-)?tts\//
const STAGE = 'tavern-plugin/packages/dsh-tavern-stage/'
const SOURCE_EXT = /\.(?:js|mjs|cjs|ts)$/
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s*)(['"])(\.{1,2}\/[^'"]+)\1/gm
const GENERATED = /^(?:tavern-plugin\/lib\/client\.js$|tavern-plugin\/lib\/host\/|tavern-plugin\/lib\/vendor\/|tavern-plugin\/packages\/dsh-tavern-stage\/lib\/(?:client\.js$|client\/|host\/))/

function sourcesIn(dirs) {
  const out = []
  const walk = dir => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir + '/' + entry.name
      if (entry.isDirectory()) walk(rel)
      else if (SOURCE_EXT.test(entry.name) && !GENERATED.test(rel)) out.push(rel)
    }
  }
  for (const dir of dirs) walk(dir)
  return out
}
const coreSources = () => sourcesIn(['tavern-plugin/lib', 'tavern-plugin/src', STAGE + 'lib', STAGE + 'src'])
const read = file => readFileSync(path.join(root, file), 'utf8')
const relativeTargets = file => [...read(file).matchAll(SPECIFIER)].map(match => path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2])))

test('the TTS plugin imports nothing outside itself except the protocol', () => {
  const leaving = []
  for (const file of sourcesIn(['tavern-plugin/packages/dsh-tavern-tts/src'])) for (const target of relativeTargets(file)) {
    if (!PLUGIN.test(target) && !target.startsWith('tavern-plugin/packages/dsh-presentation-protocol/')) leaving.push(`${file} -> ${target}`)
  }
  assert.deepEqual(leaving, [])
})

test('core and stage never import a TTS plugin by relative path', () => {
  const into = []
  for (const file of coreSources()) for (const target of relativeTargets(file)) if (PLUGIN.test(target)) into.push(`${file} -> ${target}`)
  assert.deepEqual(into, [])
})

test('the TTS HTTP root is not spelled outside the plugin', () => {
  assert.deepEqual(coreSources().filter(file => read(file).includes('/api/dsh-tts/v1')), [])
})

// ctx.get('tts*') call sites (the core's line reading, speakLine, is one) and core-provided tts* services
// (ttsReadingsEditor, ttsBrowserSpeech) today.
const GETS = 15, PROVIDES = 2
test('core and stage use the TTS services only within the shrink-only ceilings', () => {
  let gets = 0, provides = 0
  for (const file of coreSources()) {
    const text = read(file)
    gets += (text.match(/\.get\(\s*['"](?:tts|ttsClient|ttsControl)['"]\s*\)/g) || []).length
    provides += (text.match(/provide\(\s*['"]tts[A-Za-z]*['"]/g) || []).length
  }
  assert.ok(gets <= GETS, `ctx.get('tts*') call sites ${gets} > ${GETS}`)
  assert.ok(provides <= PROVIDES, `core provide('tts*') ${provides} > ${PROVIDES}`)
})
