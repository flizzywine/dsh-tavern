import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

// state.cjs picks its activity rule at load time: require() under Node, an inline copy in the
// browser. A browser-only name in that fallback parses and bundles fine and only throws when a
// timer happens to run, so both branches are compared here against activity.cjs itself.

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const activity = require(path.join(ROOT, 'tavern-plugin/mods/timer/activity.cjs'))
const state = require(path.join(ROOT, 'tavern-plugin/mods/timer/state.cjs'))

const SOURCE = fs.readFileSync(path.join(ROOT, 'tavern-plugin/mods/timer/state.cjs'), 'utf8')

// No CommonJS wrapper in the browser: the body runs as a plain script with window present and
// module/require absent, which is exactly the branch the fallback serves.
function browserTimerState() {
  const sandbox = { window: {}, console }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE + '\n;globalThis.__state = { timerIsActive, formatTimer };', sandbox)
  return sandbox.__state
}

const running = { status: 'running', suspended: false, instanceId: 'timer-1', remainingMs: 5000 }
const liveActivity = { live: true, stageOpen: true, playerPaused: false }
const cases = [
  ['running timer with a live stage', running, liveActivity, true],
  ['suspended by the player', { ...running, suspended: true }, liveActivity, false],
  ['a stage that is closed', running, { ...liveActivity, stageOpen: false }, false],
  ['a paused player', running, { ...liveActivity, playerPaused: true }, false],
  ['a stage that is not live', running, { ...liveActivity, live: false }, false],
  ['a timer that stopped', { ...running, status: 'expired' }, liveActivity, false],
  ['no timer at all', null, liveActivity, false]
]

test('the browser branch loads without module or require', () => {
  const browser = browserTimerState()
  assert.equal(typeof browser.timerIsActive, 'function')
  assert.equal(browser.formatTimer(65000), '01:05:000')
})

for (const [label, timer, stageActivity, expected] of cases) {
  test('timer activity holds agree across branches: ' + label, () => {
    assert.equal(activity.timerIsActive(timer, stageActivity), expected)
    assert.equal(state.timerIsActive(timer, stageActivity), expected)
    assert.equal(browserTimerState().timerIsActive(timer, stageActivity), expected)
  })
}
