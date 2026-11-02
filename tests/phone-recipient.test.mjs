import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createStageTransaction} from '../tavern-plugin/lib/domain/stage-incremental.js'

const directorCommands = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs')

test('a phone message names one recipient or group, with a repair example when it does not', () => {
  const mark = {admission:{source:'phone.message'}}
  const admit = params => { const errors = []; directorCommands.checkModAdmission(mark, params, (ok, path, message) => { if (!ok) errors.push({path, message}) }); return errors }
  for (const params of [{form:'text'}, {to:'$player', thread:'club', form:'text'}]) {
    const [error] = admit(params)
    assert.equal(error.path, '$.to')
    assert.match(error.message, /phone-mark mark to=\$player form=text/)
  }
  assert.deepEqual(admit({to:'$player', form:'text'}), [])
  assert.deepEqual(admit({thread:'club', sender:'$player', form:'text'}), [])
})

test('the incremental stage tool no longer writes recipient-less phone messages', () => {
  const tx = createStageTransaction({catalog:{actors:{}, widgetsEnabled:true, phone:{units:[{kind:'line', alias:'a'}], aliases:[{alias:'a', name:'Alice'}]}}, target:{sourceKey:'legacy'}, units:1})
  const result = tx.submit({sequence:1, through:1, done:true, beats:[{at:1, ops:[{op:'phone.message', contact:'a', side:'in'}]}]})
  assert.equal(result.ok, false)
  assert.match(result.error.message, /phone-mark mark to=\$player form=text/)
})
