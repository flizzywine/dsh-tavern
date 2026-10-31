window.__ModuleLoader__.load({
    id: 'dsh-tavern-stage',
    factory: () => {
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
        __STAGE_DANMAKU_DISPLAY__
        __STAGE_DANMAKU_SCHEDULER__
        __STAGE_DANMAKU_SESSION__
        __STAGE_DANMAKU_AVATAR__
        __STAGE_DANMAKU_RENDERER__
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
        __STAGE_LIVEROOM__
        __STAGE_DANMAKU_UI__
        __STAGE_DANMAKU_SETTINGS__
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
        __STAGE_DEVICE__
        __STAGE_MIXER__
        __STAGE_SFX__
        __STAGE_MUSIC__
        __STAGE_BGM__
        __STAGE_VIEWS__
        __STAGE_VIEW_SCOPE__
        return ({
        name: 'dsh-tavern-stage',
        inject: ['tavernStageFrontend'],
        apply(ctx) {
            // Private migration bridge: the stage package owns mounting/unmounting.
            // UI implementation is being extracted from the core client closure.
            const host = ctx.get('tavernStageFrontend');
            ctx.effect(() => {
                const cleanups=[];
                let disposed=false;
                const dispose=()=>{
                    if(disposed)return;disposed=true;const errors=[];
                    for(const cleanup of cleanups.splice(0).reverse())try{cleanup();}catch(error){errors.push(error);}
                    if(errors.length)throw new AggregateError(errors,'Stage activation cleanup failed');
                };
                try {
                    if(!host || typeof host.mount!=='function')throw new Error('Stage host is unavailable');
                    const theme=document.createElement('style');
                    cleanups.push(()=>theme.remove());
                    theme.dataset.pluginCss='dsh-tavern-stage/themes.css';
                    theme.textContent=__STAGE_THEME_CSS__;
                    const anchor=document.querySelector('[data-plugin-css="dsh-tavern-plugin/features-after-stage.css"]');
                    document.head.insertBefore(theme,anchor);
                    const style=document.createElement('style');
                    cleanups.push(()=>style.remove());
                    style.dataset.pluginCss='dsh-tavern-stage/presentation.css';
                    style.textContent=__STAGE_PRESENTATION_CSS__;
                    document.head.appendChild(style);
                    let activeViews=null;
                    const stop=host.mount({createNavigation:createStageNavigation, createViews:options => createStageViewScope(own => {
                    // Session access stays inside this activation; stale consumers cannot reach a later plugin instance.
                    let sessions = null;
                    const getSession = id => sessions?.get(id) || null;
                    const getResourceOwner = () => sessions?.resourceOwner || null;
                    const skinResources = own(createStageSkinResources({React:options.React,...options.skinResources,getSession,getResourceOwner}));
                    const skin = own(createStageSkinAdapter({contract:options.skinContract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()}));
                    const controls = createStageControls();
                    const loader = own(createStageLoader({...options.loader,spinnerArt:skin.stageSkinSpinner}));
                    const progress = createStageProgress({React:options.React, ...options.admission});
                    own(progress.store);
                    const admission = own(createStageAdmission({React:options.React, window, document, loader, StageLoadLine:progress.Line, ...options.admission}));
                    const configFields = own(createStageConfigFields({React:options.React, ...options.configFields}));
                    const textViews = createStageText({React:options.React, document, ...options.text});
                    const configText = own(createStageConfigText({React:options.React, fields:configFields, Typewriter:textViews.Typewriter, ...options.configText, themes:STAGE_THEMES}));
                    const configAppearance = own(createStageConfigAppearance({React:options.React, window, document, fields:configFields, ...options.configAppearance, prefetch:skinResources.prefetch, themes:STAGE_THEMES}));
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
                    const backlogView=own(createStageBacklogView({React:options.React,window,document,...options.backlogView,stageSkinBacklogPlate:skin.stageSkinBacklogPlate,stageSkinBacklogPlateStyle:skin.stageSkinBacklogPlateStyle,stageViews:{backlogPaging,backlogHistory,backlogVoice,backlogRows}}));
                    const choiceLayout=createStageChoiceLayout({React:options.React,...options.choiceLayout});
                    const choices=own(createStageChoices({React:options.React,window,document,...options.choices,layout:choiceLayout}));
                    const textcardCenter=own(createStageTextcardCenter({metrics:TEXTCARD_VERT_INK}));
                    const textcardLayout=createStageTextcardLayout(options.textcardLayout||{});
                    const textcardPlayers=own(createStageTextcardPlayers({document,...options.textcardPlayer,layout:textcardLayout,center:textcardCenter,createGate:createTextcardGate,peak:textcardPeak}));
                    const textcardFonts=own(createStageTextcardFonts({document,...options.textcardFonts}));
                    const textcard=own(createStageTextcard({React:options.React,window,...options.textcard,players:textcardPlayers,fonts:textcardFonts,plan:planTextcard}));
                    const sceneMath=createStageSceneMath({colorMath:options.sceneColorMath,figureScale:options.figureScale,reading:options.entrance?.reading,motion:()=>figureMotion,idle:()=>figureIdle,document,getComputedStyle:window.getComputedStyle});
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
                    const danmakuDisplay=createStageDanmakuDisplay();
                    const danmakuScheduler=createStageDanmakuScheduler(danmakuDisplay);
                    const danmakuSession=own(createStageDanmakuSession(danmakuDisplay));
                    const liveroom=own(createStageLiveroom({spark:danmakuDisplay.danmakuSparkPaths,count:danmakuDisplay.danmakuCount,price:danmakuDisplay.danmakuPrice,...options.danmaku,renderers:modRenderers}));
                    const danmaku=own(createStageDanmaku({display:danmakuDisplay,scheduler:danmakuScheduler,session:danmakuSession,liveroom,createAvatar:createStageDanmakuAvatar,window,...options.danmaku,renderers:modRenderers}));
                    const danmakuSettings=own(createStageDanmakuSettings({window,CustomEvent:window.CustomEvent}));
                    const danmakuUi=own(createStageDanmakuUi({React:options.React,window,document,CustomEvent:window.CustomEvent,...options.danmakuUi,settings:danmakuSettings,fields:configFields}));
                    const entranceContract=options.entranceContract?.();
                    const video=own(createStageVideo(options.video));
                    const entranceMedia=own(createStageEntranceMedia({...options.entranceMedia,files:entranceContract?.stageEntranceFiles}));
                    const entranceRendererScope=own(createStageEntranceRenderer({window,contractFactory:options.entranceContract,renderer:entranceRenderer,frames:entrancePlateFrames,loop:entranceLoop}));
                    const entrance=own(createStageEntrancePresentation({React:options.React,window,renderer:entranceRendererScope,media:entranceMedia,video,contract:entranceContract,...options.entrance}));
                    const backgroundLayers=own(createStageBackgroundLayers({...visualMath,cover:sceneMath.galCover,transitionFrame:sceneMath.galTransitionFrame,wipeRect:sceneMath.galWipeRect,irisSize:sceneMath.galIrisSize}));
                    const backgrounds=own(createStageBackgrounds({...visualMath,...options.backgrounds,transition:sceneMath.galBackgroundTransition,layers:backgroundLayers}));
                    const runtimeKernel=createStageRuntimeKernel(options.runtimeProtocol || {});
                    const displays=own(createStageDisplays());
                    const sfx=own(createStageSfx(options.sfx || {}));
                    const ambience=own(createAmbience({...options.ambience, session:getSession,owner:getResourceOwner,player:() => createSoundscapePlayer(options.soundscape)}));
                    const speech=own(createStageSpeech({...options.speech,allowed:options.runtimeProtocol?.phoneBeatKernel?.phoneModAutoVoiceAllowed}));
                    const displayConsumers=own(createStageDisplayConsumers({React:options.React,displays,sfx,ambience,voice:speech}));
                    const views = {speech,sceneMath,runtimeKernel,displays,displayConsumers,sessionRuntime:own(createStageSessionRuntime({kernel:runtimeKernel,displays,createObservation:inputs=>createStageSessionObservation({...inputs,voice:speech,media:{...inputs.media,music:views.bgm,ambience}}),createModNotifications:createStageModNotifications,createResourceModule:createStageResourceRunnerModule,resourceDependencies:{...options.resourceDependencies,stageRuntimeErrorText:runtimeKernel.stageRuntimeErrorText},createDirectorModule:createStageDirectorModule,directorCommands:options.directorCommands,createStoreModule:createStageRuntimeStoreModule,createSessionModule:createStageSessionModule})),figurePose:own(createStageFigurePose({resolve:options.figureMetrics?.resolve,flatLayout:sceneMath.galFlatLayout,actionAt:sceneMath.galFlatActAt,ease:visualMath.ease})),castLayout:own(createStageCastLayout({calculate:sceneMath.galFigureLayout,mix:sceneMath.galFrameMix})),cast:own(createStageCast()),figureAppearance:own(createStageFigureAppearance({graphics:sceneGraphics,spring:sceneMath.galSpring,springValue:sceneMath.galSpringValue})),figureBlink:own(createStageFigureBlink({...options.figureBlink,clockwork:{blinkUrls,blinkPlacement,blinkTimingFor,createBlinkScheduler}})),callViews:own(createStageCallViews({...options.callViews,cover:sceneMath.galCover,canvasTexture:sceneGraphics.canvasTexture})),bust:own(createStageBust({...visualMath,framedHead:sceneMath.galFramedHead})),monologue:own(createStageMonologue({canvasTexture:sceneGraphics.canvasTexture})),backgrounds,sceneCamera:createStageSceneCamera(visualMath),sceneTextures:own(createStageSceneTextures({Image:window.Image,now:()=>window.performance.now()})),spineFigures,figureAssets,sceneGraphics,entrance,skinPresentation:own(createStageSkinPresentation({React:options.React,Event:window.Event,...options.skinPresentation,skin})),skinResources,skin,effects,lookUi:own(createStageLookUi({React:options.React})),looks,effectColors,weather,emotes,figureMotion,figureGeometry,figureIdle,figureWarp,figureTap,danmaku,liveroom,danmakuUi,danmakuSettings,textcard,textcardPlayers,textcardCenter,textcardLayout,choices,choiceLayout,regenerate:own(createStageRegenerate({React:options.React,window,document,...options.regenerate})),backlogView,backlogPaging,backlogHistory,backlogVoice, skinFrame, skinCursor:own(createStageSkinCursor({React:options.React, ...options.skinCursor})), backlogRows, configAppearance, configText, configScreen:own(createStageConfigScreen({React:options.React, window, document, Sound:mixer.Sound, Text:configText.Text, Appearance:configAppearance.Appearance, ...options.configScreen})), configFields, phoneLayout, phoneAdjust, widgets:own(createStageWidgets({React:options.React, window, document, adjust:phoneAdjust.useAdjust, ...options.widgets})), cg:own(createStageCg({React:options.React, window, ...options.cg})), gallery:own(createStageGallery({React:options.React, window, document, ...options.gallery,owner:getResourceOwner})), device:own(createStageDevice({React:options.React, ...options.device})), mixer, sfx, transitions:own(createStageTransitions({React:options.React, window, ...options.transitions,ease:skin.stageSkinTxEase})), speaker:createStageSpeaker(options.speaker || {}), chatEntry:own(createStageChatEntry({React:options.React, ...options.chatEntry})), menu:own(createStageMenu({React:options.React, window, document, ...options.menu,getSession})), position:own(createStagePosition({React:options.React, window, ...options.position,navigate:(...args)=>sessions?.owner?.navigate(...args)})), subtitles:createStageSubtitles({React:options.React, document, window, ...options.subtitles}), controls, loader, admission, progress, notices:own(createStageNotices({React:options.React, document, ...options.notices, shortcuts:controls.shortcuts})), hints:own(createStageHints({React:options.React, window, document, music, ...options.hints})), music, bgm:own(createBgmPlayer({...options.bgm, music,session:getSession,owner:getResourceOwner})), ambience, video,
                        ...createStageSkinButtons({React:options.React, ...options.presentation}),
                        ...createStagePresentation({React:options.React, document, ...options.presentation}),
                        ...createStagePortraits({React:options.React, document, window, ...options.portraits,emoteDataUrl:emotes.dataUrl,cssColor:effectColors.css}),
                        ...createStageLabels({React:options.React, Icon:options.Icon, document, ...options.labels}),
                        ...textViews};
                    views.performanceSurface=own(createStagePerformanceSurface({React:options.React,window,document,clock:options.sceneServices?.foreground,...options.performanceSurface,sessions:()=>views.sessions,runtime:views.sessionRuntime}));
                    views.timer=own(createStageTimer({React:options.React,window,...options.timer,getResourceOwner,createRects:views.performanceSurface.createRects,createKeyframeLayer:views.performanceSurface.createKeyframeLayer,performanceSafety:views.performanceSurface.safety}));
                    views.input=own(createStageInput({React:options.React,window,document,clock:options.sceneServices?.foreground,controls,navigation:options.navigation}));
                    views.playback=own(createStagePlayback({React:options.React,clock:options.sceneServices?.foreground,player:options.speech?.player,subtitles:views.subtitles,timing:options.playbackTiming,handoffDelay:views.handoffAutoDelay}));
                    views.runtimeUi=own(createStageRuntimeUi({React:options.React,sessions:views.sessionRuntime,kernel:runtimeKernel,performances:options.performances}));
                    views.scene=own(createStageScene({React:options.React,window,document,math:sceneMath,modules:views,services:options.sceneServices,figureScale:options.sceneFigureProtocol,lighting:options.sceneLighting,lookMath:options.looks?.math,reading:options.entrance?.reading,quality:options.configAppearance?.quality}));
                    views.sourceWidgets=own(createStageSourceWidgets({React:options.React,window,document,...options.sourceWidgets,views,sessions:()=>sessions}));
                    views.modSurface=own(createStageModSurface({React:options.React,window,document,...options.modSurface,sessions:()=>sessions,scene:()=>views.scene,runtime:views.sessionRuntime,renderers:modRenderers,core:options.performances?.core,useFaces:views.sourceWidgets.useFaces}));
                    views.sessions=sessions=own(createStageSessions({views,navigation:options.navigation,clock:options.sceneServices?.foreground,window,document,startLifetime:startStageClientLifetime,textIndex}));
                    views.controller=own(createStageController({React:options.React,window,document,views,navigation:options.navigation,services:options.controller || {dialogue:{},figures:{}},legacy:options.controllerLegacy || {},options}));
                    Object.assign(views,own(createStageViews({...options,GalStage:views.controller.Stage,useGalEntryLoader:admission.useLoader})));
                    activeViews=views;
                    return views;
                })});
                    cleanups.push(stop);
                    if(activeViews){
                        if(typeof host.sessionInputs!=='function')throw new Error('Stage session host is unavailable');
                        activeViews.sessions.start(host.sessionInputs());
                    }
                    return dispose;
                }catch(error){
                    try{dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Stage activation failed');}
                    throw error;
                }
            }, 'dsh-tavern-stage: client lifetime');
        }
    });}
});
