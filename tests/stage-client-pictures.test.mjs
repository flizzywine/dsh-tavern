import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {pluginAnchorInsertion} from '../tavern-plugin/lib/domain/plugin-text-segments.js'

const require = createRequire(import.meta.url)
const {createStagePictures} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/pictures.cjs')
const {createStageNotices} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/notices.cjs')
const h = (type, props, ...children) => ({type, props, children})
const pictures = createStagePictures({React:{createElement:h}})
const ready = (id, para) => ({id, para, state:'ready', url:'/p/' + id, caption:''})

test('insert pages: a page turn passes the ready pictures between the paragraphs it leaves and reaches', () => {
  const items = [ready('a', 2), ready('b', 4), {id:'c', para:4, state:'pending', url:'', progress:null}, ready('d', 7), {id:'e', para:3, state:'failed', url:''}]
  // forward off paragraph 2 to 5: the pictures after 2 and 4 (3's failed one never shows)
  assert.deepEqual(pictures.passed(items, 2, 5, true).map(item => item.id), ['a', 'b'])
  // the same long paragraph over two pages passes none
  assert.deepEqual(pictures.passed(items, 4, 4, true), [])
  // past the round's last page: everything from that paragraph on, the unmatched ones placed last included
  assert.deepEqual(pictures.passed(items, 5, null, true).map(item => item.id), ['d'])
  // back from 5 to 2: met in reverse, and the one after 5 is not passed
  assert.deepEqual(pictures.passed(items, 5, 2, false).map(item => item.id), ['b', 'a'])
})

test('the 正在生成 CG notice shows a number only once the plugin reports one', () => {
  assert.equal(pictures.working({items:[ready('a', 1)], planning:false}), null)
  assert.deepEqual(pictures.working({items:[], planning:true}), {progress:null})
  assert.deepEqual(pictures.working({items:[{id:'p', para:1, state:'pending', progress:null}]}), {progress:null})
  assert.deepEqual(pictures.working({items:[{id:'p', para:1, state:'pending', progress:0.27}, {id:'q', para:2, state:'pending', progress:0.6}]}), {progress:0.27})
  const notices = createStageNotices({React:{createElement:h}, document:{body:{classList:{contains:() => false}}}, Spinner:() => null})
  const text = value => JSON.stringify(notices.Status({picture:value}))
  assert.match(text({progress:null}), /正在生成 CG…"/)
  assert.match(text({progress:0.27}), /正在生成 CG… 27%/)
})

test('a picture follows the first host paragraph holding its anchor sentence, else the round\'s last', () => {
  const source = readFileSync(new URL('../tavern-plugin/src/client/stage-scene-images.js', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('function stagePicturePara'), source.indexOf('// { items:'))
  const stagePicturePara = new Function('pluginAnchorInsertion', body + '\nreturn stagePicturePara')(pluginAnchorInsertion)
  const units = [{para:1, text:'雨下得很大。\r\n她站在**天台**边上。'}, {para:2, text:'@小雪：「你来了。」'}, {para:3, text:'风把伞吹歪了。'}]
  assert.equal(stagePicturePara(units, '她站在天台边上。'), 1)
  assert.equal(stagePicturePara(units, '你来了'), 2)
  assert.equal(stagePicturePara(units, '没有这句话'), 3)
  assert.equal(stagePicturePara([], '没有这句话'), 1)
})
