// The core stage effects - one definition per id, one resolver
// (card-local > skin > engine, merged field by field), one safety policy and the stage-wide flash gate, and the timing
// functions every player shares (scene beats, performance timelines, keyframe flash layers, dice, CG).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const fx = require('../tavern-plugin/src/client/stage-effects.cjs')
const commands = require('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs')
test('heartbeat, glitch and look fades follow the policy', () => {
  const pulse = fx.STAGE_EFFECTS.heartbeat
  assert.ok(fx.stagePulseAt(pulse, 80, false).zoom > 0)
  assert.equal(fx.stagePulseAt(pulse, 80, true).zoom, 0, '减少动态 keeps the vignette, drops the zoom')
  assert.ok(fx.stagePulseAt(pulse, 80, true).vignette > 0)
  assert.equal(fx.stagePulseAt(pulse, pulse.ms, false).done, true)
  assert.equal(fx.stageGlitchAt(fx.STAGE_EFFECTS.glitch, 10).strength, 1)
  assert.equal(fx.stageGlitchAt(fx.STAGE_EFFECTS.glitch, 420).done, true)
  const memory = fx.STAGE_EFFECTS.memory
  assert.equal(fx.stageLookFadeMs(memory, true, { photosensitive: false }, false), 600)
  assert.equal(fx.stageLookFadeMs(memory, false, { reducedMotion: true }, false), 150)
  assert.equal(fx.stageLookFadeMs(memory, true, { photosensitive: false }, true), 150, 'skipping')
  assert.equal(fx.stageLookFadeMs({ fade: [0.1, 0.1] }, true, { photosensitive: true }, false), 300, 'a brightness jump never faster than .3 s')
})
