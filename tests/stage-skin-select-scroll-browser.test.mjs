// CONFIG › 画面 › 本卡皮肤 with many skins (a player could not reach the skins below the fold): the open list stays
// inside the viewport on a 1920 / 1280 screen, an iPad and a 390 phone, scrolls by wheel to its last skin without moving the
// CONFIG page behind it, and the arrow keys bring the focused skin into view.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { stageThemeCss } from './helpers/stage-theme-css.mjs'
import { stageClientPage } from './helpers/stage-client-page.mjs'

const read = path => readFile(new URL('../tavern-plugin/' + path, import.meta.url), 'utf8')
const CHOICES = [['classic', '经典'], ['crt', '显像管'], ['aero', '千禧晴空']].map(([value, label]) => ({ value, label }))
  .concat(Array.from({ length: 21 }, (_, i) => ({ value: { packId: '00000000-0000-4000-8000-000000000000', kind: 'skins', assetId: 'skin-' + i }, label: '皮肤 ' + (i + 1) })))

async function mount(page) {
  const errors = []; page.on('pageerror', error => errors.push(String(error.stack || error)))
  await page.setContent('<!doctype html><div id="app"></div>')
  await page.addStyleTag({ content: await stageThemeCss() })
  const sources = await Promise.all(['src/client/inline-field.js', 'src/client/font-picker.js'].map(read))
  // the core's one floating panel (settings-ui.js), as gal-stage.js hands it to the stage
  const settings = await read('src/client/settings-ui.js')
  sources.push(settings.slice(settings.indexOf('function floatingPanelPlace('), settings.indexOf('function HelpTip(')))
  await page.addScriptTag({ content: await browserReactScript() + `
const React=modules.react, ReactDOM=modules['react-dom'];window.React=React;window.ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
const tavernFonts={subscribe:()=>()=>{},getSnapshot:()=>0,resolve:()=>({family:'serif'}),ensure:async()=>{},list:()=>[],catalog:()=>[],override:()=>null,setOverride(){},setContext(){},context:()=>({})};
const forkUiSfx={play(){}}; function useForkUiSfxControls(){} function Icon(props){return React.createElement('svg',{className:'fork-icon',width:props.size||16,height:props.size||16});}
const ICON_PATHS={};
function HelpTip(props){return React.createElement('span',{className:'fork-help-tip'},React.createElement('button',{className:'fork-help-tip-button'},'?'));}
const rpc=async method=>method==='listMods'?{mods:[]}:{};
` + sources.join('\n') + '\n' + stageClientPage() + `
let fields=null;
const base=stageHost.options();
const client=stageClient.start({sessionInputs:()=>stageHost.sessionInputs({sessionId:'s',native:stageHost.nativeSession({sessionId:'s'}).native}),options:stageHost.options({
  configFields:{HelpTip,Segmented,Slider,ResetButton,FontPicker,InlineField,sounds:forkUiSfx,classify:type=>type===fields?.Switch?'toggle':null},
  mixer:{...base.mixer,Slider,Icon,sounds:forkUiSfx},configText:{...base.configText,FontPicker,fonts:tavernFonts},
  configAppearance:{...base.configAppearance,getComputedStyle:window.getComputedStyle.bind(window),ResetButton,Icon,FloatingPanel,sounds:forkUiSfx},
  configScreen:{...base.configScreen,rpc,Icon,sounds:forkUiSfx,useSounds:useForkUiSfxControls,sections:{}},
  skinPresentation:{...base.skinPresentation,fonts:tavernFonts}})});
if(!client.views)throw new Error('stage client did not mount: '+client.errors.map(args=>String(args[1]?.stack||args[1])).join('\\n'));
fields=client.views.configFields;
const GalConfigScreen=client.views.configScreen.Screen;
const h=React.createElement,root=modules['react-dom/client'].createRoot(document.getElementById('app'));
function Stage(){client.views.configScreen.select('screen');
 return h('div',{className:'fork-gal-stage','data-theme':'classic','data-fk-context':'stage-classic',style:{position:'fixed',inset:0}},
  h(GalConfigScreen,{key:'screen',sessionId:'s',data:{config:{stage:{theme:'classic',defaultSkin:'crt',cardSkin:'crt',skinFallback:'classic',skinChoices:${JSON.stringify(CHOICES)}}}},textSkin:{id:'classic',label:'经典'},skinHud:'auto',tests:{voice(){},sfx(){}},onClose(){}}));}
root.render(h(Stage));
` })
  await page.waitForSelector('.fork-gal-skin-trigger', { state: 'attached', timeout: 8000 }).catch(async error => {
    throw new Error(error.message + '\n' + errors.join('\n') + (await page.evaluate(() => document.body.innerHTML.slice(0, 3000))))
  })
}

