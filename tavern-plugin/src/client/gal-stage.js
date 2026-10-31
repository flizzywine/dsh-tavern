// galgame stage view.
// A presentation of the same reply the chat view shows: it never writes story, variables
// or prompts. The session runtime owns text, observation and accepted presentation.
// The chat view can stay frozen or unmounted; backlog reads the same session index.

// @include-domain stage-narration.cjs
// @include widget-source.js
// @include-mod phone/stage-phone.cjs
// @include stage-offstage.cjs
// @include-protocol stage-pacing.cjs
// @include-protocol stage-soundscape.cjs
// @include gal-history.js
// @include mod-performance.js
// @include textcard-stage.js
// @include gal-entry.js
// @include stage-video.js
// @include stage-entrance.js
// @include timer-stage.js

// @include gal-stage-helpers.cjs
// @include gal-stage-active.cjs
function GalTypewriter(props) {
    return stageViews ? React.createElement(stageViews.Typewriter, props) : null;
}
function GalNarrationLines(props) {
    return stageViews ? React.createElement(stageViews.NarrationLines, props) : null;
}
function GalBoxFrame(props) { return stageViews ? React.createElement(stageViews.BoxFrame, props) : null; }
// Scene names are 「地点·细节·时间」. When the cued scene has no picture yet (待补图), stand in with the
// closest picture of the card's range: shared place words first, then the same time of day, and grade
// the picture towards the wanted time (a night filter over a daytime street) rather than show sunshine.
const GAL_TIMES = [["night", /夜|晚上|深夜|午夜/], ["dusk", /黄昏|傍晚|夕/], ["day", /清晨|早晨|早上|晨|白天|昼|中午|午后|下午|上午|晴/]];
function galTimeOf(name) { const hit = GAL_TIMES.find(([, pattern]) => pattern.test(String(name || ""))); return hit ? hit[0] : ""; }
function galStandIn(name, entries) {
    const parts = String(name || "").split(/[·・\s]+/).filter(part => part && !galTimeOf(part));
    const time = galTimeOf(name);
    let best = null, bestScore = 0;
    entries.forEach(function (entry) {
        const words = entry.name.split(/[·・\s]+/);
        let score = 0;
        parts.forEach(part => { if (words.includes(part)) score += 4; else if (words.some(word => word.includes(part) || part.includes(word))) score += 2; else { const shared = new Set([...part].filter(ch => entry.name.includes(ch))).size; if (shared >= 2) score += shared * 0.8; } });
        if (time && galTimeOf(entry.name) === time) score += 1.5;
        if (score > bestScore) { best = entry; bestScore = score; }
    });
    return bestScore >= 1.5 ? best : null;
}
function GalFace(props) { return stageViews ? React.createElement(stageViews.Face, props) : null; }
function GalSide(props) { return stageViews ? React.createElement(stageViews.Side, props) : null; }
function galPlaceholderFace(...args) { return stageViews.placeholderFace(...args); }
function GalTitle(props) { return stageViews ? React.createElement(stageViews.Title, props) : null; }
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
function useStageFilm() { return React.useSyncExternalStore(stageFilm.subscribe, stageFilm.get); }
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
const STAGE_READING_DEFAULTS = { textSpeed: 28, autoWait: STAGE_AUTO.wait, autoSpeed: STAGE_AUTO.speed, voiceRate: 1, frameCap: 60, reducedMotion:false, photosensitive:true, textScale:{}, hudReveal:null };
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
    if ([0, 30, 60, 120].includes(saved.frameCap)) out.frameCap = saved.frameCap;
    for (const key of ['reducedMotion','photosensitive']) if (typeof saved[key] === 'boolean') out[key]=saved[key];
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
            cached = stageReadingPrefs({ ...get(), ...patch });
            try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch (_) {}
            listeners.forEach(fn => fn());
        },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
function useStageReading() { return React.useSyncExternalStore(stageReading.subscribe, stageReading.get); }


function useGalFaceColumn(...args) { return stageViews.useFaceColumn(...args); }
function useGalFaceHandoff(...args) { return stageViews.useFaceHandoff(...args); }
function galFaceClearMs(...args) { return stageViews.faceClearMs(...args); }
function galHandoffAutoDelay(...args) { return stageViews.handoffAutoDelay(...args); }
function useGalSpriteFallbacks(...args) { return stageViews.notices.useSpriteFallbacks(...args); }
function GalStandIns(props) { return stageViews ? React.createElement(stageViews.StandIns, props) : null; }
// an on-stage Live2D figure is showing its static sprite (or nothing) because
// this machine has no Cubism Core (the user imports it: official page, then the file). One ⚠ notice 「Live2D 未安装 · 安装」; 安装 unfolds the shared licence + install entry
// (CubismCoreEntry, as in 设置 › DSH Tavern › 运行库) in place. Installing re-reads the stage (stage-session-binding.js),
// so the figures switch to Live2D without a reload; the notice goes as soon as the Core is in.

