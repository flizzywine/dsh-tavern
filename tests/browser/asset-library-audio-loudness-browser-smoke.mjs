// Real asset-library App, pack details and replacement upload; only the host transport is substituted.
import assert from 'node:assert/strict'
import {readFile, mkdtemp, rm} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {chromium} from 'playwright'
import {browserReactScript} from '../fixtures/browser-react.mjs'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'

const root = new URL('../../', import.meta.url)
const read = name => readFile(new URL(name, root), 'utf8')
const audioRoot = 'tavern-plugin/packages/dsh-tavern-tts/tests/fixtures/loudness/'
const original = await readFile(new URL(audioRoot + 'speech-24000-0.wav', root))
const replacement = await readFile(new URL(audioRoot + 'speech-44100-1.wav', root))
const directory = await mkdtemp(join(tmpdir(), 'asset-library-audio-smoke-'))
const service = createAssetPackService({assetRoot:join(directory, 'assets'), authorizeLease:async()=>true})
const server = createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><div id="root"></div>')})
const oldPath = process.env.PATH, oldFfmpeg = process.env.FFMPEG_PATH
let browser
try {
  const executablePath = [process.env.DSH_BROWSER_EXECUTABLE, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path=>path&&existsSync(path)) || chromium.executablePath()
  browser = await chromium.launch({headless:true, executablePath})
  // The isolated server process cannot discover ffmpeg, including an explicit configured override.
  process.env.PATH = ''; delete process.env.FFMPEG_PATH
  let snapshot = (await service.createPack({name:'响度验收素材',expectedRevision:null})).snapshot
  const packId = snapshot.manifest.id
  const staged = await service.putBlob({packId,expectedRevision:snapshot.revision,bytes:original,descriptor:{ext:'wav',mime:'audio/wav',size:original.length}})
  snapshot = staged.snapshot
  const assets = [['music','离别曲'],['sfx','铜铃声']].map(([kind,name])=>({kind,id:kind,name,enabled:true,recall:{mode:'keyword',keywords:kind==='music'?['离别','毕业','远行']:['铜铃','摇铃','铃铛']},directorNote:'',variants:{default:'default',entries:[{id:'default',name:'默认音频',content:{media:staged.hash,loudness:{v:1,lufs:-30,peak:-10}}}]}}))
  snapshot = (await service.patchPack({packId,expectedRevision:snapshot.revision,patch:{assets}})).snapshot
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const page = await browser.newPage({viewport:{width:1440,height:1000}})
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error=>errors.push(error.message))
  await page.exposeFunction('assetService', async (method,args)=>{
    if (args?.fileUpdates) args.fileUpdates = new Map(args.fileUpdates.map(([name,bytes])=>[name,bytes===null?null:new Uint8Array(bytes)]))
    return service[method](args)
  })
  await page.goto('http://127.0.0.1:'+server.address().port)
  await page.addScriptTag({content:await browserReactScript()})
  await page.addScriptTag({content:`window.__ModuleLoader__={load:definition=>definition.factory(name=>modules[name]||{})};`})
  const client = (await read('tavern-plugin/lib/client.js')).replace('function createAssetPackUI(', 'window.audioSmokeUI=createAssetPackUI;window.audioSmokeMeter=measureBrowserAudio;\nfunction createAssetPackUI(')
  await page.addScriptTag({content:client})
  const entry = await read('tavern-plugin/packages/dsh-tavern-stage/src/client/entry.js')
  const start = entry.indexOf('function createStageAssetPackViews(core) {')
  let stage = entry.slice(start,entry.indexOf('__STAGE_FEATURES__',start))
  for (const [token,file] of Object.entries({__STAGE_CARD_STAGE_MODE__:'packages/dsh-presentation-protocol/src/card-stage-mode.cjs',__STAGE_ASSET_PACK_GEN_UI__:'packages/dsh-tavern-stage/src/client/asset-pack-gen-ui.js',__STAGE_ASSET_PACK_CARD_UI__:'packages/dsh-tavern-stage/src/client/asset-pack-card-ui.js',__STAGE_ASSET_PACK_ENGINE_UI__:'packages/dsh-tavern-stage/src/client/asset-pack-engine-ui.js',__STAGE_MOD_MANAGER__:'packages/dsh-tavern-stage/src/client/mod-manager.js'})) stage = stage.replace(token,await read('tavern-plugin/'+file))
  await page.addScriptTag({content:stage+`
    const React=modules.react, ui=window.audioSmokeUI(React);
    ui.stageScope.bind(createStageAssetPackViews(ui.stageScope.names));
    const service=new Proxy({apiVersion:2,capabilities:[]},{get:(target,key)=>key in target?target[key]:key==='subscribe'?undefined:args=>window.assetService(key,args?.fileUpdates?{...args,fileUpdates:[...args.fileUpdates].map(([name,bytes])=>[name,bytes===null?null:Array.from(bytes)])}:args)});
    const binding={service,globalEnabledPackIds:[],rpc:async method=>{if(method==='listAssetCandidates')return {data:[]};throw Error('Unexpected RPC '+method);}};
    modules['react-dom/client'].createRoot(document.querySelector('#root')).render(React.createElement(ui.App,{binding,enabled:true}));
  `})
  await page.getByText('响度验收素材',{exact:true}).click()
  const expected = await page.evaluate(bytes=>window.audioSmokeMeter(new Uint8Array(bytes)),Array.from(replacement))
  for (const [kind,name,category] of [['music','离别曲','音乐'],['sfx','铜铃声','音效']]) {
    await page.getByRole('tab',{name:new RegExp(category)}).click()
    await page.getByText(name,{exact:true}).first().click()
    await page.getByRole('button',{name:'变体「默认音频」操作',exact:true}).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('menuitem',{name:'替换媒体…',exact:true}).click()
    await (await chooser).setFiles({name:'replacement.wav',mimeType:'audio/wav',buffer:replacement})
    await page.waitForFunction(async ({packId,kind,oldMedia})=>{
      const pack=await window.assetService('getPackSnapshot',{packId})
      return pack.manifest.assets.find(asset=>asset.kind===kind).variants.entries[0].content.media!==oldMedia
    },{packId,kind,oldMedia:staged.hash})
    const stored = await service.getPackSnapshot({packId})
    const content = stored.manifest.assets.find(asset=>asset.kind===kind).variants.entries[0].content
    assert.ok(Number.isFinite(content.loudness?.lufs),kind+' stored content.loudness')
    assert.ok(Math.abs(content.loudness.lufs-expected.lufs)<=0.5,kind+' agrees with browser meter within 0.5 LU')
    console.log('PASS '+kind+': stored='+content.loudness.lufs+' LUFS, browser='+expected.lufs+' LUFS; ffmpeg unavailable')
  }
  assert.deepEqual(errors,[])
} finally {
  if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath
  if(oldFfmpeg===undefined)delete process.env.FFMPEG_PATH;else process.env.FFMPEG_PATH=oldFfmpeg
  await browser?.close()
  server.closeAllConnections()
  if(server.listening)await new Promise(resolve=>server.close(resolve))
  await service.dispose()
  await rm(directory,{recursive:true,force:true})
}
