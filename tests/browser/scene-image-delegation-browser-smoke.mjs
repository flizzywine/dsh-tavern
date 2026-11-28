// Real Chromium + React mount of the gallery of plugin pictures.
// Run explicitly: node tests/browser/scene-image-delegation-browser-smoke.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from '../fixtures/browser-react.mjs'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const features = new URL('../../tavern-plugin/src/client/features/', import.meta.url)
const gallerySource = await readFile(new URL('scene-images.js', features), 'utf8')
const tavernCss = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

const browser = await chromium.launch({ headless: true, executablePath: chromePath })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/api/dsh-tavern/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#789"/></svg>'
  }))
  await page.route('http://tavern.test/', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><main><div id="gallery"></div></main>'
  }))
  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  const componentScript = [
    'const React=modules.react;',
    gallerySource,
    `
      const galleryRoot=modules['react-dom/client'].createRoot(document.querySelector('#gallery'));
      const pending=[], calls=[];
      window.__rpc=(method,args,sessionId)=>{
        if(method==='listSceneImageHistory') return new Promise(resolve=>pending.push({sessionId:sessionId||args.sessionId,resolve}));
        calls.push({method,args,sessionId});
        if(method==='removeSceneImageHistory') return Promise.resolve({results:(args.pluginItems||[]).map(id=>({versionId:id,ok:true}))});
        return Promise.resolve({});
      };
      function rpc(method,args,sessionId){return window.__rpc(method,args,sessionId);}
      function useTavernConfirm(){return async()=>true;}
      function useTavernSessionMode(sessionId){return sessionId.startsWith('card-') ? 'card' : 'story';}
      const liveTavernView={getSnapshot:sessionId=>({view:{mode:useTavernSessionMode(sessionId)}})};
      registerTavernCardImageMenu({inject:(_services,register)=>register({effect:install=>install(),
        contextMenus:{register:menu=>{window.__imageMenu=menu;}}
      })});
      window.__draftFiles=[];
      window.__mountComposer=function(scope,sessionId) {
        scope.setAttribute('data-conversation-session',sessionId);
        const seat=document.createElement('div');
        scope.append(seat);
        modules['react-dom/client'].createRoot(seat).render(React.createElement('div', {'data-composer-card':''},
          React.createElement('input',{type:'file',hidden:true,onChange:event=>{
            const [file]=event.currentTarget.files;
            event.currentTarget.value='';
            void file.text().then(body=>window.__draftFiles.push({sessionId,body,name:file.name}));
          }})));
      };
      const tavernPluginMediaIndex={subscribe:()=>()=>{}};
      const previews=[];
      const openSceneImagePreview=(url, opener)=>previews.push({url, tag:opener.tagName});
      window.__previews=previews;
      const DshUi={IconTrashOutlineRegular:'trash-icon'};
      const sceneImageStageLabel=()=>'';
      const sceneImageRequestId=()=> 'unused';
      const sceneImagePurchaseConfirmation=async()=>undefined;
      const recordImageInteraction=()=>{};
      const SceneImagePending='pending';
      window.__pending=pending; window.__calls=calls;
      window.__setGallerySession=sessionId=>galleryRoot.render(React.createElement(SceneImageGallery,{gallerySessionId:sessionId}));
      window.__setGallerySession('A');
    `
  ].join('\n')
  await page.addScriptTag({ content: componentScript })

  await page.waitForFunction(() => window.__pending.some(request => request.sessionId === 'A'))
  await page.evaluate(() => window.__setGallerySession('B'))
  await page.waitForFunction(() => window.__pending.some(request => request.sessionId === 'B'))
  await page.evaluate(() => {
    const request = window.__pending.find(item => item.sessionId === 'B')
    request.resolve({
      items: [],
      pluginItems: [{ id: 'plugin-B', turn: 1, caption: 'delegated plugin image', createdAt: 2, updatedAt: 3 }]
    })
  })
  await page.locator('#gallery img').first().waitFor()
  await page.evaluate(() => {
    window.__pending.find(item => item.sessionId === 'A').resolve({
      items: [],
      pluginItems: [{ id: 'plugin-A', turn: 1, caption: 'A plugin image', createdAt: 2 }]
    })
  })
  await page.waitForTimeout(50)

  const gallerySources = await page.locator('#gallery img').evaluateAll(images => images.map(image => image.getAttribute('src')))
  assert.equal(gallerySources.length, 1, 'gallery renders the plugin picture')
  assert.ok(gallerySources.some(src => src.includes('plugin-B')))
  assert.ok(gallerySources.every(src => !src.includes('A-')), 'late response from A cannot replace B')

  const pluginFigure = page.locator('#gallery figure[title="delegated plugin image"]')
  await pluginFigure.getByRole('button', { name: /放大/ }).press('Enter')
  assert.deepEqual(await page.evaluate(() => window.__previews), [{ url: gallerySources[0], tag: 'BUTTON' }])
  assert.equal(await pluginFigure.locator('a[href]').count(), 0)
  await pluginFigure.getByRole('button', { name: '删除这张图片' }).click()
  await page.waitForFunction(() => window.__calls.some(call => call.method === 'removeSceneImageHistory'))
  const deletion = await page.evaluate(() => window.__calls.find(call => call.method === 'removeSceneImageHistory'))
  assert.equal(deletion.sessionId, 'B')
  assert.equal(deletion.args.sessionId, 'B')
  assert.deepEqual(Array.from(deletion.args.pluginItems), ['plugin-B'])
  assert.equal(deletion.args.items, undefined, 'only plugin pictures are left to delete')

  await page.route('**/api/dsh-tavern/plugin-gallery-media?**', route => route.fulfill({
    contentType: 'image/png', body: new URL(route.request().url()).searchParams.get('id')
  }))
  await page.route('**/dsh-tavern-gen/img/*', route => route.fulfill({
    contentType: 'image/png', body: 'inline second image'
  }))
  await page.evaluate(() => {
    const other = document.createElement('aside')
    document.body.prepend(other)
    window.__mountComposer(other, 'card-other')
    window.__mountComposer(document.querySelector('#gallery').parentElement, 'card-current')
    window.__setGallerySession('card-current')
  })
  await page.waitForFunction(() => window.__pending.some(request => request.sessionId === 'card-current'))
  await page.evaluate(() => {
    window.__pending.find(request => request.sessionId === 'card-current').resolve({
      pluginItems: [
        { id: 'first-card-image', provider: 'dsh-tavern-image', caption: 'first card image', createdAt: 1 },
        { id: 'second-card-image', provider: 'dsh-tavern-image', caption: 'second card image', createdAt: 2 },
      ]
    })
  })
  await page.locator('figure[title="second card image"]').getByRole('button', { name: '引用这张图' }).click()
  await page.waitForFunction(() => window.__draftFiles.length === 1)
  assert.deepEqual(await page.evaluate(() => window.__draftFiles), [
    { sessionId: 'card-current', body: 'second-card-image', name: '工作台生图.png' }
  ])
  await page.evaluate(async () => {
    const [action] = window.__imageMenu.resolve({
      sessionId: 'card-current', url: location.origin + '/dsh-tavern-gen/img/inline-second.png?view=1'
    })
    await action.run()
  })
  await page.waitForFunction(() => window.__draftFiles.length === 2)
  assert.deepEqual(await page.evaluate(() => window.__draftFiles[1]), {
    sessionId: 'card-current', body: 'inline second image', name: 'inline-second.png'
  })
  assert.deepEqual(await page.evaluate(() => [
    window.__imageMenu.resolve({ sessionId: 'card-current', url: 'https://unrelated.test/dsh-tavern-gen/img/remote.png' }).length,
    window.__imageMenu.resolve({ sessionId: 'card-current', url: '/unrelated.png' }).length,
    window.__imageMenu.resolve({ sessionId: 'play-session', url: '/dsh-tavern-gen/img/old.png' }).length,
  ]), [0, 0, 0])

  await page.addStyleTag({ content: tavernCss })
  await page.evaluate(() => {
    const host = document.createElement('section')
    host.id = 'story-width'
    host.style.cssText = 'width:1000px;--dsh-chat-content-width:680px'
    host.innerHTML = '<div data-chat-flow><article class="dsh-tavern-story-transcript-row"><div class="dsh-tavern-message-frame-slot"><iframe class="dsh-tavern-message-frame"></iframe></div></article></div>'
    document.body.append(host)
  })
  const frame = page.locator('#story-width iframe')
  assert.equal(await frame.evaluate(node => node.clientWidth), 680)
  await page.locator('#story-width').evaluate(node => node.style.setProperty('--dsh-chat-user-width', '840px'))
  assert.equal(await frame.evaluate(node => node.clientWidth), 840)
  await page.locator('#story-width').evaluate(node => { node.style.width = '360px' })
  assert.equal(await frame.evaluate(node => node.clientWidth), 360)
  assert.deepEqual(pageErrors, [], 'browser runtime reports no uncaught errors')
  console.log('PASS Chromium: gallery preview, exact image references to the current draft, scoped deletion and responsive story frames')
} finally {
  await browser.close()
}
