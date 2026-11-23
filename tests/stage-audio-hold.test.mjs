import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/src/client/stage-audio.js', import.meta.url), 'utf8')
const start = source.indexOf('function holdAudioParam(')
const holdAudioParam = vm.runInNewContext('(' + source.slice(start, source.indexOf('\n}\n', start) + 2) + ')')
const param = value => ({value, calls: [], cancelScheduledValues(t) { this.calls.push(['cancel', t]) }, setValueAtTime(v, t) { this.calls.push(['set', v, t]) }})

test('a browser with cancelAndHoldAtTime holds a glide in progress with it', () => {
  const gain = {...param(0.5), cancelAndHoldAtTime(t) { this.calls.push(['hold', t]) }}
  holdAudioParam(gain, 2)
  assert.deepEqual(gain.calls, [['hold', 2]])
})

test('without cancelAndHoldAtTime (Firefox) the current value is pinned before the next target', () => {
  const gain = param(0.63)
  holdAudioParam(gain, 1.5)
  assert.deepEqual(gain.calls, [['cancel', 1.5], ['set', 0.63, 1.5]])
})
