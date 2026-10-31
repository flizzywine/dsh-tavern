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
        __STAGE_BACKLOG_PAGING__
        __STAGE_BACKLOG_HISTORY__
        __STAGE_BACKLOG_VOICE__
        __STAGE_BACKLOG_ROWS__
        __STAGE_SKIN_SHAPE__
        __STAGE_SKIN_FRAME__
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
                const theme = document.createElement('style');
                theme.dataset.pluginCss = 'dsh-tavern-stage/themes.css';
                theme.textContent = __STAGE_THEME_CSS__;
                const anchor = document.querySelector('[data-plugin-css="dsh-tavern-plugin/features-after-stage.css"]');
                document.head.insertBefore(theme, anchor);
                const style = document.createElement('style');
                style.dataset.pluginCss = 'dsh-tavern-stage/presentation.css';
                style.textContent = __STAGE_PRESENTATION_CSS__;
                document.head.appendChild(style);
                let stop;
                try {stop = host.mount({createNavigation:createStageNavigation, createViews:options => createStageViewScope(own => {
                    const controls = createStageControls();
                    const loader = own(createStageLoader(options.loader));
                    const progress = createStageProgress({React:options.React, ...options.admission});
                    own(progress.store);
                    const admission = own(createStageAdmission({React:options.React, window, document, loader, StageLoadLine:progress.Line, ...options.admission}));
                    const configFields = own(createStageConfigFields({React:options.React, ...options.configFields}));
                    const textViews = createStageText({React:options.React, document, ...options.text});
                    const configText = own(createStageConfigText({React:options.React, fields:configFields, Typewriter:textViews.Typewriter, ...options.configText, themes:STAGE_THEMES}));
                    const configAppearance = own(createStageConfigAppearance({React:options.React, window, document, fields:configFields, ...options.configAppearance, themes:STAGE_THEMES}));
                    const mixer = own(createStageMixer({React:options.React, fields:configFields, ...options.mixer}));
                    const phoneLayout = own(createStagePhoneLayout({React:options.React, group:configFields.group, row:configFields.row, slider:configFields.slider, Switch:configFields.Switch, ...options.phoneLayout}));
                    const phoneAdjust = own(createStagePhoneAdjust({React:options.React, window, document, sizes:phoneLayout.sizes, ...options.phoneAdjust}));
                    const music = own(createStageMusic(options.music));
                    const skinShape=own(createStageSkinShape({React:options.React,window,document,...options.skinDecoration}));
                    const skinFrame=own(createStageSkinFrame({React:options.React,...options.skinDecoration,Shape:skinShape.Shape}));
                    return {backlogPaging:own(createStageBacklogPaging({React:options.React,...options.backlogPaging})), backlogHistory:own(createStageBacklogHistory({React:options.React,...options.backlogHistory})), backlogVoice:own(createStageBacklogVoice(options.backlogVoice || {})), skinFrame, skinCursor:own(createStageSkinCursor({React:options.React, ...options.skinCursor})), backlogRows:createStageBacklogRows(options.backlogRows || {}), configAppearance, configText, configScreen:own(createStageConfigScreen({React:options.React, window, document, Sound:mixer.Sound, Text:configText.Text, Appearance:configAppearance.Appearance, ...options.configScreen})), configFields, ...own(createStageViews({...options, useGalEntryLoader:admission.useLoader})), phoneLayout, phoneAdjust, widgets:own(createStageWidgets({React:options.React, window, document, adjust:phoneAdjust.useAdjust, ...options.widgets})), cg:own(createStageCg({React:options.React, window, ...options.cg})), gallery:own(createStageGallery({React:options.React, window, document, ...options.gallery})), device:own(createStageDevice({React:options.React, ...options.device})), mixer, sfx:own(createStageSfx(options.sfx || {})), transitions:own(createStageTransitions({React:options.React, window, ...options.transitions})), speaker:createStageSpeaker(options.speaker || {}), chatEntry:own(createStageChatEntry({React:options.React, ...options.chatEntry})), menu:own(createStageMenu({React:options.React, window, document, ...options.menu})), position:own(createStagePosition({React:options.React, window, ...options.position})), subtitles:createStageSubtitles({React:options.React, document, window, ...options.subtitles}), controls, loader, admission, progress, notices:own(createStageNotices({React:options.React, document, ...options.notices, shortcuts:controls.shortcuts})), hints:own(createStageHints({React:options.React, window, document, music, ...options.hints})), music, bgm:own(createBgmPlayer({...options.bgm, music})), ambience:own(createAmbience({...options.ambience, player:() => createSoundscapePlayer(options.soundscape)})), timer:own(createStageTimer({React:options.React, window, ...options.timer})), video:own(createStageVideo(options.video)),
                        ...createStageSkinButtons({React:options.React, ...options.presentation}),
                        ...createStagePresentation({React:options.React, document, ...options.presentation}),
                        ...createStagePortraits({React:options.React, document, window, ...options.portraits}),
                        ...createStageLabels({React:options.React, Icon:options.Icon, document, ...options.labels}),
                        ...textViews};
                })});}
                catch (error) {style.remove(); theme.remove(); throw error;}
                return () => {try {stop();} finally {style.remove(); theme.remove();}};
            }, 'dsh-tavern-stage: client lifetime');
        }
    });}
});