// first-run hints, shown in the stage's notice stack (not a modal) once the entry
// is revealed. keys: the stage's real shortcuts (GAL_SHORTCUTS), once per profile — 「已看过」 is kept in the persisted
// host-only frame storage (forkFrameStorage.seen / markSeen, frame-storage.json), which survives restarts and port changes;
// nothing shows before that store has loaded, nor without it. sound: 「点任意处开启声音」 while the browser's autoplay policy
// holds the BGM back (stageMusic.blocked()), at most once per page load. Any key or click dismisses both; the same
// gesture resumes the audio (the BGM kick and the mixer resume listen to it). A click on the bare stage only dismisses
// (it does not also turn the page); keys pass through (A still starts auto). the first page turn
// (auto, skip or a click) also retires the key list, and the system menu's 「快捷键」 shows it again (showKeys).
const GAL_NO_PHONE_CALL = Object.freeze({ subscribe: () => () => {}, stage: () => '' });
function useGalFirstRunHints(...args) { return stageViews.hints.useHints(...args); }
// The text box's wait names it (its aria-label); the default one shows the rotating wait lines (wait-lines.js).
const GAL_AWAITING_WRITING = '正在书写下一幕';
function galAwaitingText(activity) {
    if (activity?.role === 'settlement' && (activity.busy || ['pending', 'running'].includes(activity.phase))) {
        return '正在等待上一轮后台结算，完成后开始正文';
    }
    return GAL_AWAITING_WRITING;
}
function useCapabilityNotice(...args) { return stageViews.notices.useCapabilityNotice(...args); }
function GalRuntimeStatus(props) { return stageViews ? React.createElement(stageViews.notices.Status, props) : null; }
// a stage moment's skin cue, or (cue "") the shown skin's palette (returns its
// cleanup). Pages without the UI sound module (tests, previews) stay silent.
function galSkinSfx(cue, palette) {
    const sfx = typeof forkUiSfx === "object" && forkUiSfx ? forkUiSfx : null;
    if (cue) return void sfx?.play?.(cue);
    sfx?.useSkin?.(palette || null);
    return () => sfx?.useSkin?.(null);
}
function useGalNarrow() { return stageViews.useNarrow(); }
function useGalTopbarGroup(...args) { return stageViews.useTopbarGroup(...args); }
function useGalHudReveal(...args) { return stageViews.useHudReveal(...args); }

function GalHudLabels(props) {
    return stageViews ? React.createElement(stageViews.HudLabels, props) : null;
}
function GalNamePlate(props) {
    return stageViews ? React.createElement(stageViews.NamePlate, props) : null;
}
function galNameParts(...args) { return stageViews.nameParts(...args); }

