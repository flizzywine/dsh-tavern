import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import phoneStage from '../tavern-plugin/mods/phone/stage.js'

const mod = JSON.parse(await readFile(new URL('../tavern-plugin/mods/phone/mod.json', import.meta.url), 'utf8'))
const rules = mod.prompts.find(row => row.tag === 'mod_phone').markdown

// context.phone.characters as the director prepares it: card figures carry a ref, a source-only speaker does not.
const characters = [
  {alias:'f_kaguya', name:'辉夜', ref:{packId:'p', figureId:'kaguya'}},
  {alias:'f_iroha', name:'彩叶', ref:{packId:'p', figureId:'iroha'}},
  {alias:'viewer_1', name:'兔耳观众'},
]
const admit = params => phoneStage.admitParams({modId:'dsh.phone', admission:{phoneGroup:true}}, params, {}, {phone:{characters}}, {at:1}, () => {})

test('a phone group of livestream viewers is rejected at submit with the contacts it may use', () => {
  assert.throws(() => admit({thread:'live-danmaku', name:'直播间弹幕', participants:['viewer_1', 'f_kaguya']}), error => {
    assert.equal(error.code, 'ARG_INVALID')
    assert.equal(error.path, '$.participants')
    assert.match(error.message, /兔耳观众 is not a phone contact/)
    assert.match(error.next_action, /Livestream danmaku, viewer comments and posts are not; leave those lines unmarked\./)
    assert.deepEqual(error.handleChoices, ['$player', 'f_kaguya', 'f_iroha'])
    return true
  })
  assert.deepEqual(admit({thread:'home', name:'家', participants:['$player', '辉夜', 'f_iroha']}), {thread:'home', name:'家', participants:['$player', 'f_kaguya', 'f_iroha']})
})

test('a carried group of viewers takes no more messages from its source-only members', () => {
  const state = {modState:{'dsh.phone':{threads:{'live-danmaku':{id:'live-danmaku', name:'直播间弹幕', participants:['viewer_1', 'f_kaguya']}}}}}
  const units = [{kind:'line', alias:'viewer_1', name:'兔耳观众'}, {kind:'line', alias:'f_kaguya', name:'辉夜'}]
  const check = (ok, path, message) => { if (!ok) throw Object.assign(new Error(message), {path}) }
  const mark = at => phoneStage.admitParams({modId:'dsh.phone', admission:{source:'phone.message'}}, {thread:'live-danmaku', form:'text'}, state, {phone:{characters, units}}, {at}, check)
  assert.throws(() => mark(1), {path:'$.thread', message:/Livestream danmaku and viewer comments are not phone messages: leave the line unmarked\./})
  assert.deepEqual(mark(2), {thread:'live-danmaku', sender:'f_kaguya', side:'in', form:'text'})
})
