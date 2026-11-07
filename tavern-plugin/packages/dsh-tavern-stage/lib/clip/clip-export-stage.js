import {spawn} from 'node:child_process'
import path from 'node:path'
import {serveAssetFile} from '../../../../lib/http-file.js'
import {spineRuntimeAvailable, spineRuntimeStatus} from '../../../../lib/domain/tavern-runtime-assets.js'
import {createFontLibrary, FONT_ROUTE} from '../../../dsh-dream-skin/lib/font-library.js'
import {createClipHost, clipServedAsset} from './clip-export-host.js'
import {CLIP_EXPORT_METHODS, checkClipDisk} from './clip-export.js'
import {CLIP_ORIGIN} from './clip-export-browser.js'

export {CLIP_EXPORT_METHODS}
// A finished clip streams to the player's save / share from the stage's own route.
export const CLIP_FILE_ROUTE = '/dsh-tavern-stage/clip-file'

// The stage's clip export: the isolated replay host over the core's chat readers (request deps) and the
// stage's director, mods and engine settings. `call` reaches the stage's own requests (the clip's history timer reads).
export function createStageClipExport({ctx, deps, stageDirector, modService, cardStageSwitch, dialogueBubbles, assetEngineSettings, live2dFiles, deploymentWork, call}) {
  const {dataRoot, readSessionMap, readChat, readChatCard, replyDisplayForChat, readCardWorkspace, paragraphSpeech} = deps
  const fonts = createFontLibrary({dataRoot})
  const clipExport = createClipHost({
    readChat:async sessionId => {const id=(await readSessionMap())[sessionId];return id ? readChat(id) : null},
    readDisplay:async chat => replyDisplayForChat(chat,await readChatCard(chat),true),
    readConfig:cardPath => dialogueBubbles.read(cardPath),readWorkspace:readCardWorkspace,paragraphSpeech,
    readDirection:(chat,turn) => stageDirector.get(chat,turn,null,{readOnly:true,includePredecessor:true}),
    library:() => ctx.get('assetLibrary'),tts:() => ctx.get('tts'),settings:() => assetEngineSettings.read(),
    globalPacks:() => ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || [],
    extras:async chat => ({fonts:await fonts.listFonts(),live2d:!!(await live2dFiles?.available()),live2dStatus:await live2dFiles?.coreStatus(),
      spine:await spineRuntimeAvailable(),spineStatus:await spineRuntimeStatus(),performanceEnabled:await cardStageSwitch(chat.cardPath,'performance')}),
    readHostAsset:async url => url.pathname.startsWith(FONT_ROUTE) ? clipServedAsset(fonts.serve,url) : null,
    readWidgets:value => modService.readPhonePresentation(value),
    performanceKinds:() => modService.performanceKinds(),
    readStageResource:(method,args) => call(method,args,{origin:CLIP_ORIGIN}),
    // Finished clips and the run's scratch (frame streams, two-pass stats, receipts) both live in the Desktop data area.
    exportsRoot:path.resolve(dataRoot,'../../../..','exports','clips'),
    tempRoot:path.resolve(dataRoot,'../../../..','temp','clip-export'),
    checkDisk:() => checkClipDisk(path.parse(dataRoot).root),
    openFolder:folder => new Promise((resolve,reject) => {const child=spawn(process.platform==='win32'?'explorer.exe':'xdg-open',[folder],{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve()})})
  })
  ctx.effect(() => () => clipExport.dispose(), 'dsh-tavern-stage: stop isolated clip exports')
  // Deployment waits while an export runs.
  ctx.effect(() => {
    const work = () => ({clipExport:clipExport.activity()})
    deploymentWork.push(work)
    return () => {const index = deploymentWork.indexOf(work);if (index >= 0) deploymentWork.splice(index,1)}
  }, 'dsh-tavern-stage: clip export deployment activity')
  const webServer = ctx.get('webServer')
  if (webServer) ctx.effect(() => webServer.register({kind:'prefix', path:CLIP_FILE_ROUTE, handler:(req, res) => serveClipFile(ctx, clipExport, req, res)}), 'dsh-tavern-stage: clip file route')
  return clipExport
}

// GET/HEAD /dsh-tavern-stage/clip-file?sessionId&jobId&file: the same connection and same-origin fence as the core's routes.
async function serveClipFile(ctx, clipExport, req, res) {
  const connection = ctx.get('connection')
  const rejection = connection ? connection.requestRejection(req) : 503
  if (rejection) { res.writeHead(rejection); res.end('forbidden'); return }
  const origin = req.headers.origin
  if (origin && origin !== 'http://' + req.headers.host && origin !== 'https://' + req.headers.host) { res.writeHead(403); res.end('forbidden'); return }
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.pathname !== CLIP_FILE_ROUTE || !['GET','HEAD'].includes(req.method)) { res.writeHead(404, {'X-Content-Type-Options':'nosniff'}); res.end('not found'); return }
  const query = url.searchParams
  const found = await clipExport.file({sessionId:query.get('sessionId'), jobId:query.get('jobId'), file:query.get('file')}).catch(() => null)
  if (!found) { res.writeHead(404, {'X-Content-Type-Options':'nosniff'}); res.end('not found'); return }
  await serveAssetFile(req, res, found.path, found.mediaType, 'private, no-cache',
    {'Content-Disposition':"attachment; filename=\"clip" + found.path.slice(-4) + "\"; filename*=UTF-8''" + encodeURIComponent(found.name)})
}