// Stable slots render only the optional plugin's current view implementation.
let stageViews = null;
function GalStageHost(props) {
    const enabled = React.useSyncExternalStore(galStageAvailable.subscribe, galStageAvailable.get);
    return enabled && stageViews ? React.createElement(stageViews.Host, props) : null;
}
function GalStageToggle(props) {
    const enabled = React.useSyncExternalStore(galStageAvailable.subscribe, galStageAvailable.get);
    return enabled && stageViews ? React.createElement(stageViews.Toggle, props) : null;
}
function bindStageViews(createViews) {
    if (stageViews) throw new Error('Stage views already mounted');
    const views = createViews({React, ReactDOM, window, document, navigation:stageNavigation,
        speech:{player:voicePlayer,available:()=>!!forkTtsScope?.get('ttsClient')?.available(),speechInput:segmentSpeechInput,character:bubbleCharacter,language:characterVoiceLanguage,open:(id,args)=>rpc('openAssetPackVoice',args,id)},
        sourceWidgets:{storage:(()=>{try{return localStorage;}catch{return null;}})(),foreground:forkForeground,rpc,signals:tavernSessionSignals,characters:{character:bubbleCharacter,mood:bubbleMood,moods:bubbleMoodList,actor:stageActorCharacter},avatarCache,phoneProtocol:{phoneModDirect,phoneModOwnership,run:phoneModRun},figureResolution,playerErrorText,fetch,createImageBitmap,
            sandbox:{stopSfx:()=>stageWidgetMediaOwner?.stopSfx(),scroll:(id,...args)=>stageWidgetScrollTargets.get(id)?.wheel(...args),theme:root=>stageWidgetThemeOwners.get(root)}},
        modSurface:{timing:{validate:validateStagePerformanceTiming,overlaps:stagePerformanceRegionsOverlap},readMedia:(id,args)=>rpc('readStageModMedia',args,id),readItems:(id,turn)=>rpc('getStageItems',{turn},id),readViews:id=>rpc('getModStageViews',{sessionId:id},id),subscribe:(id,...callbacks)=>tavernSessionSignals.subscribe(id,'mod-view',...callbacks),useLiveView:useLiveTavernView},
        performanceSurface:{fonts:tavernFonts,resolution:galResolution,subscribeResolution:galResolutionSubscribe,policy:{stageFlashAt,stageFlashDark,stageFlashGate,stageFlashSafe,stageSafety,stageEffectHex,stageEffectRgb}},
        textIndex:{pageCards:stagePageCards},
        playbackTiming:{delay:stageAutoDelay,remaining:stageAutoRemaining},
        performances:{read:id=>rpc('getStagePerformanceKinds',{},id),registry:createStagePerformanceRegistry,core:STAGE_PERFORMANCE_CORE},
        directorCommands,
        resourceDependencies:{stageResourceMatches,createPerformanceTimeline,performanceSustained},
        runtimeProtocol:{performanceStateKernel:{performanceSustained,reducePerformanceEvent},modProjectionKernel:{modPerformanceLedgerKey},phoneBeatKernel:{phoneModAutoVoiceAllowed},
            performanceKindsKernel:{stagePerformanceKindOf,stagePerformanceBlocks,stagePerformancePhaseBlocks,STAGE_PERFORMANCE_CORE}},
        entranceContract:stageEntranceContract,
        entrance:{reading:stageReading,safety:stageSafety,flashGate:stageFlashGate},
        entranceMedia:{getService:()=>packTransport.service,fetch,AbortController},
        skinPresentation:{fonts:tavernFonts,files:getStageBundleFiles,appearance:stageSkinAppearance},
        skinResources:{setTimeout,clearTimeout},
        skinContract:{stageSkinImageOf,stageSkinSliceEdges,stageSkinScreenFiles,skinContrast},
        useBubbles, Icon,
        controller:{useLiveView:useLiveTavernView,storyTurn:tavernStoryTurnForDshTurn,useCoordination:useTavernCoordination,rpc,phoneCall:()=>typeof phoneModCall==='object'?phoneModCall:null,
            dialogue:{color:bubbleColor,displayName:bubbleDisplayName,moodBadge:bubbleMoodBadge,moods:bubbleMoodList,actor:stageActorCharacter},figures:{layers:createPackSceneLayers,performance:packPerformanceScene,render:packFigureRenderInputs,reactions:packFigureReactions},
            DiceRolls,DiceThrow,narration:stageNarrationPresentation,offstage:stageOffstage,skinFigures:stageSkinFigures,phoneBeat:phoneModBeat},
        controllerLegacy:{film:stageFilm,background:useBgManualScene,widgetTheme:useWidgetTheme,entryContext:stageEntryContextType,entryStore:createStageEntryStore},
        admission:{performance, setTimeout, clearTimeout, Spinner},
        widgets:{sandbox:WidgetSandbox, sounds:forkUiSfx, report:useStageEntryState, entries:stageEntries, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame},
        phoneAdjust:{navigator, pad:8, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame},
        skinDecoration:{clock:forkForeground, MutationObserver:globalThis.MutationObserver, ResizeObserver:globalThis.ResizeObserver},
        skinCursor:{matchMedia, clock:forkForeground},
        effects:{policy:{STAGE_EFFECT_BEATS, STAGE_EFFECT_LOOKS, STAGE_EFFECTS, stageEffectResolve, stageSafety, stageEffectRed, stageEffectLuma, stageFlashDark, stageFlashSafe, stageFlashGate, stageFlashAt, stageShakeAt, stagePulseAt, stageGlitchAt},loadScript:forkLoadScript,filtersUrl:PIXI_VENDOR+"pixi-filters.js",thunder:(...args)=>stageSfx.thunder(...args)},
        looks:{math:stageLookMath,fade:stageLookFadeMs,Image},
        spineFigures:{rig:spineRig,bottomFade:packSpineBottomFade},
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
        danmaku:{Image,getComputedStyle,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,performance},
        danmakuUi:{sections:STAGE_CONFIG_SECTIONS,entries:stageEntries,report:useStageEntryState,confirm:useTavernConfirm,sounds:forkUiSfx,setTimeout,clearTimeout},
        textcard:{clock:forkForeground},
        textcardFonts:{FontFace:globalThis.FontFace,fonts:tavernFonts},
        textcardPlayer:{performance,requestAnimationFrame,cancelAnimationFrame,setInterval,clearInterval,setTimeout,clearTimeout},
        textcardLayout:{getComputedStyle,figureTextColor,figurePlateColor},
        choices:{ReactDOM,sounds:forkUiSfx,useSounds:useForkUiSfxControls,episode:stageWaitLinesEpisode,waitLines:STAGE_WAIT_LINES,TextArea,Icon,StageWaitStop,StageWaitLines,getComputedStyle,ResizeObserver:globalThis.ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame},
        choiceLayout:{getComputedStyle},
        regenerate:{report:(...args)=>tavernErrorHub.report(...args),sounds:forkUiSfx,useSounds:useForkUiSfxControls,episode:stageWaitLinesEpisode,waitLines:STAGE_WAIT_LINES,HelpTip,Segmented,TextArea,StageWaitStop,StageWaitLines},
        backlogView:{voicePlayer,useDiceBacklog,diceBacklogEntries,diceLine,useClipBacklog:typeof useClipBacklog==='function'?useClipBacklog:undefined,useJumpLatest,JumpLatest,useFigureTextContrast,bubbleCharacter,galQuoted,VoiceButton,PackImage,Icon,HelpTip,Spinner,getComputedStyle,ResizeObserver:globalThis.ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame},
        backlogHistory:{read:sessionId=>rpc('getStageModHistory',{},sessionId), subscribe:(sessionId,refresh)=>tavernSessionSignals.subscribe(sessionId,'stage-direction',refresh,refresh,refresh)},
        backlogVoice:{player:voicePlayer, wake:()=>forkLipSync?.wake?.()},
        backlogRows:{registry:createStagePerformanceRegistry, core:STAGE_PERFORMANCE_CORE, pointer:stagePerformancePointer},
        configAppearance:{getComputedStyle, rpc, cards:bubbleStore, reading:stageReading, quality:stageQuality, sounds:forkUiSfx, FloatingPanel, Icon, Spinner, ResetButton},
        configText:{reading:stageReading, limits:STAGE_READING_LIMITS, defaults:STAGE_READING_DEFAULTS, scale:STAGE_TEXT_SCALE, scaleOf:stageTextScaleOf, fonts:tavernFonts, FontPicker, clock:forkForeground, autoDelay:galAutoDelay},
        configScreen:{matchMedia, rpc, sections:STAGE_CONFIG_SECTIONS, useSounds:useForkUiSfxControls, sounds:forkUiSfx, Icon, },
        configFields:{HelpTip, Segmented, Slider, ResetButton, FontPicker, InlineField, sounds:forkUiSfx, classify:type=>type===GalConfigSwitch?"toggle":null},
        phoneLayout:{storage:(() => {try {return localStorage;} catch (_) {return null;}})(), width:()=>innerWidth, ResetButton, sections:STAGE_CONFIG_SECTIONS},
        cg:{ResizeObserver, clock:forkForeground, consumer:createCgConsumer, paint:cgPaintFrame, policy:cgMotionPolicy, rpc},
        gallery:{ResizeObserver, IntersectionObserver, AbortController, clock:forkForeground, consumer:createCgConsumer, paint:cgPaintFrame, revision:usePackRevision, rpc, Spinner},
        device:{matchMedia},
        mixer:{reading:stageReading, voiceRateLimits:STAGE_READING_LIMITS.voiceRate, Icon, Slider, audio:forkStageAudio, sounds:forkUiSfx, entries:stageEntries, report:useStageEntryState, icons:ICON_PATHS},
        sfx:{Audio, audio:forkStageAudio, foreground:forkForeground, matches:stageResourceMatches},
        music:{audio:forkStageAudio,foreground:forkForeground,fetch,AbortController},
        bgm:{
            read:id => rpc("getStageMusicTracks",{},id), storage:(() => {try {return localStorage;} catch (_) {return null;}})(), authority:source => stageResourceAuthority(source)},
        ambience:{authority:source => stageResourceAuthority(source)},
        soundscape:{Audio, mixer:forkStageAudio},
        timer:{rpc, crypto, performance, setInterval, clearInterval, Icon, foreground:forkForeground, ResizeObserver, MutationObserver,
            resourceAuthority:stageResourceAuthority, useModOptions},
        video:{getService:() => packTransport.service, fetch, URL, stageVideo, audio:forkStageAudio, foreground:forkForeground, setTimeout, clearTimeout},
        loader:{getService:() => packTransport.service, fetch, URL, AbortController, decodeImage:stageDecodeImage},
        transitions:{getComputedStyle, DOMMatrixReadOnly, setTimeout, clearTimeout},
        speaker:{character:bubbleCharacter,resolve:(...args) => figureResolution.resolveFigureName(...args),render:packFigureRenderInputs},
        chatEntry:{MutationObserver,markdown:TavernColoredMarkdown,enter:galEnter,plain:galPlain,blocks:galBlocks,paragraphs:galParagraphs,parse:parseBubbles,schedule:setTimeout,cancel:clearTimeout},
        menu:{sounds:forkUiSfx},
        position:{storage:(() => {try {return localStorage;} catch (_) {return null;}})(), setTimeout, clearTimeout, sameAnchor},
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
