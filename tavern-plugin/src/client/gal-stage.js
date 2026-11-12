// galgame stage view.
// A presentation of the same reply the chat view shows: it never writes story, variables
// or prompts. The session runtime owns text, observation and accepted presentation.
// The chat view can stay frozen or unmounted; backlog reads the same session index.

// @include-domain stage-narration.cjs
// @include stage-offstage.cjs
// @include-protocol stage-pacing.cjs
// @include-protocol stage-soundscape.cjs
// @include gal-history.js
// @include-protocol stage-video.cjs
// @include mod-options.js

// @include gal-stage-helpers.cjs
// @include gal-stage-active.cjs

// Machine preference: film mode (letterbox + subtitles instead of the dialogue box), off by default.
const stageFilm = (function () {
    const KEY = "fork-stage-film";
    const listeners = new Set();
    function get() { try { return localStorage.getItem(KEY) === "on"; } catch (_) { return false; } }
    return {
        get,
        set(value) { try { localStorage.setItem(KEY, value ? "on" : "off"); } catch (_) {} listeners.forEach(fn => fn()); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();

// Machine preference: reading pace (Config → 文字). textSpeed = milliseconds per typed character (0 = the whole
// line at once); autoWait = the auto mode's pause after a line's voice ends. A silent page waits its reading
// time (galAutoHold) shifted by the same amount. autoSpeed scales both waits;
// the 1.3x default shortens idle dwell without speeding up or cutting off speech.
// voiceRate: every dialogue voice clip plays this much faster, pitch preserved (Config → 声音).
// textScale: { skinId: percent } (CONFIG 文字大小): the stage text at that percent of the skin's own size;
// a skin without an entry is at 100%.
// hudReveal: CONFIG 顶栏按钮 (PROPOSAL §二) - 'auto' | 'always' over the skin's hud.reveal; null = the skin's choice.
// The auto waits and a silent page's reading time (galAutoHold) are stage-auto-timing.cjs, shared with clip exports.
// @include stage-auto-timing.cjs
// @include stage-performance-kinds.cjs
const STAGE_READING_DEFAULTS = { textSpeed: 28, autoWait: STAGE_AUTO.wait, autoSpeed: STAGE_AUTO.speed, voiceRate: 1, frameCap: null, reducedMotion:false, photosensitive:true, skipTitlePage:false, textScale:{}, hudReveal:null };
const STAGE_READING_LIMITS = { textSpeed: [0, 80, 2], autoWait: [0, 3000, 100], autoSpeed: [0.5, 3, 0.1], voiceRate: [0.8, 2, 0.1] }; // [min, max, step]
const STAGE_TEXT_SCALE = [70, 130, 5]; // [min, max, step] percent of the skin's own size
function stageTextScaleMap(map) {
    const [min, max, step] = STAGE_TEXT_SCALE, out = {};
    for (const [skin, value] of Object.entries(map)) {
        const percent = Math.max(min, Math.min(max, Math.round(Number(value) / step) * step));
        if (Number.isFinite(percent) && percent !== 100) out[skin] = percent;
    }
    return out;
}
// The current skin's percent (no entry = 100%); the stage root carries it as --fk-text-scale and the pager re-fits.
function stageTextScaleOf(reading, skin) { return reading.textScale[skin] || 100; }
function stageReadingPrefs(saved) {
    const out = { ...STAGE_READING_DEFAULTS };
    if (!saved || typeof saved !== "object") return out;
    // frameCap null = not chosen: the device's own cap (galFrameRate: 30 on a handheld phone, else 60). Records before v 2
    // stored the old default 60 whether chosen or not, so that 60 is read as not chosen (once; the next write is v 2).
    if ([0, 30, 60, 120].includes(saved.frameCap) && (saved.v === 2 || saved.frameCap !== 60)) out.frameCap = saved.frameCap;
    for (const key of ['reducedMotion','photosensitive','skipTitlePage']) if (typeof saved[key] === 'boolean') out[key]=saved[key];
    if (saved.hudReveal === 'auto' || saved.hudReveal === 'always') out.hudReveal = saved.hudReveal;
    if (saved.textScale && typeof saved.textScale === 'object') out.textScale = stageTextScaleMap(saved.textScale);
    for (const key of Object.keys(STAGE_READING_LIMITS)) {
        const [min, max, step] = STAGE_READING_LIMITS[key], value = Number(saved[key]);
        if (saved[key] !== null && saved[key] !== "" && Number.isFinite(value)) out[key] = Math.max(min, Math.min(max, Number((Math.round(value / step) * step).toFixed(3))));
    }
    return out;
}

// skip (SKIP control or held Ctrl) turns a page every 150 ms, each painted fully before the
// next: 9 frames at 60 Hz (5 at a 30 fps cap), long enough to see each page and its snapped staging as a distinct
// frame, short enough for a 40-page round in about 6 s. It never waits for a performance: only a
// paragraph whose director prefix has not arrived holds it (data, not a performance). What it still shows is
// stageSkipShows (stage-runtime.cjs).
// The reader's auto wait on a page (stage-auto-timing.cjs stageAutoDelay) from a saved or partial reading preference.
function galAutoDelay(reading, voiced, text) {
    const wait = reading && Number.isFinite(reading.autoWait) ? reading.autoWait : STAGE_READING_DEFAULTS.autoWait;
    return stageAutoDelay(wait, stageReadingPrefs(reading).autoSpeed, voiced, text);
}
const stageReading = (function () {
    const KEY = "fork-stage-reading";
    const listeners = new Set();
    let cached = null;
    function get() {
        if (!cached) { let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {} cached = stageReadingPrefs(saved); }
        return cached;
    }
    return {
        get,
        set(patch) {
            cached = stageReadingPrefs({ ...get(), ...patch, v: 2 });
            try { localStorage.setItem(KEY, JSON.stringify({ ...cached, v: 2 })); } catch (_) {}
            listeners.forEach(fn => fn());
        },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
function useStageReading() { return React.useSyncExternalStore(stageReading.subscribe, stageReading.get); }

function GalHudLabels(props) {
    return stageViews ? React.createElement(stageViews.HudLabels, props) : null;
}

// Stable slots render only the optional plugin's current view implementation.
let stageViews = null;
// The session slash executor for card page frames (the one message frames use), made once the app context exists.
let stageCardPageSlashExecutor = null;
function stageCardPageSlash() {
    return stageCardPageSlashExecutor || (stageCardPageSlashExecutor = createTavernFrameSlashExecutor(tavernUiExtensions.service.ctx));
}
function GalStageHost(props) {
    const enabled = React.useSyncExternalStore(galStageAvailable.subscribe, galStageAvailable.get);
    return enabled && stageViews ? React.createElement(stageViews.Host, props) : null;
}
function GalStageToggle(props) {
    const enabled = React.useSyncExternalStore(galStageAvailable.subscribe, galStageAvailable.get);
    return enabled && stageViews ? React.createElement(stageViews.Toggle, props) : null;
}
// the opening floor's 进入舞台 bar for a card played on the stage (stage views.cjs OpeningEntry)
function GalStageOpeningEntry(props) {
    const enabled = React.useSyncExternalStore(galStageAvailable.subscribe, galStageAvailable.get);
    return enabled && stageViews?.OpeningEntry ? React.createElement(stageViews.OpeningEntry, props) : null;
}
function bindStageViews(createViews) {
    if (stageViews) throw new Error('Stage views already mounted');
    const views = createViews({React, ReactDOM, window, document, navigation:stageNavigation,
        speech:{player:voicePlayer,available:()=>!!forkTtsScope?.get('ttsClient')?.available(),speechInput:segmentSpeechInput,character:bubbleCharacter,language:characterVoiceLanguage,open:(id,args)=>rpc('openAssetPackVoice',args,id)},
        transcriptOutfits:{rpc,signals:tavernSessionSignals},
        // what every stage feature (a mod's client/stage.cjs, features.cjs) may use: the host's RPC for its own requests
        features:{rpc},
        sourceWidgets:{storage:(()=>{try{return localStorage;}catch{return null;}})(),foreground:forkForeground,rpc,signals:tavernSessionSignals,characters:{character:bubbleCharacter,mood:bubbleMood,moods:bubbleMoodList,actor:stageActorCharacter},avatarCache,phoneProtocol:tavernModClients.slot('source')[0]?.value.protocol,figureResolution,playerErrorText,fetch,createImageBitmap,
            sandbox:{stopSfx:()=>stageWidgetMediaOwner?.stopSfx(),scroll:(id,...args)=>stageWidgetScrollTargets.get(id)?.wheel(...args),theme:root=>stageWidgetThemeOwners.get(root)}},
        modSurface:{timing:{validate:validateStagePerformanceTiming,overlaps:stagePerformanceRegionsOverlap},readItems:(id,turn)=>rpc('getStageItems',{turn},id)},
        performanceSurface:{fonts:tavernFonts,resolution:galResolution,subscribeResolution:galResolutionSubscribe,policy:{stageFlashAt,stageFlashDark,stageFlashGate,stageFlashSafe,stageSafety,stageEffectHex,stageEffectRgb}},
        textIndex:{pageCards:stagePageCards},
        playbackTiming:{delay:stageAutoDelay,remaining:stageAutoRemaining},
        performances:{read:id=>rpc('getStagePerformanceKinds',{},id),registry:createStagePerformanceRegistry,core:STAGE_PERFORMANCE_CORE},
        directorCommands,
        resourceDependencies:{createPerformanceTimeline,performanceSustained,packFigureStill},
        runtimeProtocol:{performanceStateKernel:{performanceSustained,reducePerformanceEvent},modProjectionKernel:{modPerformanceLedgerKey},phoneBeatKernel:{phoneModAutoVoiceAllowed:stageAutoVoiceAllowed},
            performanceKindsKernel:{stagePerformanceKindOf,stagePerformanceBlocks,stagePerformancePhaseBlocks,STAGE_PERFORMANCE_CORE}},
        entrance:{reading:stageReading,safety:stageSafety,flashGate:stageFlashGate},
        entranceMedia:{getService:()=>packTransport.service,fetch,AbortController},
        skinPresentation:{fonts:tavernFonts,appearance:stageSkinAppearance,forDevice:stageSkinForDevice},
        skinResources:{setTimeout,clearTimeout,classic:BUILTIN_STAGE_SKINS.classic},
        skinContract:{stageSkinImageOf,stageSkinSliceEdges,stageSkinScreenFiles,stageSkinPortraitOrder,skinContrast},
        skinReadableInk:forkSurfaces.readableInk,
        useBubbles, Icon,
        controller:{useLiveView:useLiveTavernView,storyTurn:tavernStoryTurnForDshTurn,useCoordination:useTavernCoordination,rpc,phoneCall:()=>typeof phoneModCall==='object'?phoneModCall:null,
            dialogue:{color:bubbleColor,displayName:bubbleDisplayName,moodBadge:bubbleMoodBadge,moods:bubbleMoodList,actor:stageActorCharacter},figures:{layers:createPackSceneLayers,performance:packPerformanceScene,render:packFigureRenderInputs,reactions:packFigureReactions,still:packStillMedia},
            modClients:tavernModClients,narration:stageNarrationPresentation,offstage:stageOffstage,skinFigures:stageSkinFigures,phoneBeat:stageSourceBeat,playEvents:tavernPlayEvents,
            // 场景生图 pictures of the round on screen (stage-scene-images.js): the CG insert pages and the 「正在生成 CG…」 notice.
            pictures:{use:useStagePictures}},
        // Clip export (clip-export.cjs) lives in the stage package; these are the core names it uses.
        clipExport:{rpc,Icon,Spinner,EmptyState,overlayEscape,useOverlay,InlineField},
        controllerLegacy:{film:stageFilm,background:useBgManualScene,widgetTheme:useWidgetTheme,entryContext:stageEntryContextType,entryStore:createStageEntryStore},
        // 设置 › 舞台 (stage global-settings.js): the page's core rows and controls (modules/global-settings.js).
        globalSettings:stageGlobalSettingsOptions,
        // 素材库 / 舞台 tab pages (stage asset-pack-{gen,card,engine}-ui.js, mod-manager.js): the core asset-pack closure's names in, its stage names bound back (asset-pack-ui.js stageScope).
        assetPack:packUi.stageScope,
        admission:{performance, setTimeout, clearTimeout, Spinner},
        widgets:{sandbox:WidgetSandbox, sounds:forkUiSfx, report:useStageEntryState, entries:stageEntries, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame},
        phoneAdjust:{navigator, pad:8, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame},
        skinDecoration:{clock:forkForeground, MutationObserver:globalThis.MutationObserver, ResizeObserver:globalThis.ResizeObserver},
        skinCursor:{matchMedia, clock:forkForeground},
        effects:{policy:{STAGE_EFFECT_BEATS, STAGE_EFFECT_LOOKS, STAGE_EFFECTS, stageEffectResolve, stageSafety, stageEffectRed, stageEffectLuma, stageFlashDark, stageFlashSafe, stageFlashGate, stageFlashAt, stageShakeAt, stagePulseAt, stageGlitchAt},loadScript:forkLoadScript,filtersUrl:PIXI_VENDOR+"pixi-filters.js",thunder:(...args)=>stageSfx.thunder(...args)},
        looks:{math:stageLookMath,fade:stageLookFadeMs,Image},
        spineFigures:{rig:spineRig,bottomFade:packSpineBottomFade},
        // Live2D is the stage's on-demand module (dsh-tavern-live2d, stage live2d-loader.cjs); the core holds no Live2D code.
        // `host`: the core names the module uses (the shared runtime entry, the pixi loader); `measure`: the core's figure measurement.
        live2d:{host:{rpc,Spinner,RUNTIMES,RuntimeEntry,vendorRuntimeStore,forkLoadScript,loadPixiRuntime,forkLipSync,galResolution,galFollowResolution,resolveFigureSizing},
            measure:{figureMeasureLive2d,figureMeasurePackLive2d,figureMeasureLive2dHead,figureMeasureLive2dCentre,figureKnowsBody,packFigureAnatomy,packFigureRecord}},
        sceneServices:{foreground:forkForeground,lipSync:forkLipSync,loadPixi:loadPixiRuntime,resolution:galResolution,subscribeResolution:galResolutionSubscribe,
            layered:{urls:layeredSpriteUrls,paint:layeredSpritePaint,voice:layeredSpriteVoice},canvas:{paint:stagePaintEmpty,palette:stageEmptyPalette}},
        sceneFigureProtocol:{FIGURE_DISPLAY,figureSceneFrame,figureSceneUpdate,figureMixedWarning,resolveFigureSizing},
        sceneLighting:{stageLighting,stageApplyLight},
        sceneColorMath:{galMatrix,galClamp01},
        figureScale:{FIGURE_DISPLAY,figureDisplayCm,figurePixelsPerCm,figureGroundY},
        figureMetrics:{source:figureSource,measure:figureMeasureTexture,anatomy:packFigureAnatomy,record:packFigureRecord,resolve:resolveFigureSizing,bodyCentre:figureBodyCentre},
        figureBlink:{clock:forkForeground},
        callViews:{subscribeFrames:callback=>typeof phoneModCall==='object' && phoneModCall?.frames ? phoneModCall.frames(callback) : null},
        backgrounds:{correction:galLayerCorrection,timeGrade:galTimeGrade},
        sceneGraphics:{paintEmpty:stagePaintEmpty,emptyPalette:stageEmptyPalette},
        textcard:{clock:forkForeground},
        textcardFonts:{FontFace:globalThis.FontFace,fonts:tavernFonts},
        textcardPlayer:{performance,requestAnimationFrame,cancelAnimationFrame,setInterval,clearInterval,setTimeout,clearTimeout},
        textcardLayout:{getComputedStyle,figureTextColor,figurePlateColor},
        choices:{ReactDOM,playEvents:tavernPlayEvents,sounds:forkUiSfx,useSounds:useForkUiSfxControls,episode:stageWaitLinesEpisode,waitLines:STAGE_WAIT_LINES,TextArea,Icon,StageWaitStop,StageWaitLines,getComputedStyle,ResizeObserver:globalThis.ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame},
        choiceLayout:{getComputedStyle},
        regenerate:{report:(...args)=>tavernErrorHub.report(...args),sounds:forkUiSfx,useSounds:useForkUiSfxControls,episode:stageWaitLinesEpisode,waitLines:STAGE_WAIT_LINES,HelpTip,Segmented,TextArea,StageWaitStop,StageWaitLines},
        backlogView:{voicePlayer,modClients:tavernModClients,useJumpLatest,JumpLatest,useFigureTextContrast,bubbleCharacter,galQuoted,VoiceButton,PackImage,Icon,HelpTip,Spinner,getComputedStyle,ResizeObserver:globalThis.ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame},
        backlogHistory:{read:sessionId=>rpc('getStageModHistory',{},sessionId), subscribe:(sessionId,refresh)=>tavernSessionSignals.subscribe(sessionId,'stage-direction',refresh,refresh,refresh)},
        backlogVoice:{player:voicePlayer, wake:()=>forkLipSync?.wake?.()},
        backlogRows:{registry:createStagePerformanceRegistry, core:STAGE_PERFORMANCE_CORE, pointer:stagePerformancePointer},
        configAppearance:{getComputedStyle, rpc, cards:bubbleStore, reading:stageReading, quality:stageQuality, sounds:forkUiSfx, FloatingPanel, Icon, Spinner, ResetButton},
        configText:{reading:stageReading, limits:STAGE_READING_LIMITS, defaults:STAGE_READING_DEFAULTS, scale:STAGE_TEXT_SCALE, scaleOf:stageTextScaleOf, fonts:tavernFonts, FontPicker, clock:forkForeground, autoDelay:galAutoDelay},
        configScreen:{matchMedia, rpc, sections:STAGE_CONFIG_SECTIONS, useSounds:useForkUiSfxControls, sounds:forkUiSfx, Icon, },
        configFields:{HelpTip, Segmented, Slider, ResetButton, FontPicker, InlineField, sounds:forkUiSfx, classify:type=>type===GalConfigSwitch?"toggle":null},
        phoneLayout:{storage:(() => {try {return localStorage;} catch (_) {return null;}})(), width:()=>innerWidth, ResetButton, sections:STAGE_CONFIG_SECTIONS},
        cg:{ResizeObserver, clock:forkForeground, consumer:createCgConsumer, paint:cgPaintFrame, policy:cgMotionPolicy, rpc},
        gallery:{ResizeObserver, IntersectionObserver, AbortController, clock:forkForeground, consumer:createCgConsumer, paint:cgPaintFrame, revision:usePackRevision, rpc, Spinner, EmptyState,
            // 回想 › 在素材库中编辑: the 素材库 tab opened at that CG entry (asset-launcher.js stageNav).
            openLibrary:(sessionId,target)=>stageNav(sessionId).openLibrary(target)},
        // 卡片页面 (stage status-panel.cjs): each page frame is the core message-frame lifecycle (the text-mode card HTML
        // document, Helper and trust model) with the session slash executor message frames use; the page's data is re-read
        // after each session state signal while open; asset() reads the card's bound packs through the pack service.
        // newGame() asks with the core confirm, and the sidebar opens the session card's 游戏准备 (dsh-tavern-new-game).
        // newGame(id, {fresh:true}) (a never-played chat) resolves true when the sidebar opened a 游戏准备 that replaces it,
        // false when there is nothing to prepare (no listener answers: false).
        statusPanel:{rpc, signals:{subscribe:(id,refresh)=>tavernSessionSignals.subscribe(id,'tavern-state',refresh,()=>{},refresh)}, themeTokens:stageWidgetThemeTokens, sounds:forkUiSfx,
            confirm:askTavernConfirm, newGame:(sessionId,options)=>new Promise(resolve=>{const detail={sessionId,fresh:options?.fresh===true,respond:resolve};window.dispatchEvent(new CustomEvent('dsh-tavern-new-game',{detail}));if(!detail.handled)resolve(false);}),
            // startOpening(id, {openingId, values, withoutGreeting}): a card's opening page starts the game (the sidebar's
            // one start path, dsh-tavern-stage-opening); it settles once the game stands and the stage has entered it.
            startOpening:(sessionId,choice)=>new Promise((resolve,reject)=>{const detail={sessionId,choice,respond:resolve,fail:reject};window.dispatchEvent(new CustomEvent('dsh-tavern-stage-opening',{detail}));if(!detail.handled)reject(new Error('开始游戏不可用'));}),
            useLiveView:useLiveTavernView, packService:()=>packTransport?.service,
            createCardFrame:props=>createTavernMessageFrameLifecycle(props,{executeSlash:stageCardPageSlash()})},
        device:{matchMedia},
        mixer:{reading:stageReading, voiceRateLimits:STAGE_READING_LIMITS.voiceRate, Icon, Slider, audio:forkStageAudio, sounds:forkUiSfx, entries:stageEntries, report:useStageEntryState, icons:ICON_PATHS},
        sfx:{Audio, audio:forkStageAudio, foreground:forkForeground},
        music:{audio:forkStageAudio,foreground:forkForeground,fetch,AbortController},
        bgm:{
            read:id => rpc("getStageMusicTracks",{},id), storage:(() => {try {return localStorage;} catch (_) {return null;}})(), authority:source => stageResourceAuthority(source)},
        ambience:{authority:source => stageResourceAuthority(source)},
        soundscape:{Audio, mixer:forkStageAudio},
        timer:{rpc, crypto, performance, setInterval, clearInterval, Icon, foreground:forkForeground, ResizeObserver, MutationObserver,
            resourceAuthority:stageResourceAuthority, useModOptions},
        video:{getService:() => packTransport.service, fetch, URL, stageVideo, audio:forkStageAudio, foreground:forkForeground, setTimeout, clearTimeout},
        loader:{getService:() => packTransport.service, fetch, URL, AbortController},
        transitions:{getComputedStyle, DOMMatrixReadOnly, setTimeout, clearTimeout},
        speaker:{character:bubbleCharacter,resolve:(...args) => figureResolution.resolveFigureName(...args),latin:figureResolution.figureLatinAlias,render:packFigureRenderInputs},
        chatEntry:{MutationObserver,markdown:TavernColoredMarkdown,enter:galEnter,plain:galPlain,blocks:galBlocks,paragraphs:galParagraphs,parse:parseBubbles,schedule:setTimeout,cancel:clearTimeout},
        menu:{sounds:forkUiSfx},
        position:{storage:(() => {try {return localStorage;} catch (_) {return null;}})(), setTimeout, clearTimeout},
        subtitles:{foreground:forkForeground, fonts:tavernFonts, getComputedStyle, ResizeObserver, heldTail:stagePageHeldTail, quote:galQuoted},
        notices:{foreground:forkForeground, displayPreferences, getSelection, StageWaitStop, Spinner, Icon, providerRefusal:tavernProviderRefusalNotice, errorText:stageRuntimeErrorText, diagnosticText:stageDiagnosticText},
        hints:{storage:forkFrameStorage,setTimeout,clearTimeout},
        presentation:{foreground:forkForeground, titleTiming:STAGE_EFFECTS.title, matchMedia, getComputedStyle, ResizeObserver, MutationObserver},
        portraits:{foreground:forkForeground, SpriteImage, PackImage, MutationObserver, getComputedStyle, matchMedia},
        labels:{getComputedStyle, ResizeObserver, requestAnimationFrame, cancelAnimationFrame},
        text:{performance, ResizeObserver, getComputedStyle, clock:forkForeground,
            fonts:tavernFonts, sounds:forkUiSfx, defaultTextSpeed:STAGE_READING_DEFAULTS.textSpeed}});
    stageViews = views;
    let stopBgm = null, disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (stageViews === views) stageViews = null;
        const errors = [];
        for (const cleanup of [() => stopBgm?.(), bgmChanged, () => views.dispose()]) {
            try { cleanup(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Stage views cleanup failed');
    };
    try {
        stopBgm = views.bgm.subscribe(bgmChanged);
        bgmChanged();
        return dispose;
    } catch (error) {
        try { dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Stage view binding failed'); }
        throw error;
    }
}
