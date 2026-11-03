// The stage client is its own ES module, not a row of the host's client combo: the core
// imports it on demand (src/client/stage-client-loader.cjs) once a session needs the stage
// and starts it with ctx.plugin(). A card without the stage never downloads or runs this file.
const stageClientPlugin = (() => {
        __STAGE_NAVIGATION__
        __STAGE_TEXT__
        __STAGE_SPEAKER__
        __STAGE_CHAT_ENTRY__
        __STAGE_MENU__
        __STAGE_POSITION__
        __STAGE_SUBTITLES__
        __STAGE_TRANSITIONS__
        __STAGE_SKIN_BUTTONS__
        __STAGE_CONTROLS__
        __STAGE_NOTICES__
        __STAGE_HINTS__
        __STAGE_PRESENTATION__
        __STAGE_PORTRAITS__
        __STAGE_LABELS__
        __STAGE_LOADER__
        __STAGE_ADMISSION__
        __STAGE_PROGRESS__
        __STAGE_VIDEO__
        const timerClock = (() => {
            __TIMER_CLOCK__
            return {timerClockRemaining};
        })();
        __STAGE_TIMER__
        __STAGE_SOUNDSCAPE__
        __STAGE_AMBIENCE__
        __STAGE_FIGURE_GEOMETRY__
        __STAGE_FIGURE_MOTION_MATH__
        __STAGE_FIGURE_MOTION__
        __STAGE_FIGURE_IDLE__
        __STAGE_FIGURE_WARP__
        __STAGE_FIGURE_TAP__
        __STAGE_EFFECT_COLORS__
        __STAGE_WEATHER__
        __STAGE_EMOTES__
        __STAGE_LOOK_SHADERS__
        __STAGE_LOOK_ART__
        __STAGE_LOOK_UI__
        __STAGE_SPINE_FIGURES__
        __STAGE_LIVE2D_ACTS__
        __STAGE_LIVE2D_FIGURES__
        __STAGE_LIVE2D_LOADER__
        __STAGE_BACKGROUNDS__
        __STAGE_BACKGROUND_LAYERS__
        __STAGE_RESOURCE_RUNNER__
        __STAGE_DIRECTOR_SOURCE__
        __STAGE_DISPLAY_CONSUMERS__
        __STAGE_DISPLAYS__
        __STAGE_MOD_NOTIFICATIONS__
        __STAGE_SCENE__
        __STAGE_SCENE_MATH__
        __STAGE_RUNTIME_KERNEL__
        __STAGE_SESSION_OBSERVATION__
        __STAGE_INPUT__
        __STAGE_PLAYBACK__
        __STAGE_RUNTIME_UI__
        __STAGE_SPEECH__
        __STAGE_PERFORMANCE_SURFACE__
        __STAGE_MOD_SURFACE__
        __STAGE_SOURCE_WIDGETS__
        __STAGE_CONTROLLER__
        __STAGE_SESSIONS__
        __STAGE_TEXT_INDEX__
        __STAGE_CLIENT_LIFETIME__
        __STAGE_CLIENT_ENTRY__
        // Stage media resources (resources.cjs): one module per page, as the core had it, so the avatar crops and bundle
        // files its owners record stay readable to the core's portraits after a remount (views.resources).
        __STAGE_RESOURCES__
        const stageResources = createStageResourcesModule();
        const {createStageResourceOwner} = stageResources;
        __STAGE_SESSION_RUNTIME__
        __STAGE_RUNTIME_STORE__
        __STAGE_SESSION_OWNER__
        __STAGE_FIGURE_POSE__
        __STAGE_CAST_LAYOUT__
        __STAGE_CAST__
        __STAGE_FIGURE_APPEARANCE__
        __STAGE_FIGURE_ASSETS__
        __STAGE_FIGURE_BLINK_CLOCK__
        __STAGE_FIGURE_BLINK__
        __STAGE_CALL_VIEWS__
        __STAGE_BUST__
        __STAGE_MONOLOGUE__
        __STAGE_SCENE_CAMERA__
        __STAGE_SCENE_TEXTURES__
        __STAGE_SCENE_GRAPHICS__
        __STAGE_EFFECTS__
        __STAGE_LOOKS__
        __STAGE_TEXTCARD_PRESETS__
        __STAGE_TEXTCARD_STAGE__
        __STAGE_TEXTCARD_FONTS__
        __STAGE_TEXTCARD_PLAYER__
        __STAGE_TEXTCARD_CENTER__
        __STAGE_TEXTCARD_METRICS__
        __STAGE_TEXTCARD_LAYOUT__
        __STAGE_CHOICES__
        __STAGE_CHOICE_LAYOUT__
        __STAGE_REGENERATE__
        __STAGE_BACKLOG_VIEW__
        __STAGE_BACKLOG_PAGING__
        __STAGE_BACKLOG_HISTORY__
        __STAGE_BACKLOG_VOICE__
        __STAGE_BACKLOG_ROWS__
        __STAGE_SKIN_SHAPE__
        __STAGE_SKIN_FRAME__
        __STAGE_ENTRANCE_PRESENTATION__
        __STAGE_ENTRANCE_MEDIA__
        __STAGE_ENTRANCE_RENDERER__
        __STAGE_ENTRANCE_FRAMES__
        __STAGE_ENTRANCE_LOOP__
        __STAGE_ENTRANCE_RUNTIME__
        __STAGE_SKIN_PRESENTATION__
        __STAGE_SKIN_RESOURCES__
        __STAGE_SKIN_ADAPTER__
        __STAGE_SKIN_MOTION__
        __STAGE_SKIN_BACKLOG__
        __STAGE_SKIN_CURSOR__
        __STAGE_THEMES__
        __STAGE_CONFIG_APPEARANCE__
        __STAGE_CONFIG_TEXT__
        __STAGE_CONFIG_SCREEN__
        __STAGE_CONFIG_FIELDS__
        __STAGE_WIDGETS__
        __STAGE_PHONE_ADJUST__
        __STAGE_PHONE_LAYOUT__
        __STAGE_CG__
        __STAGE_GALLERY__
        __STAGE_STATUS_PANEL__
        __STAGE_DEVICE__
        __STAGE_MIXER__
        __STAGE_SFX__
        __STAGE_MUSIC__
        __STAGE_BGM__
        __STAGE_AVAILABILITY__
        __STAGE_VIEWS__
        __STAGE_VIEW_SCOPE__
        // 设置 › 舞台 (global-settings.js): the core's settings section holds the stage client and renders views.GlobalSettings.
        __STAGE_GLOBAL_SETTINGS__
        // dsh-presentation-protocol stage-entrance.cjs: the 入场演出 contract the entrance renderer plays (the core never reads it).
        __STAGE_ENTRANCE_CONTRACT__
        // Clip export (clip-export.cjs): the backlog's export mode and the stage's export status, over the core names the
        // core passes as `clipExport` (gal-stage.js); a core that passes none has no clip export.
        function createStageClipExport({React, rpc, Icon, Spinner, EmptyState, overlayEscape, useOverlay, InlineField, stageWidgetSourcePlace}) {
            __STAGE_CLIP_EXPORT__
            return {useClipBacklog, ClipStatus};
        }
        // Clip export replay (clip-render.cjs) on the isolated export page: core = the core client's clipReplayCore() (main.js).
        function createStageClipReplay(core) {
            const {React, ReactDOM, avatarCache, bgManual, bgmPlayer, bindStageNavigation, bindStageViews, bubbleCharacter, bubbleMediaDescriptor, bubbleMoodList, bubbleStore,
                forkStageAudio, galEnter, galStageLifetime, segmentSpeechInput, spineRuntimeState, STAGE_HISTORY_SETTLE_MS, stageBlockPages, stagePageCards, stageReading, voicePlayer} = core;
            __STAGE_CLIP_RENDER__
            return mountClipReplay;
        }
        // The asset-pack pages (asset-pack-{gen,card,engine}-ui.js, mod-manager.js) are part of the core's createAssetPackUI closure in
        // source form: they run here over that closure's names (core = packUi.stageScope.names, asset-pack-ui.js) and the core binds
        // the names it uses from them (stageScope.bind). Both lists are exact.
        function createStageAssetPackViews(core) {
            const {React, autoChoices, Actions, BustArt, Button, CAST_FACE, CardImportSheet, CatAddTile, ConfirmDialog, ErrorBox, FigureCastFace, Glyph, Help, HintLine, IconButton, ImageFramer, KIND_ORDER, KindSortTools, LampMenu, Loading, MOD_BUILTIN_PACKS, MOD_GLYPHS, MenuItem, ModEntries, Modal, NewFigurePage, PackImageView, PackList, PackModal, PackRow, PackSearchBox, Popover, RevealImg, STAGE_NAMES, STAGE_REQUIRES, Silhouette, StageItemsPage, StageModPage, StageModSection, StageOpenings, StageSection, StageSetupWizard, SubpageHead, SwitchRow, Thumb, UploadButton, VOICE_PROVIDERS, cellMenuTrigger, clone, downloadPackMedia, emotionMapped, emotionState, errorText, figureAvatar, figureEditorEmotions, figureOutfitView, globalFirst, glyphs, h, holdMedia, keywordProblem, kindGlyphs, kinds, loadPackDetail, loadPackRows, newResourceKey, openingMenuFocus, openingMenuKeys, orderPacks, outfitEmotionRows, outfitHead, outfitImageId, packCount, packFilter, packRowClick, splitKeywords, spriteSlotTakesStill, stageMissing, stageSetupCardPack, stageSetupReady, standInValue, stateBust, subpageKeys, switchRowClick, useLoad, usePackScope, usePackSort, useStageFold, useStageSetupAutoOpen, useTask, useVoiceLoad, useVoiceRefresh, validDraft, voiceIssueText,
                EmptyState, InlineAdd, InlineField, InlineGrid, InlineRow, OverrideDot, ResetButton, ScopeSwitch, Segmented, Spinner, Switch, TextArea, browserSpeechVoiceList, directorCommands, playerErrorText, selectFigureAvatar, selectPackAvatar} = core;
            // dsh-presentation-protocol card-stage-mode.cjs, the card page's `// @include-protocol` (the core bundle no longer includes it).
            __STAGE_CARD_STAGE_MODE__
            __STAGE_ASSET_PACK_GEN_UI__
            __STAGE_ASSET_PACK_CARD_UI__
            __STAGE_ASSET_PACK_ENGINE_UI__
            __STAGE_MOD_MANAGER__
            return {CandidateArt, CandidateImageView, EnginePage, FigureGenTab, GEN_ART_ROLE, GEN_CELL_WORDS, GEN_PROBLEMS, GEN_REASONS, GEN_REF_LIMIT, GEN_SHEET_FACES, GenCellStatus, GenDialog, GenFaceCandidate, GenFaceMarks, GenGateNote, GenPromptSettings, GenRefChip, GenSheet, GenStageCandidate, GenStageWait, ManagedModSection, ModManager, ModManagerEntry, PackPreviews, PromptAt, PromptCatalogue, PromptOps, PromptPieces, PromptTools, ReadingsEditor, STAGE_RETURN_KEY, StageAvatar, StageKindJump, StagePage, StagePanel, catalogueEntries, commandInfo, directorPieceName, directorPromptRow, directorPromptRows, directorWire, genBasis, genCell, genFailText, genKey, genMenuKeys, genOwnSprite, genPromptFor, genReadUpload, judgeDraftProblem, judgePromptRows, judgeWithProvider, modSwitchWord, promptHeadClick, promptJson, promptJsonText, promptPackScope, promptSources, promptTokenEstimate, promptToolDefs, stageActive, stageBytesText, stageEnable, stageFigure, stageFigureRows, stageKindPacks, stagePackBytes, stagePatch, stagePrefs, stageSwitchTag, storyPromptRows, unbindPatch, useAssetGen, useElapsed, useGenNote, useManagedModControls, useStageWriter, writeStageReturn};
        }
        __STAGE_FEATURES__
        const plugin = ({
        name: 'dsh-tavern-stage',
        inject: ['tavernStageFrontend'],
        apply(ctx) {
            // Private migration bridge: the stage package owns mounting/unmounting.
            // UI implementation is being extracted from the core client closure.
            const host = ctx.get('tavernStageFrontend');
            const stageFeatures=createStageFeatures();
            stageFeatures.register('timer',{views:({options,views,own,getResourceOwner})=>({
                timer:own(createStageTimer({React:options.React,window,...options.timer,getResourceOwner,createRects:views.performanceSurface.createRects,createKeyframeLayer:views.performanceSurface.createKeyframeLayer,performanceSafety:views.performanceSurface.safety}))
            })});
            ctx.provide('stageFeatures',stageFeatures);
            const activate=() => {
                const cleanups=[];
                let disposed=false;
                const dispose=()=>{
                    if(disposed)return;disposed=true;const errors=[];
                    for(const cleanup of cleanups.splice(0).reverse())try{cleanup();}catch(error){errors.push(error);}
                    if(errors.length)throw new AggregateError(errors,'Stage activation cleanup failed');
                };
                try {
                    if(!Array.isArray(host?.registrations))throw new Error('Stage host is unavailable');
                    // Styles arrive after boot: name their owner, or the module loader claims them for
                    // whichever plugin materializes next and removes them on that plugin's reload.
                    const theme=document.createElement('style');
                    cleanups.push(()=>theme.remove());
                    theme.dataset.plugin='dsh-tavern-stage';
                    theme.dataset.pluginCss='dsh-tavern-stage/themes.css';
                    theme.textContent=__STAGE_THEME_CSS__;
                    const anchor=document.querySelector('[data-plugin-css="dsh-tavern-plugin/features-after-stage.css"]');
                    document.head.insertBefore(theme,anchor);
                    const style=document.createElement('style');
                    cleanups.push(()=>style.remove());
                    style.dataset.plugin='dsh-tavern-stage';
                    style.dataset.pluginCss='dsh-tavern-stage/presentation.css';
                    style.textContent=__STAGE_PRESENTATION_CSS__;
                    document.head.appendChild(style);
                    let activeViews=null;
                    // The core's stage registrations (main.js stageEffect) run as one owned lifetime of this activation.
                    const entry=createStageClientEntry({startLifetime:startStageClientLifetime,install:host.registrations,report:host.report});
                    const stop=entry.mount({createNavigation:createStageNavigation, createViews:options => createStageViewScope(own => {
                    // Session access stays inside this activation; stale consumers cannot reach a later plugin instance.
                    let sessions = null;
                    const getSession = id => sessions?.get(id) || null;
                    const getResourceOwner = () => sessions?.resourceOwner || null;
                    const skinResources = own(createStageSkinResources({React:options.React,...options.skinResources,getSession,getResourceOwner}));
                    const skin = own(createStageSkinAdapter({contract:options.skinContract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()}));
                    const controls = createStageControls();
                    const loader = own(createStageLoader({...options.loader,decodeImage:stageResources.stageDecodeImage,spinnerArt:skin.stageSkinSpinner}));
                    const progress = createStageProgress({React:options.React, ...options.admission});
                    own(progress.store);
                    const admission = own(createStageAdmission({React:options.React, window, document, loader, StageLoadLine:progress.Line, ...options.admission}));
                    const configFields = own(createStageConfigFields({React:options.React, ...options.configFields}));
                    const textViews = createStageText({React:options.React, document, ...options.text});
                    const configText = own(createStageConfigText({React:options.React, fields:configFields, Typewriter:textViews.Typewriter, ...options.configText, themes:STAGE_THEMES}));
                    const configAppearance = own(createStageConfigAppearance({React:options.React, window, document, fields:configFields, ...options.configAppearance, prefetch:skinResources.prefetch, themes:STAGE_THEMES, frameRate:(...args)=>sceneMath.galFrameRate(...args), handheld:()=>views.device.handheld()}));
                    const mixer = own(createStageMixer({React:options.React, fields:configFields, ...options.mixer}));
                    const phoneLayout = own(createStagePhoneLayout({React:options.React, group:configFields.group, row:configFields.row, slider:configFields.slider, Switch:configFields.Switch, ...options.phoneLayout}));
                    const phoneAdjust = own(createStagePhoneAdjust({React:options.React, window, document, sizes:phoneLayout.sizes, ...options.phoneAdjust}));
                    const music = own(createStageMusic(options.music));
                    const skinShape=own(createStageSkinShape({React:options.React,window,document,...options.skinDecoration}));
                    const skinFrame=own(createStageSkinFrame({React:options.React,...options.skinDecoration,Shape:skinShape.Shape}));
                    const backlogPaging=own(createStageBacklogPaging({React:options.React,hydrateText:(id,turn)=>sessions?.owner?.hydrateText(id,turn),hasOlder:id=>sessions?.owner?.hasOlder(id),loadOlder:id=>sessions?.owner?.loadOlder(id)}));
                    const backlogHistory=own(createStageBacklogHistory({React:options.React,...options.backlogHistory}));
                    const backlogVoice=own(createStageBacklogVoice(options.backlogVoice || {}));
                    const textIndex=createStageTextIndexModule({pageCards:options.textIndex?.pageCards,character:options.speaker?.character});
                    const backlogRows=createStageBacklogRows({...options.backlogRows,voiceDescriptor:textIndex.voiceDescriptor,textcard:textcardHistory});
                    // The clip toast places itself with the source widgets' placement (source-widgets.cjs), read once those views exist.
                    const clipExport=options.clipExport?createStageClipExport({React:options.React,...options.clipExport,stageWidgetSourcePlace:(...args)=>views.sourceWidgets.place(...args)}):null;
                    const backlogView=own(createStageBacklogView({React:options.React,window,document,...options.backlogView,...(clipExport?{useClipBacklog:clipExport.useClipBacklog}:{}),stageSkinBacklogPlate:skin.stageSkinBacklogPlate,stageSkinBacklogPlateStyle:skin.stageSkinBacklogPlateStyle,stageViews:{backlogPaging,backlogHistory,backlogVoice,backlogRows}}));
                    const choiceLayout=createStageChoiceLayout({React:options.React,...options.choiceLayout});
                    const choices=own(createStageChoices({React:options.React,window,document,...options.choices,layout:choiceLayout}));
                    const textcardCenter=own(createStageTextcardCenter({metrics:TEXTCARD_VERT_INK}));
                    const textcardLayout=createStageTextcardLayout(options.textcardLayout||{});
                    const textcardPlayers=own(createStageTextcardPlayers({document,...options.textcardPlayer,layout:textcardLayout,center:textcardCenter,createGate:createTextcardGate,peak:textcardPeak}));
                    const textcardFonts=own(createStageTextcardFonts({document,...options.textcardFonts}));
                    const textcard=own(createStageTextcard({React:options.React,window,...options.textcard,players:textcardPlayers,fonts:textcardFonts,plan:planTextcard}));
                    const sceneMath=createStageSceneMath({colorMath:options.sceneColorMath,figureScale:options.figureScale,reading:options.entrance?.reading,motion:()=>figureMotion,idle:()=>figureIdle,document,getComputedStyle:window.getComputedStyle});
                    // Live2D (dsh-tavern-live2d): the stage's on-demand module over the core's names (gal-stage.js live2d.host) and this scene math;
                    // its adapters feed the figure renderer, the runtime entries (notices, 设置 › 舞台) and the asset library's previews.
                    const live2d=options.live2d?own(createStageLive2d({React:options.React,host:{...options.live2d.host,galApplyLipSync:sceneMath.galApplyLipSync,galLipSyncIds:sceneMath.galLipSyncIds,live2dStartIdle:sceneMath.live2dStartIdle}})):null;
                    const visualMath={matrix:sceneMath.galMatrix,ease:sceneMath.galEase,clamp:sceneMath.galClamp01};
                    const spineFigures=own(createStageSpineFigures(options.spineFigures||{}));
                    const figureAssets=own(createStageFigureAssets({spineFigures,metrics:{...options.figureMetrics,headTop:sceneMath.galTextureHeadTop,bodyX:sceneMath.galBodyX}}));
                    const sceneGraphics=createStageSceneGraphics({window,document,...options.sceneGraphics});
                    const visualEffects={...visualMath,canvasTexture:sceneGraphics.canvasTexture};
                    const effectColors=own(createStageEffectColors({document}));
                    const weather=own(createStageWeather(visualEffects));
                    const looks=own(createStageLooks({document,weather,colors:effectColors,...visualEffects,...options.looks,useFilter:sceneGraphics.useFilter,shaders:createStageLookShaders(),art:createStageLookArt(visualEffects)}));
                    const emotes=own(createStageEmotes({document,...visualEffects,colors:effectColors}));
                    const effects=own(createStageEffects({window,...visualEffects,...options.effects,useFilter:sceneGraphics.useFilter,normalize:options.looks?.math?.galLookNormalize,looks,weather,emotes}));
                    const figureMotionMath=createStageFigureMotionMath({spring:sceneMath.galSpring,fade:sceneMath.galMotionFade});
                    const figureMotion=own(createStageFigureMotion({math:figureMotionMath,lipSyncIds:sceneMath.galLipSyncIds}));
                    const figureGeometry=createStageFigureGeometry();
                    const figureIdle=own(createStageFigureIdle({spring:sceneMath.galSpring,springValue:sceneMath.galSpringValue}));
                    const figureWarp=own(createStageFigureWarp());
                    const figureTap=own(createStageFigureTap({document,geometry:figureGeometry}));
                    const modRenderers={};
                    const entranceContract=stageEntranceContract();
                    const video=own(createStageVideo(options.video));
                    const entranceMedia=own(createStageEntranceMedia({...options.entranceMedia,files:entranceContract?.stageEntranceFiles}));
                    const entranceRendererScope=own(createStageEntranceRenderer({window,contractFactory:stageEntranceContract,renderer:entranceRenderer,frames:entrancePlateFrames,loop:entranceLoop}));
                    const entrance=own(createStageEntrancePresentation({React:options.React,window,renderer:entranceRendererScope,media:entranceMedia,video,contract:entranceContract,...options.entrance}));
                    const backgroundLayers=own(createStageBackgroundLayers({...visualMath,cover:sceneMath.galCover,transitionFrame:sceneMath.galTransitionFrame,wipeRect:sceneMath.galWipeRect,irisSize:sceneMath.galIrisSize}));
                    const backgrounds=own(createStageBackgrounds({...visualMath,...options.backgrounds,transition:sceneMath.galBackgroundTransition,layers:backgroundLayers}));
                    const runtimeKernel=createStageRuntimeKernel(options.runtimeProtocol || {});
                    const displays=own(createStageDisplays());
                    const sfx=own(createStageSfx({...options.sfx,matches:stageResources.stageResourceMatches}));
                    const ambience=own(createAmbience({...options.ambience, session:getSession,owner:getResourceOwner,player:() => createSoundscapePlayer(options.soundscape)}));
                    const speech=own(createStageSpeech({...options.speech,allowed:options.runtimeProtocol?.phoneBeatKernel?.phoneModAutoVoiceAllowed}));
                    const displayConsumers=own(createStageDisplayConsumers({React:options.React,displays,sfx,ambience,voice:speech}));
                    const views = {resources:stageResources,speech,sceneMath,runtimeKernel,displays,displayConsumers,sessionRuntime:own(createStageSessionRuntime({kernel:runtimeKernel,displays,createObservation:inputs=>createStageSessionObservation({...inputs,voice:speech,media:{...inputs.media,music:views.bgm,ambience}}),createModNotifications:createStageModNotifications,createResourceModule:createStageResourceRunnerModule,resourceDependencies:{...options.resourceDependencies,stageResourceMatches:stageResources.stageResourceMatches,stageRuntimeErrorText:runtimeKernel.stageRuntimeErrorText},createDirectorModule:createStageDirectorModule,directorCommands:options.directorCommands,createStoreModule:createStageRuntimeStoreModule,createSessionModule:createStageSessionModule})),figurePose:own(createStageFigurePose({resolve:options.figureMetrics?.resolve,flatLayout:sceneMath.galFlatLayout,actionAt:sceneMath.galFlatActAt,ease:visualMath.ease})),castLayout:own(createStageCastLayout({calculate:sceneMath.galFigureLayout,mix:sceneMath.galFrameMix})),cast:own(createStageCast()),figureAppearance:own(createStageFigureAppearance({graphics:sceneGraphics,spring:sceneMath.galSpring,springValue:sceneMath.galSpringValue})),figureBlink:own(createStageFigureBlink({...options.figureBlink,clockwork:{blinkUrls,blinkPlacement,blinkTimingFor,createBlinkScheduler}})),callViews:own(createStageCallViews({...options.callViews,cover:sceneMath.galCover,canvasTexture:sceneGraphics.canvasTexture})),bust:own(createStageBust({...visualMath,framedHead:sceneMath.galFramedHead})),monologue:own(createStageMonologue({canvasTexture:sceneGraphics.canvasTexture})),backgrounds,sceneCamera:createStageSceneCamera(visualMath),sceneTextures:own(createStageSceneTextures({Image:window.Image,now:()=>window.performance.now()})),spineFigures,figureAssets,sceneGraphics,entrance,skinPresentation:own(createStageSkinPresentation({React:options.React,Event:window.Event,...options.skinPresentation,files:stageResources.getStageBundleFiles,skin})),skinResources,skin,effects,lookUi:own(createStageLookUi({React:options.React})),looks,effectColors,weather,emotes,figureMotion,figureGeometry,figureIdle,figureWarp,figureTap,textcard,textcardPlayers,textcardCenter,textcardLayout,choices,choiceLayout,regenerate:own(createStageRegenerate({React:options.React,window,document,...options.regenerate})),backlogView,backlogPaging,backlogHistory,backlogVoice, skinFrame, skinCursor:own(createStageSkinCursor({React:options.React, ...options.skinCursor})), backlogRows, configAppearance, configText, configScreen:own(createStageConfigScreen({React:options.React, window, document, Sound:mixer.Sound, Text:configText.Text, Appearance:configAppearance.Appearance, ...options.configScreen})), configFields, phoneLayout, phoneAdjust, widgets:own(createStageWidgets({React:options.React, window, document, adjust:phoneAdjust.useAdjust, ...options.widgets})), cg:own(createStageCg({React:options.React, window, ...options.cg})), gallery:own(createStageGallery({React:options.React, window, document, ...options.gallery,owner:getResourceOwner})), device:own(createStageDevice({React:options.React, ...options.device})), mixer, sfx, transitions:own(createStageTransitions({React:options.React, window, ...options.transitions,ease:skin.stageSkinTxEase})), speaker:createStageSpeaker(options.speaker || {}), chatEntry:own(createStageChatEntry({React:options.React, ...options.chatEntry})), menu:own(createStageMenu({React:options.React, window, document, ...options.menu,getSession})), position:own(createStagePosition({React:options.React, window, ...options.position,sameAnchor:runtimeKernel.sameAnchor,navigate:(...args)=>sessions?.owner?.navigate(...args)})), subtitles:createStageSubtitles({React:options.React, document, window, ...options.subtitles}), controls, loader, admission, progress, notices:own(createStageNotices({React:options.React, document, ...options.notices, shortcuts:controls.shortcuts, live2d:live2d?{Entry:live2d.Entry,runtime:live2d.store}:null})), hints:own(createStageHints({React:options.React, window, document, music, ...options.hints})), music, bgm:own(createBgmPlayer({...options.bgm, music,session:getSession,owner:getResourceOwner})), ambience, video,
                        ...createStageSkinButtons({React:options.React, ...options.presentation}),
                        ...createStagePresentation({React:options.React, document, ...options.presentation}),
                        ...createStagePortraits({React:options.React, document, window, ...options.portraits,emoteDataUrl:emotes.dataUrl,cssColor:effectColors.css}),
                        ...createStageLabels({React:options.React, Icon:options.Icon, document, ...options.labels}),
                        ...textViews};
                    views.performanceSurface=own(createStagePerformanceSurface({React:options.React,window,document,clock:options.sceneServices?.foreground,...options.performanceSurface,sessions:()=>views.sessions,runtime:views.sessionRuntime}));
                    views.input=own(createStageInput({React:options.React,window,document,clock:options.sceneServices?.foreground,controls,navigation:options.navigation}));
                    views.playback=own(createStagePlayback({React:options.React,clock:options.sceneServices?.foreground,player:options.speech?.player,subtitles:views.subtitles,timing:options.playbackTiming,handoffDelay:views.handoffAutoDelay}));
                    views.runtimeUi=own(createStageRuntimeUi({React:options.React,sessions:views.sessionRuntime,kernel:runtimeKernel,performances:options.performances}));
                    views.scene=own(createStageScene({React:options.React,window,document,math:sceneMath,modules:views,services:options.sceneServices,figureScale:options.sceneFigureProtocol,lighting:options.sceneLighting,lookMath:options.looks?.math,reading:options.entrance?.reading,quality:options.configAppearance?.quality}));
                    // Live2D figures draw through the scene's figure renderer seam; the module itself loads with the first Cubism Core a scene names.
                    if(live2d){const live2dFigures=own(createStageLive2dFigures({window,math:sceneMath,idle:figureIdle,tap:figureTap,lipSync:options.sceneServices?.lipSync,runtime:live2d.runtime,measure:options.live2d.measure}));own({dispose:views.scene.figureRenderers.register('live2d',live2dFigures.renderer)});}
                    stageFeatures.mount({options,views,own,window,document,getResourceOwner});
                    views.sourceWidgets=own(createStageSourceWidgets({React:options.React,window,document,...options.sourceWidgets,views,sessions:()=>sessions}));
                    views.modSurface=own(createStageModSurface({React:options.React,window,document,...options.modSurface,sessions:()=>sessions,scene:()=>views.scene,runtime:views.sessionRuntime,renderers:modRenderers,core:options.performances?.core,useFaces:views.sourceWidgets.useFaces}));
                    if(options.statusPanel)views.statusPanel=own(createStageStatusPanel({React:options.React,window,document,...options.statusPanel,useFaces:views.sourceWidgets.useFaces}));
                    views.sessions=sessions=own(createStageSessions({views,navigation:options.navigation,clock:options.sceneServices?.foreground,window,document,startLifetime:startStageClientLifetime,textIndex}));
                    views.controller=own(createStageController({React:options.React,window,document,views,navigation:options.navigation,services:{...(options.controller || {dialogue:{},figures:{}}),ClipStatus:clipExport?.ClipStatus},legacy:options.controllerLegacy || {},options}));
                    Object.assign(views,own(createStageViews({...options,GalStage:views.controller.Stage,useGalEntryLoader:admission.useLoader})));
                    if(options.globalSettings)views.GlobalSettings=createStageSettingsModule({React:options.React,...options.globalSettings,CubismCoreEntry:live2d?.Entry}).TavernStageSettingsSection;
                    // 素材库 / 舞台 tab pages: built over the core asset-pack closure and bound into it for this activation.
                    if(options.assetPack){views.assetPack=createStageAssetPackViews(options.assetPack.names);if(live2d)views.assetPack.live2dKit=live2d.previews;own({dispose:options.assetPack.bind(views.assetPack)});}
                    activeViews=views;
                    return views;
                })});
                    cleanups.push(stop);
                    if(activeViews){
                        if(typeof host.sessionInputs!=='function')throw new Error('Stage session host is unavailable');
                        const inputs=host.sessionInputs();
                        activeViews.sessions.start({...inputs,assets:{createOwner:createStageResourceOwner,decode:stageResources.stageDecodeImage,...inputs.assets}});
                    }
                    return dispose;
                }catch(error){
                    // An optional stage failure must not reject the host's web startup.
                    // Roll back every acquired resource, retaining diagnostics for both failures.
                    let failure=error;
                    try{dispose();}catch(cleanup){failure=new AggregateError([error,cleanup],'Stage activation failed');}
                    console.error('[dsh-tavern-stage] activation failed',failure,...(failure.errors || []));
                    return dispose;
                }
            };
            ctx.effect(() => host?.availability ? watchStageAvailability({source:host.availability,activate}) : activate(), 'dsh-tavern-stage: client lifetime');
        },
        // Clip export (lib/clip/clip-export-browser.js): mounts this plugin on the isolated export page over the core's names.
        mountClipReplay: (core, snapshot, transport) => createStageClipReplay(core)(snapshot, transport, plugin)
    });
    return plugin;
})();
export default stageClientPlugin;
