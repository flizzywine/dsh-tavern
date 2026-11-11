// The built stage client (packages/dsh-tavern-stage/lib/client.js) on a browser page, started the way the core
// starts it: the module's default export is a cordis plugin; apply(ctx) asks ctx for `tavernStageFrontend` and
// runs host.registrations with its navigation and view factories (gal-stage.js bindStageViews); with views up it starts the
// sessions from host.sessionInputs() (stage-session-binding.js stageSessionInputs). Harnesses supply the core names
// the stage reads as offline stubs instead of concatenating stage sources.
import {readFileSync} from 'node:fs'
import {stageClientModuleAsScript} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/client-assets.js'

const tavern = new URL('../../tavern-plugin/', import.meta.url)
// (a Node-only export line, unguarded in emotion-identity.cjs, is dropped: the page has no module)
const source = file => readFileSync(new URL(file, tavern), 'utf8').replace(/^'use strict';/m, '').replace(/^module\.exports = [^\n]*$/m, '')
  .replace(/^\/\/ @include ([\w.-]+)$/m, (_, name) => source('src/client/' + name))
let cachedClient = null, cachedOptions = null

// The core's shared pure sources the bindStageViews options carry (real code, not stubs), evaluated in one scope.
const HOST_SOURCES = ['shared/color-math.cjs', 'packages/dsh-presentation-protocol/src/figure-scale.cjs',
  'packages/dsh-presentation-protocol/src/stage-light.cjs', 'shared/stage-look-math.cjs', 'src/client/gal-looks.js',
  'shared/canvas-empty.cjs', 'src/client/stage-effects.cjs', 'src/client/stage-auto-timing.cjs',
  'src/client/stage-performance-kinds.cjs', 'packages/dsh-presentation-protocol/src/stage-skin.cjs',
  'packages/dsh-presentation-protocol/src/director-commands.cjs', 'src/client/surfaces.cjs',
  'src/client/stage-page-index.cjs', 'src/client/gal-stage-helpers.cjs', 'src/client/stage-entries.js', 'src/client/foreground.js',
  // The core's pack figure/scene composition the controller reads (options.controller.figures, options.speaker.render),
  // with the shared sprite and avatar sources it reads in a browser.
  'shared/sprite-images.cjs', 'shared/sprite-emotions.cjs', 'lib/domain/pack-avatar.cjs',
  'packages/dsh-asset-library/src/shared/emotion-identity.cjs', 'packages/dsh-asset-library/src/shared/layered-sprite.cjs',
  'src/client/pack-playback.cjs',
  // The runtime protocol kernels the core hands the stage (gal-stage.js runtimeProtocol).
  'packages/dsh-presentation-protocol/src/performance-state.cjs', 'src/client/mod-projection.cjs', 'src/client/phone-beat.cjs',
  // The narration presentation the controller reads for a skin's art.narration (options.controller.narration).
  'lib/domain/stage-narration.cjs',
  // The core's waiting lines and stoppable wait (options.choices / regenerate / notices: the text box's and the end panel's waits).
  'src/client/wait-lines.js',
  // The core's speaker resolution (options.controller.dialogue: the box name and the speaker's character).
  'packages/dsh-presentation-protocol/src/figure-resolution.cjs', 'packages/dsh-presentation-protocol/src/voice-cues.cjs', 'src/client/bubble-line.cjs',
  // The resource owner the core hands the stage as assets.createOwner (stage-session-binding.js includes it).
  'packages/dsh-tavern-stage/lib/client/resources.cjs']
// stage-resources.cjs: the core builds the module once (createStageResourcesModule) and reads its names.
// gal-stage.js: the reading preference limits/defaults and the auto delay the CONFIG text page and the stage read.
const galStage = readFileSync(new URL('src/client/gal-stage.js', tavern), 'utf8')
const slice = (a, b) => galStage.slice(galStage.indexOf(a), galStage.indexOf(b, galStage.indexOf(a)))
const HOST_TAIL = 'const {stageDecodeImage, createStageResourceOwner, stageResourceMatches} = createStageResourcesModule();\n'
  + slice('const STAGE_READING_DEFAULTS', '// skip (SKIP control') + '\n' + slice('function galAutoDelay', 'const stageReading')