const SIZES = [['desktop 1920', 1920, 1080, false], ['desktop 1280', 1280, 720, false], ['iPad', 1024, 768, true], ['phone 390', 390, 844, true]]

test('a long 本卡皮肤 list stays in the viewport, scrolls to its end and keeps the focused skin in view', { timeout: 120000 }, async t => {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] }); t.after(() => browser.close())
  for (const [name, width, height, touch] of SIZES) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await mount(page)
    await page.locator('.fork-gal-skin-trigger').scrollIntoViewIfNeeded()
    await page.locator('.fork-gal-skin-trigger').click()
    await page.waitForSelector('.fork-gal-skin-pop[data-placed]')
    await page.waitForTimeout(250)
    const geometry = () => page.evaluate(() => {
      const pop = document.querySelector('.fork-gal-skin-pop'), r = pop.getBoundingClientRect(), scroller = pop
      const options = [...pop.querySelectorAll('[role="option"]')], last = options.at(-1).getBoundingClientRect()
      const page = document.querySelector('.fork-gal-config-page')
      return { top: r.top, bottom: r.bottom, scrollTop: scroller.scrollTop, scrollable: scroller.scrollHeight - scroller.clientHeight, lastTop: last.top, lastBottom: last.bottom,
        listBottom: scroller.getBoundingClientRect().bottom, pageScroll: page ? page.scrollTop : 0, focused: document.activeElement?.textContent || '' }
    })
    const before = await geometry()
    assert.ok(before.top >= 0 && before.bottom <= height, `${name}: the list is inside the viewport ${JSON.stringify(before)}`)
    assert.ok(before.scrollable > 0, `${name}: the long list scrolls inside itself ${JSON.stringify(before)}`)
    // wheel over the list to its end
    const box = await page.locator('.fork-gal-skin-pop').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 200)
    await page.waitForTimeout(400)
    const wheeled = await geometry()
    assert.ok(Math.abs(wheeled.scrollTop - wheeled.scrollable) <= 1, `${name}: the wheel reaches the last skin ${JSON.stringify(wheeled)}`)
    assert.ok(wheeled.lastBottom <= wheeled.listBottom + 1, `${name}: the last skin is shown ${JSON.stringify(wheeled)}`)
    assert.equal(wheeled.pageScroll, before.pageScroll, `${name}: the CONFIG page behind does not move`)
    // SKIN_SCROLL_SHOTS=DIR keeps the scrolled-to-the-end view of each size for review
    if (process.env.SKIN_SCROLL_SHOTS) await page.screenshot({ path: `${process.env.SKIN_SCROLL_SHOTS}/${name.replace(/ /g, '-')}.png` })
    // keys: Home goes to the top, End to the last skin, both in view
    await page.keyboard.press('Home'); await page.waitForTimeout(250)
    const home = await geometry()
    assert.ok(home.scrollTop <= 1 && home.focused.includes('经典'), `${name}: Home shows the first skin ${JSON.stringify(home)}`)
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(250)
    const wrapped = await geometry()
    assert.ok(wrapped.focused.includes('皮肤 21') && wrapped.lastBottom <= wrapped.listBottom + 1, `${name}: ArrowUp from the first wraps to the last, in view ${JSON.stringify(wrapped)}`)
    assert.deepEqual(errors, [])
    await context.close()
  }
})
