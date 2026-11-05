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

test('AUTO on an insert page: a picture shown within 3 s of reaching it holds 3 s on screen; one that is not is passed', () => {
  const pending = id => ({id, para:2, state:'pending', url:'', progress:null})
  // AUTO meets a picture still being drawn after its paragraph; a manual page turn passes only the ready ones, as before
  const drawing = [ready('a', 2), pending('b'), {id:'c', para:2, state:'failed', url:''}]
  assert.deepEqual(pictures.passed(drawing, 2, 3, true, true).map(item => item.id), ['a', 'b'])
  assert.deepEqual(pictures.passed(drawing, 2, 3, true, false).map(item => item.id), ['a'])
  // a text page turn with no picture between its paragraphs meets none in AUTO either: it reads on as before
  assert.deepEqual(pictures.passed(drawing, 3, 5, true, true), [])
  // the page shows a picture only once it is ready (the live state), never an empty page
  assert.equal(pictures.showable(drawing, pending('b')), null)
  assert.equal(pictures.showable([ready('b', 2)], pending('b')).url, '/p/b')
  // AUTO's next turn, ms from now: run(events) replays a page reached at 0; each event re-arms the one timer at `at`
  const run = (wait, events) => {
    let due = pictures.autoDelay(false, wait, 0)
    for (const {at, shown} of events) if (at < due) due = at + pictures.autoDelay(shown, wait, at)
    return due
  }
  // ready at once: shown as soon as it loads (0.4 s), then held 3 s, or the reader's longer wait
  assert.equal(run(1600, [{at:400, shown:true}]), 3400)
  assert.equal(run(4200, [{at:400, shown:true}]), 4600)
  // ready within the grace: drawn at 1.8 s, loaded at 2.2 s, held 3 s from there
  assert.equal(run(1600, [{at:1800, shown:false}, {at:2200, shown:true}]), 5200)
  // never ready within the grace: passed 3 s after reaching it, and a picture that shows later does not call it back
  assert.equal(run(1600, []), 3000)
  assert.equal(run(1600, [{at:1800, shown:false}]), 3000)
  assert.equal(run(1600, [{at:3500, shown:true}]), 3000)
  // the page reports the art's load (onShown) and its failure (onFailed)
  const onShown = () => {}, onFailed = () => {}
  const page = pictures.Page({picture:ready('a', 1), onShown, onFailed})
  const art = page.children.find(child => child && child.props.className === 'fork-gal-picture-art')
  assert.equal(art.props.onLoad, onShown)
  assert.equal(art.props.onError, onFailed)
  // the controller: AUTO alone meets pictures being drawn; each insert page counts from reaching it; the one timer
  // reads shown or not; text pages keep the playback clock's own wait (no picture timing there)
  const controller = readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/controller.cjs', import.meta.url), 'utf8')
  assert.match(controller, /pages\[page \+ 1\]\.para : null, true, auto\)/)
  assert.match(controller, /onShown: \(\) => setPictureShown\(insertPageKey\)/)
  assert.match(controller, /const shown = !!insertPageKey && pictureShown === insertPageKey;\n\s*const timer = setTimeout\(\(\) => go\(1, true\), stageViews\.pictures\.autoDelay\(shown, options\.configText\.autoDelay\(reading, false, ''\), Date\.now\(\) - insert\.since\)\);/)
  assert.equal(controller.match(/since:Date\.now\(\)/g).length, 3)
  assert.equal(controller.match(/stageViews\.pictures\.autoDelay\(/g).length, 1)
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

test('a late picture on the final paragraph offers a view once the end panel is open', () => {
  const items = [ready('earlier', 2), ready('last', 4), ready('already-ready', 4)]
  const pending = new Set(['earlier', 'last'])
  assert.equal(pictures.late(items, pending, 4, false).id, 'earlier')
  assert.equal(pictures.late(items, pending, 4, true).id, 'last')
  assert.equal(pictures.late(items, new Set(['last']), 4, false), null)
  assert.equal(pictures.late(items, new Set(), 4, true), null)
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