// Page script: window.stageHost = {options(overrides), sessionInputs(overrides)} with offline stubs for the core's
// services (rpc, transport, audio, fonts, foreground clock). Overrides replace whole option / input groups.
export function stageHostScript() {
  // stage-entries.js reads React, Icon and stageFilm lazily (its film entry); the page's names stand in.
  // window.stageHostIcon / stageHostFontResolve (set before this script): a page's real Icon and font families instead of the stubs.
  cachedOptions ??= `window.stageHost=(()=>{const React=window.React||modules.react,Icon=window.stageHostIcon||(()=>null),stageFilm={get:()=>false,set(){},subscribe:()=>()=>{}};
  // about:blank pages are not a secure context; the stage keys widget variable reads by a random id.
  // The timers the options hand the stage read the page's at call time, so a clock a check installs after mounting (page.clock)
  // drives them as it drives the page's own.
  const setTimeout=(...args)=>window.setTimeout(...args),clearTimeout=id=>window.clearTimeout(id),setInterval=(...args)=>window.setInterval(...args),
    clearInterval=id=>window.clearInterval(id),requestAnimationFrame=fn=>window.requestAnimationFrame(fn),cancelAnimationFrame=id=>window.cancelAnimationFrame(id);
  if(!crypto.randomUUID)crypto.randomUUID=()=>'00000000-0000-4000-8000-'+Math.random().toString(16).slice(2,14).padEnd(12,'0');
  ${HOST_SOURCES.map(source).join('\n;\n')}
  ${HOST_TAIL}
  const noop=()=>{},off=()=>noop,store=value=>({get:()=>value,set(next){value=next;},subscribe:off});
  // The core's foreground owner (foreground.js forkForeground), shared with the page's own copy.
  const foreground=forkForeground;
  const fonts={subscribe:off,getSnapshot:()=>0,resolve:(...args)=>window.stageHostFontResolve?.(...args)||{family:'serif'},ensure:async()=>{},families:()=>[]};
  const sounds={preload:noop,play:noop,useSkin:noop};
  const audioState={master:0,music:0,sfx:0,voice:0,ambience:0,ui:0,muted:{}};
  const audio={get:()=>audioState,getSnapshot:()=>audioState,setDucking:noop,setVolume:noop,toggleMute:noop,subscribe:off,context:()=>null,gain:()=>null,prepareVoice:noop,release:noop,voice:noop,keepAwake:noop};
  const reading=store({textSpeed:0,autoWait:700,autoSpeed:1,voiceRate:1,frameCap:null,reducedMotion:false,photosensitive:true,textScale:{},hudReveal:null});
  reading.set=patch=>{const next={...reading.get(),...patch};reading.get=()=>next;};
  const rpc=(...args)=>window.stageHostRpc?window.stageHostRpc(...args):Promise.reject(new Error('offline stage host: '+args[0]));
  const authority=source=>JSON.stringify([source.sessionId,source.authorityEpoch]);
  const Nothing=()=>null,Spinner=Nothing,entries=stageEntries;
  // the core's (?) (settings-ui.js HelpTip) as its closed button; the explanation stays behind it.
  const HelpTip=props=>React.createElement('span',{className:'fork-help-tip'},React.createElement('button',{type:'button',className:'fork-help-tip-button','aria-label':props.label},'?'));
  const player={cancelPrefetch:noop,play:async()=>{},prefetch:async()=>{},stopPlayback:noop,stop:noop,get:()=>null,getError:()=>null,prioritize:noop,subscribe:off,setEnabled:noop};
  const options=(overrides={})=>({rpc,
    speech:{player,available:()=>false,speechInput:()=>null,character:()=>null,language:()=>'zh',open:async()=>null},
    sceneColorMath:{galMatrix,galClamp01},
    figureScale:{FIGURE_DISPLAY,figureDisplayCm,figurePixelsPerCm,figureGroundY},
    sceneFigureProtocol:{FIGURE_DISPLAY},
    sceneLighting:{stageLighting,stageApplyLight},
    sceneServices:{foreground,lipSync:{wake:noop},loadPixi:async()=>{throw new Error('offline: no Pixi');}},
    looks:{math:stageLookMath,fade:stageLookFadeMs,Image},
    sceneGraphics:{paintEmpty:stagePaintEmpty,emptyPalette:stageEmptyPalette},
    effects:{policy:{STAGE_EFFECT_BEATS,STAGE_EFFECT_LOOKS,STAGE_EFFECTS,stageEffectResolve,stageSafety,stageEffectRed,stageEffectLuma,stageFlashDark,stageFlashSafe,stageFlashGate,stageFlashAt,stageShakeAt,stagePulseAt,stageGlitchAt},loadScript:async()=>{},thunder:noop},
    skinContract:{stageSkinImageOf,stageSkinSliceEdges,stageSkinScreenFiles,stageSkinPortraitOrder,skinContrast},
    skinReadableInk:forkSurfaces.readableInk,
    skinPresentation:{fonts,appearance:stageSkinAppearance,forDevice:stageSkinForDevice},
    skinResources:{setTimeout,clearTimeout},
    directorCommands,
    // no checks offline: useDiceBacklog null keeps the rows as they are (diceBacklogEntries merges rolls into them)
    backlogView:{voicePlayer:player,useDiceBacklog:()=>null,diceBacklogEntries:rows=>rows,diceLine:()=>'',useJumpLatest:()=>({}),JumpLatest:Nothing,useFigureTextContrast:typeof useFigureTextContrast==='function'?useFigureTextContrast:noop,bubbleCharacter,galQuoted,VoiceButton:Nothing,PackImage,Icon,HelpTip,Spinner,getComputedStyle,ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame},
    modSurface:{timing:{validate:validateStagePerformanceTiming,overlaps:stagePerformanceRegionsOverlap},readMedia:async()=>null,readItems:async()=>({performances:[]})},
    performanceSurface:{fonts,resolution:()=>1,subscribeResolution:off,policy:{stageFlashAt,stageFlashDark,stageFlashGate,stageFlashSafe,stageSafety,stageEffectHex,stageEffectRgb}},
    textIndex:{pageCards:stagePageCards},
    playbackTiming:{delay:stageAutoDelay,remaining:stageAutoRemaining},
    performances:{read:async()=>({kinds:[]}),registry:createStagePerformanceRegistry,core:STAGE_PERFORMANCE_CORE},
    runtimeProtocol:{performanceKindsKernel:{stagePerformanceKindOf,stagePerformanceBlocks,stagePerformancePhaseBlocks,STAGE_PERFORMANCE_CORE},
      performanceStateKernel:{performanceSustained,reducePerformanceEvent},modProjectionKernel:{modPerformanceLedgerKey},phoneBeatKernel:{phoneModAutoVoiceAllowed}},
    entrance:{reading,safety:stageSafety,flashGate:stageFlashGate},
    text:{performance,ResizeObserver,getComputedStyle,clock:foreground,fonts,sounds,defaultTextSpeed:28},
    music:{audio,foreground,fetch,AbortController},
    bgm:{read:async()=>({tracks:[]}),storage:null,authority},ambience:{authority},
    timer:{rpc,crypto,performance,setInterval,clearInterval,Icon,foreground,ResizeObserver,MutationObserver,resourceAuthority:authority,useModOptions:()=>null},
    sfx:{Audio,audio,foreground,matches:()=>false},
    soundscape:{Audio,mixer:audio},
    mixer:{reading,voiceRateLimits:[0.8,2,0.1],Icon,Slider:Nothing,audio,sounds,entries,report:useStageEntryState,icons:{}},
    widgets:{sandbox:Nothing,sounds,report:useStageEntryState,entries,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame},
    video:{getService:()=>null,fetch,URL,stageVideo:{},audio,foreground,setTimeout,clearTimeout},
    loader:{getService:()=>null,fetch,URL,AbortController,decodeImage:async()=>null},
    admission:{performance,setTimeout,clearTimeout,Spinner},
    configText:{reading,limits:STAGE_READING_LIMITS,defaults:STAGE_READING_DEFAULTS,scale:STAGE_TEXT_SCALE,scaleOf:stageTextScaleOf,fonts,FontPicker:Nothing,clock:foreground,autoDelay:galAutoDelay},
    configAppearance:{reading,quality:store('high'),sounds,Icon,Spinner},
    position:{storage:null,setTimeout,clearTimeout},
    hints:{storage:null,setTimeout,clearTimeout},
    menu:{sounds},
    // render is the core's real figure composition (gal-stage.js passes packFigureRenderInputs), so cast members reach the scene
    speaker:{character:bubbleCharacter,resolve:(...args)=>figureResolution.resolveFigureName(...args),latin:figureResolution.figureLatinAlias,render:packFigureRenderInputs},
    controller:{useLiveView:()=>({view:{chatId:'session',mode:'story'}}),storyTurn:(_view,turn)=>turn,useCoordination:()=>({}),rpc,phoneCall:()=>null,
      // the core's resolver and display name; colour as bubbles.js bubbleColor (no mood badges offline)
      dialogue:{color:character=>character?.color||'var(--fork-figure-fallback)',displayName:bubbleDisplayName,moodBadge:()=>null,moods:()=>[],actor:stageActorCharacter},
      figures:{layers:createPackSceneLayers,performance:packPerformanceScene,render:packFigureRenderInputs,reactions:packFigureReactions},
      DiceRolls:Nothing,DiceThrow:Nothing,narration:stageNarrationPresentation,offstage:()=>new Set(),skinFigures:stageSkinFigures,phoneBeat:()=>null,
      playEvents:{emit:noop}},
    controllerLegacy:{film:stageFilm,background:(_id,scene)=>scene,widgetTheme:()=>null,entryContext:stageEntryContextType,entryStore:createStageEntryStore},
    // The core's shared controls (Segmented/Slider/ResetButton/TextArea/FloatingPanel/wait lines) as inert stand-ins.
    // the core's ReactDOM (gal-stage.js passes its own): the end panel portals its wait into the text box with it
    choices:{ReactDOM:window.ReactDOM||Object.assign({},modules['react-dom'],modules['react-dom/client']),playEvents:{emit:noop,editChars:()=>0},sounds,useSounds:noop,
      episode:stageWaitLinesEpisode,waitLines:STAGE_WAIT_LINES,TextArea:Nothing,Icon,StageWaitStop,StageWaitLines,getComputedStyle,ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame},
    choiceLayout:{getComputedStyle},
    regenerate:{report:noop,sounds,useSounds:noop,episode:stageWaitLinesEpisode,waitLines:STAGE_WAIT_LINES,HelpTip,Segmented:Nothing,TextArea:Nothing,StageWaitStop,StageWaitLines},
    configScreen:{matchMedia,rpc,sections:[],useSounds:noop,sounds,Icon},
    configFields:{HelpTip,Segmented:Nothing,Slider:Nothing,ResetButton:Nothing,FontPicker:Nothing,InlineField:Nothing,sounds,classify:()=>null},
    phoneLayout:{storage:null,width:()=>innerWidth,ResetButton:Nothing,sections:[]},
    sourceWidgets:{storage:null,foreground,rpc,sounds,fillInput:noop,signals:{subscribe:off},characters:{character:()=>null,mood:()=>null,moods:()=>[],actor:()=>null},avatarCache:null,
      phoneProtocol:{phoneModDirect:()=>null,phoneModOwnership:()=>null,run:async()=>null},figureResolution:{resolveFigureName:()=>null},playerErrorText:error=>String(error?.message||error||''),fetch,createImageBitmap,
      sandbox:{stopSfx:noop,scroll:noop,theme:()=>null}},
    presentation:{foreground,titleTiming:STAGE_EFFECTS.title,matchMedia,getComputedStyle,ResizeObserver,MutationObserver},
    // the core's face picture (pack-playback.cjs PackImage, real); layered sprite faces stay inert offline
    portraits:{foreground,SpriteImage:Nothing,PackImage,MutationObserver,getComputedStyle,matchMedia},
    labels:{getComputedStyle,ResizeObserver,requestAnimationFrame,cancelAnimationFrame},
    subtitles:{foreground,fonts,getComputedStyle,ResizeObserver,heldTail:stagePageHeldTail,quote:galQuoted},
    textcard:{clock:foreground},textcardFonts:{FontFace:globalThis.FontFace,fonts},
    textcardPlayer:{performance,requestAnimationFrame,cancelAnimationFrame,setInterval,clearInterval,setTimeout,clearTimeout},
    textcardLayout:{getComputedStyle,figureTextColor:()=>'',figurePlateColor:()=>''},
    skinDecoration:{clock:foreground,MutationObserver,ResizeObserver},skinCursor:{matchMedia,clock:foreground},
    transitions:{getComputedStyle,DOMMatrixReadOnly,setTimeout,clearTimeout},device:{matchMedia},figureBlink:{clock:foreground},
    phoneAdjust:{navigator,pad:8,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame},
    backlogHistory:{read:async()=>({}),subscribe:off},backlogVoice:{player,wake:noop},
    backlogRows:{registry:createStagePerformanceRegistry,core:STAGE_PERFORMANCE_CORE,pointer:stagePerformancePointer},
    // The clip bar and the map read the core's overlay hooks and empty states; inert here (no overlay stack).
    clipExport:{rpc,Icon,Spinner,EmptyState:Nothing,overlayEscape:()=>false,useOverlay:noop,InlineField:Nothing},
    cg:{ResizeObserver,clock:foreground,consumer:()=>({dispose:noop,present:noop,redraw:noop,policy:noop}),paint:()=>false,policy:()=>({}),rpc},
    notices:{foreground,displayPreferences:{get:()=>({}),subscribe:off},getSelection,StageWaitStop,Spinner,Icon,providerRefusal:()=>null,errorText:error=>String(error?.message||error||''),diagnosticText:()=>'',live2d:{Entry:Nothing,runtime:null}},
    Icon,
    ...overrides});
  // stage-session-binding.js stageSessionInputs with fixture sources. sessionId: the one open session.
  const sessionInputs=({sessionId='session',native={},io={},assets={},dialogue={},preferences,text,observation}={})=>({
    native:{selectedSessionId:()=>sessionId,viewPaths:[],coordination:{getSnapshot:()=>({view:{}}),subscribe:off},
      settings:{get:()=>({config:{characters:[],voice:{enabled:false},stage:{}}}),load:noop,subscribe:off},
      storyTurn:(_view,turn)=>turn,projectionForTurn:(view,turn)=>view?.replyProjections?.find(row=>row.turn===turn),superseded:galIsSuperseded,...native},
    io:{presentation:async()=>({status:'empty'}),direction:async()=>null,body:async()=>null,probe:async()=>null,watch:off,
      notifications:{send:async()=>{},browseMs:1000,report:noop},...io},
    assets:{createOwner:createStageResourceOwner,service:()=>null,decode:async(_blob,url)=>{const image=new Image();image.src=url;await image.decode();return image;},...assets},
    dialogue:{character:()=>null,media:()=>null,moods:()=>[],...dialogue},
    preferences:preferences||{get:()=>({reading:reading.get(),film:false,audio:audio.get()}),subscribe:off},
    text:text||{pageCards:stagePageCards,paginate:stageBlockPages},
    observation:observation||{packs:{subscribe:off,runtimeChanged:off},portraits:{subscribe:off,get:()=>null,prepare:noop,revision:()=>0,select:noop},media:{background:{activate:off,invalidate:noop}}}});
  // A native host for one open session: the session list, its binding, the resolved chat and the live view the
  // session owner selects (core liveTavernView). view(): the host view value ({view:{chatId,mode,replyProjections}}).
  function source(value){const listeners=new Set();return {getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    set(next,notify=true){value=next;if(notify)for(const fn of [...listeners])fn();},notify(){for(const fn of [...listeners])fn();}};}
  function nativeSession({sessionId='session',view=()=>({view:{chatId:sessionId,mode:'story',replyProjections:[]}})}={}){
    const chat=source({nodes:new Map(),order:[]}),session=source({running:false}),live=source(view());
    const list=source({current:sessionId,byId:{[sessionId]:{id:sessionId,retainedBy:{mainView:1}}}});
    return {chat,session,live,list,
      native:{sessions:{list,binding:()=>({session})},resolveChat:()=>chat,
        views:{select:()=>live,invalidate:noop,getSnapshot:()=>({phase:'ready',view:live.getSnapshot().view})}},
      refresh(running){session.set({running},false);live.set(view(),false);chat.notify();session.notify();live.notify();}};
  }
  // The core's voice pieces (pack-playback.cjs createPackVoicePlayer, bubble-line.cjs) for a check that voices a stage over a local TTS client:
  // options.speech as gal-stage.js builds it (speechInput: voice-speech.cjs segmentSpeechInput, with no mood offline).
  const voice={createPlayer:createPackVoicePlayer,character:bubbleCharacter,language:characterVoiceLanguage,
    speechInput:(segment,config)=>packSpeechInput(segment,config,bubbleCharacter(config,segment),null)};
  return {options,sessionInputs,nativeSession,source,store,foreground,reading,entries:stageEntries,Icon,voice};
  })();`
  return cachedOptions
}

