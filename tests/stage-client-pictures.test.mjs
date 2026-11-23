import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {mountedStageShell} from './helpers/mounted-stage-shell.mjs'
import {stageThemeCss} from './helpers/stage-theme-css.mjs'
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

test('AUTO on an insert page: a picture shown within 3 s of reaching it holds 6.5 s on screen; one that is not is passed', () => {
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
  // ready at once: shown as soon as it loads (0.4 s), then held 6.5 s, or the reader's longer wait
  assert.equal(run(1600, [{at:400, shown:true}]), 6900)
  assert.equal(run(8000, [{at:400, shown:true}]), 8400)
  // ready within the grace: drawn at 1.8 s, loaded at 2.2 s, held 6.5 s from there
  assert.equal(run(1600, [{at:1800, shown:false}, {at:2200, shown:true}]), 8700)
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
  assert.match(controller, /const shown = !!insertPageKey && pictureShown === insertPageKey;\r?\n\s*const timer = setTimeout\(\(\) => go\(1, true\), stageViews\.pictures\.autoDelay\(shown, options\.configText\.autoDelay\(reading, false, ''\), Date\.now\(\) - insert\.since\)\);/)
  assert.equal(controller.match(/since:Date\.now\(\)/g).length, 3)
  assert.equal(controller.match(/stageViews\.pictures\.autoDelay\(/g).length, 1)
})

test('a leaving insert page fades out without exposing controls', () => {
  const leaving = pictures.Page({picture:ready('a', 1), leaving:true})
  assert.match(leaving.props.className, /is-leaving/)
  assert.equal(leaving.props['aria-hidden'], true)
  assert.equal(leaving.children.filter(Boolean).length, 2)
  const controller = readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/controller.cjs', import.meta.url), 'utf8')
  assert.match(controller, /setTimeout\(\(\) => setPictureLate\(null\), 24000\)/)
})

// The mounted stage uses the same page input, AUTO timer and CSS as a chat. Only the CG source is supplied by the fixture.
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><path fill="white" d="M0 0h800v450H0z"/></svg>')
const pictureFixture = `window.stageShellOptions=host=>({controller:{...host.options().controller,pictures:{use:()=>({items:[${JSON.stringify({ ...ready('a', 1), url:art, caption:'天台上的约定' })}]})}}});`

async function openPictureStage(browser, {width, height, mobile = false}) {
  const context = await browser.newContext({viewport:{width, height}, isMobile:mobile, hasTouch:mobile})
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.stack || error.message))
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({contentType:'text/html', body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'})
    : route.abort())
  await page.goto('https://stage.test/')
  await page.addStyleTag({content:await stageThemeCss()
    + '\nmain{position:fixed;inset:0}.fork-gal-stage{position:absolute;inset:0}.fork-gal-picture-art{animation:none!important}'})
  await page.exposeFunction('hostDirection', () => ({phase:'off', revision:0, generation:0, token:null}))
  await page.exposeFunction('hostProjection', () => { throw Error('Director is off') })
  await page.exposeFunction('hostLease', () => { throw Error('No media') })
  const settings = readFileSync(new URL('../tavern-plugin/src/client/settings-ui.js', import.meta.url), 'utf8')
  const icons = settings.slice(settings.indexOf('const ICON_PATHS'), settings.indexOf('// Foldable settings sections'))
  await page.addScriptTag({content:await browserReactScript()
    + ';const React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};'
    + icons + '\nwindow.stageHostIcon=Icon;'
    + 'window.stageShellConfig={characters:[],voice:{enabled:false},stage:{face:"off",music:false,theme:"classic"}};'
    + pictureFixture + mountedStageShell()})
  return {page, context, errors}
}

test('insert page: manual click and Space advance; AUTO can pause and resume without changing pages', {timeout:30000}, async () => {
  const browser = await chromium.launch({headless:true, args:['--mute-audio']})
  try {
    for (const viewport of [{width:1280,height:720}, {width:375,height:812,mobile:true}]) {
      const {page,context,errors} = await openPictureStage(browser, viewport)
      try {
        page.setDefaultTimeout(5000)
        const stage = page.locator('.fork-gal-stage'), picture = stage.locator('.fork-gal-picture-page:not(.is-leaving)')
        const caption = picture.locator('figcaption'), next = picture.getByText('点击继续'), pause = picture.getByRole('button', {name:'暂停自动播放'})
        const resume = picture.getByRole('button', {name:'恢复自动播放'})
        const art = picture.locator('.fork-gal-picture-art')
        // The fixture exposes the dialogue before the production entry gate accepts input.
        await page.locator('.fork-gal-stage[data-entry="ready"] .fork-gal-text .fork-gal-next:not(.is-waiting)').waitFor()
        await page.keyboard.press('Space')
        await next.waitFor()
        assert.equal(await picture.getByRole('button').count(), 0)
        assert.notEqual(await next.locator('.fork-gal-next').evaluate(el => getComputedStyle(el).clipPath), 'none')
        await (viewport.mobile ? art.tap() : art.click())
        await picture.waitFor({state:'detached'})
        await page.keyboard.press('ArrowLeft')
        await next.waitFor()
        await page.clock.install()
        await page.keyboard.press('a')
        await pause.waitFor()
        assert.equal(await next.count(), 0)
        const button = await pause.boundingBox(), title = await caption.boundingBox()
        assert.ok(button.width >= 44 && button.height >= 44 && button.x + button.width <= viewport.width)
        assert.ok(title.x + title.width <= button.x && Math.abs(title.y + title.height / 2 - button.y - button.height / 2) < 1)
        assert.equal(await pause.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
        assert.ok(await pause.locator('svg path').getAttribute('d'))
        if (viewport.mobile) await pause.tap()
        else {
          // The core marks keyboard navigation; the fixture mounts only the stage.
          await page.evaluate(() => document.documentElement.setAttribute('data-fork-keynav', ''))
          await pause.focus()
          assert.equal(await pause.evaluate(el => getComputedStyle(el).outlineStyle), 'solid')
          await page.keyboard.press('Enter')
        }
        await resume.waitFor()
        assert.equal(await picture.getByRole('status').textContent(), '已暂停')
        await page.clock.runFor(7000)
        assert.equal(await resume.count(), 1)
        await (viewport.mobile ? resume.tap() : resume.click())
        await pause.waitFor()
        if (viewport.mobile) {
          await page.clock.runFor(7000)
          await picture.waitFor({state:'detached'})
        } else {
          await page.keyboard.press('Space')
          await picture.waitFor({state:'detached'})
          await page.keyboard.press('ArrowLeft')
          await next.waitFor() // Space went back to the dialogue and ended AUTO.
          await page.keyboard.press('a')
          await pause.waitFor()
          await art.click()
          await picture.waitFor({state:'detached'})
          await page.keyboard.press('ArrowLeft')
          await next.waitFor() // Clicking the artwork also advances and ends AUTO.
        }
        assert.deepEqual(errors, [])
      } finally { await context.close() }
    }
  } finally { await browser.close() }
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
