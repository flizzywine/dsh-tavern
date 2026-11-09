import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const kernel = require('../tavern-plugin/src/client/stage-runtime.cjs')
const {stageBlockPages, stagePageHeldTail} = require('../tavern-plugin/src/client/stage-page-index.cjs')
const factory = (file, name) => vm.runInNewContext(readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client/' + file, import.meta.url), 'utf8') + '\n' + name, {})
const {createStageSessionRuntime} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/session-runtime.cjs')
const runtime = createStageSessionRuntime({kernel, createStoreModule: factory('runtime-store.cjs', 'createStageRuntimeStoreModule'), createSessionModule: factory('session.cjs', 'createStageSessionModule')})
test.after(() => runtime.dispose())


test('a streaming page holds back the short tail that version-2 pagination merges into it', () => {
  const head = 'あ'.repeat(60) + '。' + 'い'.repeat(60) + '。', tail = 'う'.repeat(20) + '。'
  assert.deepEqual(stageBlockPages(head + tail, 2), [head + tail], 'the short tail is merged into the page')
  assert.equal(stageBlockPages(head + tail + 'え'.repeat(30) + '。', 2).length, 2, 'past a third of a page it splits off again')
  assert.equal(stagePageHeldTail(head + tail), tail, 'so the stage does not show it on this page yet')
  assert.equal(stagePageHeldTail(head), '', 'a page the version-1 split keeps whole holds nothing back')
})
