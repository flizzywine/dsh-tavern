import {withVoiceCues} from './voice-cues-source.mjs'
import fs from 'node:fs'
import {roundBody} from '../../tavern-plugin/lib/domain/round-body.js'
import {stageParagraphs} from '../../tavern-plugin/lib/domain/stage-paragraphs.js'
import {stageDisplayUnits} from '../../tavern-plugin/lib/domain/stage-display-units.js'
import {stageClientPage} from './stage-client-page.mjs'
import {withSpriteEmotionSource} from './sprite-emotion-source.mjs'
// a core client source by its file name
const read=name=>fs.readFileSync(new URL('../../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
// One mounted GalStage from the built stage client (stage-client-page.mjs): the plugin is applied through the
// same cordis ctx / tavernStageFrontend seam production uses, its sessions read the page's offline host
// (hostProjection / hostDirection / hostLease, exposed by each test) and a native fixture session. The scene
// renderer is an instrumented DOM handoff seam (views.scene.Scene); GPU drawing is the perf gate's job.
// mountedStageShell({seams}): the same page with [from, to] replacements in the built stage client. Page hooks set before
// it: window.stageShellOptions (option groups over the offline host's, or host => groups), stageShellScene (the scene
// renderer instead of the DOM handoff stub), stageShellConfig (the card config the Stage reads) and stageShellStageProps
// (more Stage props: Choices, Regenerate, choiceProps) and stageShellAssets (session asset inputs over the offline host's:
// createOwner, service, decode); stageShellDeferMount: the Stage mounts only on window.enterStage() (a stage entered later).
// stageShellOpening: the opening round's text (default a two-paragraph fixture). Set by it: window.stageShellNative (the native session: chat, session and live sources) before the Stage mounts.
// The chat nodes may carry tool records beside the assistant steps; the round bodies are read from the steps.
export const mountedStageShell=({seams=[],stageBuild}={})=>`
  ${stageClientPage(seams, stageBuild)}
  (()=>{
  // The host's round body (lib/domain round-body.js) over the core's bubble-line parser, as the server projects it.
  ${withSpriteEmotionSource('// @include-shared sprite-emotions.cjs')}
  ${withVoiceCues(read('bubble-line.cjs')).replace(/^'use strict';/m,'')}
  ${read('stage-page-index.cjs').replace(/^'use strict';/m,'')}
  ${stageDisplayUnits.toString()}
  ${stageParagraphs.toString()}
  ${roundBody.toString()}
  const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLFcAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  // Genuine decoded image bytes are local: the fixture library's leases (/fixture/<hash>) answer from this page, offline.
  const pageFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>new URL(String(input?.url||input),location.href).pathname.startsWith('/fixture/')?Promise.resolve(new Response(png,{headers:{'Content-Type':'image/png'}})):pageFetch(input,init);
  const nodes=new Map();let running=false;
  const view=()=>({view:{mode:'story',chatId:'session',replyProjections:[...nodes.values()].filter(node=>node.kind==='assistant-step').map(node=>{
    const turn=node.location.turn.turn,text=node.data.blocks.filter(b=>b.kind==='text').map(b=>b.text).join('\\n');
    return {version:2,turn,body:roundBody([{kind:'markdown',text}],{chatId:'session',turn,streaming:node.data.status==='running'})};})}});
  const host=window.stageShellNative=stageHost.nativeSession({sessionId:'session',view});
  const wakes=new Set();
  let mounts=0,unmounts=0;
  function GalScene(props){
    React.useEffect(()=>{mounts++;return()=>{unmounts++}},[]);
    React.useLayoutEffect(()=>props.onPresented?.(props.scene.presentationRevision));
    // The one-shot effects (screen beats, emotes) the stage hands the scene for the page on screen.
    window.stageSceneEffects=(props.scene.effects || []).map(effect => effect.op + ':' + effect.value);
    return React.createElement('div',{className:'fork-gal-scene','data-scene':props.scene.background?.url || '', 'data-ruler':JSON.stringify(props.scene.figureScale)});
  }
  const shellOptions=typeof window.stageShellOptions==='function'?window.stageShellOptions(stageHost):window.stageShellOptions||{};
  const client=window.stageMountedClient=stageClient.start({options:stageHost.options(shellOptions),
    created:views=>{views.scene.Scene=window.stageShellScene||GalScene;},
    // the session's settings are the card config the Stage reads (production: the bubble store's card config)
    sessionInputs:()=>stageHost.sessionInputs({native:{...host.native,settings:{get:()=>({config:window.stageShellConfig||{characters:[],voice:{enabled:false},stage:{}}}),load(){},subscribe:()=>()=>{}}},
      io:{presentation:args=>hostProjection(args),direction:args=>hostDirection(args),watch:(_source,wake)=>{wakes.add(wake);return()=>wakes.delete(wake)}},
      assets:{service:()=>({leaseMedia:args=>hostLease(args),releaseLease(){}}),...window.stageShellAssets}})});
  if(!client.views)throw new Error('stage client did not mount: '+client.errors.map(args=>String(args[1]?.stack||args[1])).join('\\n'));
  window.wakeDirection=()=>wakes.forEach(wake=>wake());
  const native=(turn,text,status='closed')=>({id:'turn-'+turn,kind:'assistant-step',anchorSeq:turn,location:{turn:{turn}},data:{status,blocks:[{kind:'text',text}]}});
  const setNodes=(list,run=false)=>{nodes.clear();for(const node of list)nodes.set(node.id,node);running=run;host.chat.set({nodes,order:[...nodes.keys()]},false);host.refresh(running);};
  // stageShellOpening: the opening round's text ('' a text-less opening, null a chat with no round yet).
  if(window.stageShellOpening===undefined){setNodes([native(1,'Synthetic fixture.\\n\\nSynthetic dusk.')]);}
  else setNodes(window.stageShellOpening===null?[]:[native(1,window.stageShellOpening)]);
  const runtime=()=>client.views.sessions.get('session');
  client.navigation.galActive?.set?.('session');
  const target=document.createElement('main');document.body.appendChild(target);const stageRoot=ReactDOM.createRoot(target);
  const enter=()=>ReactDOM.flushSync(()=>stageRoot.render(React.createElement(client.views.controller.Stage,{sessionId:'session',choiceProps:{},data:{config:window.stageShellConfig||{characters:[],voice:{enabled:false},stage:{face:'off',music:false}}},onExit(){},...window.stageShellStageProps})));
  if(window.stageShellDeferMount)window.enterStage=enter;else enter();
  window.stageProbe={native,state:()=>runtime().getSnapshot(),stats:()=>({mounts,unmounts}),
    // the session owner (navigate, replay), as the core's history jumps and the clip export reach it
    owner:()=>client.views.sessions.owner,runtime,
    nodes:(list,run)=>ReactDOM.flushSync(()=>setNodes(list,run)),
    // a new card config delivered as the host does (the session settings and the Stage's data.config), no projection
    config:next=>{window.stageShellConfig=next;ReactDOM.flushSync(()=>stageRoot.render(React.createElement(client.views.controller.Stage,{sessionId:'session',choiceProps:{},data:{config:next},onExit(){},...window.stageShellStageProps})));},
    page:index=>ReactDOM.flushSync(()=>runtime().dispatch({type:'PAGE',index})),
    refresh:()=>runtime().dispatch({type:'REFRESH_BEGIN',source:runtime().getSnapshot().source}),
    dispose(){ReactDOM.flushSync(()=>stageRoot.unmount());client.stop();}};
  })();
`
