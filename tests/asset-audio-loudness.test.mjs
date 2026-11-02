import test from 'node:test'
import assert from 'node:assert/strict'
import {authorAudioLoudness} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/audio-loudness.js'

// An editor save sends entries without their measurement; unchanged media keeps the entry's stored loudness (no new
// measurement, no new revision), while a legacy entry sharing the same media is not migrated by it.
test('republication retains entry loudness without migrating legacy siblings sharing media', async () => {
  const level = {v:1,lufs:-23,peak:-4}
  const previous = {manifest:{blobs:{tone:{ext:'wav'}},assets:[
    {kind:'music',id:'legacy',media:'tone'},
    {kind:'music',id:'measured',media:'tone',loudness:level}
  ]}}
  const manifest = structuredClone(previous.manifest)
  delete manifest.assets[1].loudness
  await authorAudioLoudness(manifest,new Map(),{previous,measure:async () => {throw Error('unchanged media must not be measured')}})
  assert.deepEqual(manifest,previous.manifest)
})