import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const {startStageClientLifetime} = require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/lifetime.cjs')

test('client lifetime rolls back all resources in reverse order and preserves both failures', () => {
  const calls = []
  let active
  assert.throws(() => startStageClientLifetime(scope => {
    active = scope.active
    scope.own(() => calls.push('first'))
    scope.own(() => {calls.push('second'); throw new Error('cleanup')})
    throw new Error('startup')
  }), error => error.errors[0].message === 'startup' && error.errors[1].errors[0].message === 'cleanup')
  assert.deepEqual(calls, ['second','first'])
  assert.equal(active(), false)
})

test('client lifetime disposes once and immediately releases late resources', () => {
  let own, count = 0
  const dispose = startStageClientLifetime(scope => {own = scope.own; own(() => count++)})
  dispose(); dispose()
  own(() => count++)
  assert.equal(count, 2)
})

for (const phase of ['director','session']) test(`real stage binding rolls back failure during ${phase} startup`, () => {
  const calls = [], window = {}
  const environment = {
    stageDecodeImage() {}, window, STAGE_HISTORY_SETTLE_MS:1000, startStageClientLifetime,
    forkForeground:{}, stageViews:{progress:{store:{}}}, liveTavernView:{}, tavernCoordination:{}, bubbleStore:{}, tavernStoryTurnForDshTurn() {},
    createSkinOverlayLoader: () => () => {},
    createStageResourceOwner: () => ({dispose: () => calls.push('assets')}),
    createStageResourceRunner: () => ({dispose: () => calls.push('runner')}),
    createStageDirectorSource: () => {
      if (phase === 'director') throw new Error('director failed')
      return {dispose: () => calls.push('director')}
    },
    createStageSessionOwner: () => ({start() {throw new Error('session failed')}, dispose: () => calls.push('session')}),
  }
  const source = readFileSync(new URL('../tavern-plugin/src/client/stage-session-binding.js', import.meta.url), 'utf8')
  const sessions = vm.runInNewContext(source + '\nstageSessions', environment)
  assert.throws(() => sessions.start({sessions:{}}), new RegExp(phase + ' failed'))
  assert.deepEqual(calls, phase === 'director' ? ['runner','assets'] : ['session','director','runner','assets'])
  assert.equal(sessions.owner, null)
  assert.equal(sessions.resourceOwner, null)
  assert.equal(window.forkStageResourceDebug, undefined)
})
