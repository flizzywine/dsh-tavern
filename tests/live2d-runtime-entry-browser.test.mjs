// The Live2D runtime entry (stage cubism-core.cjs over the core's spine-runtime-entry.js): real React + browser, fake RPC and a fake renderer; no remote Core.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import surfaces from '../tavern-plugin/src/client/surfaces.cjs'
const source = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
// the core stylesheets the settings page and the asset library draw with (surfaces.js injects its table at startup)
const themeCss = async () => (await Promise.all(['tavern.css', 'theme.css'].map(name => readFile(new URL('../tavern-plugin/lib/client-assets/' + name, import.meta.url), 'utf8')))).join('\n') + '\n' + surfaces.css()
const stageSource = name => readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/' + name, import.meta.url), 'utf8')

// one button, the licence dialog, then the host downloads; a failed download takes dropped official files.
test('missing runtime is quiet; licence dialog, failed download with drop fallback, then a download restores mounted previews', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const pixi = await source('pixi-runtime.js'), runtime = await stageSource('live2d.cjs'), figures = await stageSource('live2d-figures.cjs'), settingsUi = await source('settings-ui.js')
  const scripts = await browserReactScript() + '\nconst React=modules.react,ReactDOM=modules["react-dom/client"];\n' +
    await source('spinner.js') + '\n' + settingsUi.slice(settingsUi.indexOf('function floatingPanelPlace'), settingsUi.indexOf('function HelpTip')) +
    settingsUi.slice(settingsUi.indexOf('function HelpTip')).split('\nfunction ')[0] + '\n' + await source('spine-runtime-entry.js') + '\n' + await stageSource('cubism-core.cjs') + '\n' +
    pixi.slice(pixi.indexOf('let pixiRuntime'), pixi.indexOf('const forkLipSync')) + '\n' + runtime.slice(runtime.indexOf('let live2dRuntimeLoad'), runtime.indexOf('function live2dLoadError')) + '\n' + await readFile(new URL('../tavern-plugin/shared/canvas-resolution.cjs', import.meta.url), 'utf8') + '\n' + await stageSource('live2d-preview.cjs') + '\n' + figures
  for (const width of [1200, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 812 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
    await page.route('**/*', route => route.abort())
    await page.setContent('<div id="root"></div>')
    await page.addStyleTag({ content: await themeCss() + '\nbody{margin:0} #settings{padding:16px} #preview{position:relative;width:260px;height:280px}' })
    await page.addScriptTag({ content: scripts + `
      window.calls=[];window.opened=0;window.leasesClosed=0;window.loads=0;window.fail=true;window.present=false;
      window.stageCores=[];const originalScene={core:'',figures:[]};
      loadPixiRuntime=async()=>({});
      // The stage's Live2D renderer reads the user's import (runtime.core) each frame; it never edits the scene.
      const stageFigures=createStageLive2dFigures({window,math:{galTextureOwners:()=>({})},idle:{},tap:{},lipSync:{},
        runtime:{loadLive2dRuntime:async core=>{stageCores.push(core);},live2dUseContext(){},live2dDropContext(){},core:()=>forkCubismCore.core}});
      const stageRenderer=stageFigures.renderer({PIXI:{},app:{renderer:{gl:{},on(){},off(){}}},state:{},onError(){}});
      setInterval(()=>stageRenderer.set(originalScene),20);
      window.display=false;async function rpc(method,args){calls.push({method,args});if(method==='downloadLive2dRuntime'){
        if(args.consent!==true)throw Error('bad download');
        await new Promise(r=>setTimeout(r,250));if(fail)throw Error('下载 Cubism Core 失败（连接超时）');present=display=true;
      }else if(method==='importLive2dRuntime'){
        if(args.consent!==true)throw Error('bad import');
        if(args.name==='live2dcubismcore.min.js'&&atob(args.base64)==='var Live2DCubismCore={};')present=true;else throw Error('bad file');
      }else if(method!=='getLive2dRuntime')throw Error('unexpected '+method);
      return {core:present?'/core.js':'',display:display?'/display.js':'',installed:present&&display,coreInstalled:present,displayInstalled:display,
        missing:[...(present?[]:['core']),...(display?[]:['display'])],
        downloadUrl:'https://www.live2d.com/en/sdk/download/web/',licenseUrl:'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html',
        displayDownloadUrl:'https://github.com/guansss/pixi-live2d-display/releases/tag/v0.4.0',displayLicenseUrl:'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html'};}
      const source={identity:'test/model',open:async()=>{opened++;return {url:'/model.json',core:'',close(){leasesClosed++;}};}};
      const nativeLoad=loadLive2dRuntime;
      loadLive2dRuntime=async core=>{if(!core&&!forkCubismCore.core)return nativeLoad(core);loads++;return {Application:function(){
        const app={view:document.createElement('canvas'),screen:{width:200,height:240},renderer:{gl:{},on(){},once(_,fn){queueMicrotask(fn)}},
          stage:{addChild(){}},ticker:{add(fn){setTimeout(fn,20)},start(){},stop(){}},destroy(){}};return app;},
        live2d:{Live2DModel:{from:async()=>({scale:{set(){}},destroy(){},internalModel:{coreModel:{},settings:{motions:{},expressions:[]},motionManager:{groups:{}},originalWidth:200,originalHeight:400}})}}};};
      function live2dUseContext(){} function live2dDropContext(){} function live2dStartIdle(){}
      ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(React.Fragment,null,
        React.createElement('div',{id:'settings'},React.createElement(CubismCoreEntry,{request:rpc})),
        React.createElement('div',{id:'preview'},React.createElement(Live2dFigurePreview,{source,fallback:React.createElement('span',null,'静态立绘')}))));
    ` })
    await page.waitForSelector('[data-status="missing"]')
    assert.equal(await page.locator('#preview').getByText('静态立绘', { exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => loads), 0)
    assert.equal(await page.evaluate(() => leasesClosed), 1, 'missing preview releases its lease')
    assert.deepEqual(await page.evaluate(() => live2dSnapshots.request(source, ['neutral'])), {})
    assert.equal(await page.evaluate(() => leasesClosed), 2, 'missing snapshots also release their lease')
    assert.deepEqual(await page.evaluate(() => calls.map(c => c.method).filter(m => m !== 'getLive2dRuntime')), [])
    // the official pages appear only once a download has failed; never a file picker.
    assert.equal(await page.locator('#settings .fork-runtime-link').count(), 0)
    assert.equal(await page.locator('input[type=file]').count(), 0)
    // C1: the licence pages are links in the (?), reachable from it with Tab.
    await page.locator('#settings .fork-help-tip-button').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.href), 'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html')
    assert.deepEqual(await page.locator('.fork-help-tip-body.is-interactive a').evaluateAll(links => links.map(a => a.href)),
      ['https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html', 'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html'])
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.fork-help-tip-body').count(), 0)
    assert.equal(await page.locator('#preview .fork-spinner-wheel').count(), 0)
    // one button → the licence dialog; Esc cancels without downloading and gives focus back.
    const install = page.locator('#preview').getByRole('button', { name: '下载并安装…' })
    await install.click()
    const dialog = page.getByRole('dialog', { name: '下载 Live2D 运行库' })
    await dialog.waitFor()
    assert.deepEqual(await dialog.locator('a').evaluateAll(links => links.map(a => [a.href, a.target])),
      [['https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html', '_blank'], ['https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html', '_blank']])
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '取消')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the dialog fits')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '下载并安装…')
    // agreeing downloads; a failure says why, names the official pages and takes the dropped files.
    await install.click()
    await dialog.getByRole('button', { name: '同意并下载' }).click()
    await page.locator('#preview .fork-runtime[data-state=importing]').waitFor()
    await page.locator('#preview').getByRole('alert').waitFor()
    assert.match(await page.locator('#preview').getByRole('alert').textContent(), /下载 Cubism Core 失败（连接超时）/)
    assert.deepEqual(await page.locator('#preview .fork-runtime-link').evaluateAll(links => links.map(a => [a.closest('[data-piece]').dataset.piece, a.href, a.target])),
      [['core', 'https://www.live2d.com/en/sdk/download/web/', '_blank'], ['display', 'https://github.com/guansss/pixi-live2d-display/releases/tag/v0.4.0', '_blank']])
    await page.evaluate(() => {
      const files = new DataTransfer(), zone = document.querySelector('#preview .fork-runtime-drop')
      files.items.add(new File(['var Live2DCubismCore={};'], 'live2dcubismcore.min.js', { type: 'text/javascript' }))
      for (const type of ['dragenter', 'dragover', 'drop']) zone.dispatchEvent(new DragEvent(type, { dataTransfer: files, bubbles: true, cancelable: true }))
    })
    // Only the Core: the entry names the piece still missing; the renderer hears nothing yet.
    await page.locator('#preview [data-piece=core][data-installed]').waitFor()
    assert.equal(await page.locator('#preview [data-piece=display] .fork-runtime-link').count(), 1)
    assert.equal(await page.evaluate(() => loads), 0)
    await page.evaluate(() => { fail = false })
    await page.locator('#preview').getByRole('button', { name: '重新下载…' }).click()
    await dialog.getByRole('button', { name: '同意并下载' }).click()
    await page.waitForSelector('[data-status="ready"]')
    await page.locator('#settings').getByText('✓ 已安装', { exact: true }).waitFor()
    assert.equal(await page.locator('.fork-runtime-import, .fork-runtime-drop').count(), 0, 'an installed runtime offers nothing to replace it')
    assert.equal(await page.evaluate(() => loads), 1, 'mounted preview loads without restart')
    assert.equal(await page.evaluate(() => stageCores.at(-1)), '/core.js', 'mounted stage receives runtime without replaying state')
    assert.equal(await page.evaluate(() => originalScene.core), '', 'availability never mutates the persistent scene')
    assert.deepEqual(await page.evaluate(() => calls.map(c => c.method).filter(m => m !== 'getLive2dRuntime')), ['downloadLive2dRuntime', 'importLive2dRuntime', 'downloadLive2dRuntime'])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow')
    assert.deepEqual(errors, [])
    await page.close()
  }
})