// Page script: defines window.stageClient = {plugin, start(host) -> {views, navigation, stop, errors}}.
// Needs window.React / window.ReactDOM (or `modules` from browser-react.mjs) when views are created.
// seams: [from, to] replacements in the built module text (each asserted present), for a check that holds a stage state.
export function stageClientPageScript(seams = [], stageBuild) {
  // The module text as a strict function body (its top-level names stay out of the page), completing with the plugin.
  if (!cachedClient) {
    const text = stageClientModuleAsScript(readFileSync(new URL('packages/dsh-tavern-stage/lib/client.js', tavern), 'utf8'))
    const at = text.lastIndexOf('stageClientPlugin;')
    cachedClient = '(()=>{' + text.slice(0, at) + 'return stageClientPlugin;' + text.slice(at + 'stageClientPlugin;'.length) + '\n})()'
  }
  let client = cachedClient
  if (stageBuild) {
    const text = stageClientModuleAsScript(readFileSync(stageBuild, 'utf8'))
    const at = text.lastIndexOf('stageClientPlugin;')
    client = '(()=>{' + text.slice(0, at) + 'return stageClientPlugin;' + text.slice(at + 'stageClientPlugin;'.length) + '\n})()'
  }
  for (const [from, to] of seams) {
    if (!client.includes(from)) throw new Error('stage client seam moved: ' + from.slice(0, 80))
    client = client.replace(from, () => to)
  }
  return `window.stageClient=(()=>{const plugin=${client};
  return {plugin,
    // host: {options, sessionInputs?, availability?, sessionId?}. options are bindStageViews' options; React/ReactDOM/window/document default in.
    start(host={}){
      const out={views:null,navigation:null,stop:null,errors:[]};
      // The core's stage registrations (main.js stageEffect): navigation first, then the views, as the core registers them.
      const registrations=[
        ({createNavigation})=>{
          out.navigation=createNavigation({window,document,navigator:window.navigator,playCue(){},checkSetup:async()=>true,
            getSessionId:()=>host.sessionId||'session',getSettings:()=>({}),...(host.navigationHooks||{})});
          // the stage's capture key listener (main.js stageEffect galStageShortcut: F12 and the keyboard-focus marker data-fork-keynav)
          const stopShortcut=out.navigation.galStageShortcut();
          return ()=>{stopShortcut();out.navigation=null;};
        },
        ({createViews})=>{
          const React=window.React||modules.react,ReactDOM=window.ReactDOM||Object.assign({},modules['react-dom'],modules['react-dom/client']);
          out.views=createViews({React,ReactDOM,window,document,navigation:out.navigation,...(host.options||{})});window.stageViews=out.views;
          host.created?.(out.views);
          return ()=>{const views=out.views;out.views=null;if(window.stageViews===views)window.stageViews=null;views?.dispose?.();};
        }];
      const frontend={availability:host.availability,registrations,report:error=>out.errors.push(['stage registration',error]),
        sessionInputs:()=>host.sessionInputs()};
      const effects=[];
      const ctx={provide(){},get:name=>name==='tavernStageFrontend'?frontend:undefined,effect(fn){const stop=fn();effects.push(stop);return stop;}};
      const error=console.error;console.error=(...args)=>{out.errors.push(args);error(...args);};
      try{plugin.apply(ctx);}finally{console.error=error;}
      out.stop=()=>{for(const stop of effects.splice(0).reverse())stop?.();};
      return out;
    }};
  })();`
}

// Both scripts, in page order.
export const stageClientPage = (seams = [], stageBuild) => stageHostScript() + '\n' + stageClientPageScript(seams, stageBuild)
