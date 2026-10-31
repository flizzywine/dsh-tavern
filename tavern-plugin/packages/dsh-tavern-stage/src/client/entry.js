window.__ModuleLoader__.load({
    id: 'dsh-tavern-stage',
    factory: () => {
        __STAGE_NAVIGATION__
        __STAGE_TEXT__
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
        __STAGE_MUSIC__
        __STAGE_BGM__
        __STAGE_VIEWS__
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
                try {stop = host.mount({createNavigation:createStageNavigation, createViews:options => {
                    const loader = createStageLoader(options.loader);
                    const progress = createStageProgress({React:options.React, ...options.admission});
                    const admission = createStageAdmission({React:options.React, window, document, loader, StageLoadLine:progress.Line, ...options.admission});
                    const music = createStageMusic(options.music);
                    return {...createStageViews({...options, useGalEntryLoader:admission.useLoader}), loader, admission, progress, music, bgm:createBgmPlayer({...options.bgm, music}), ambience:createAmbience({...options.ambience, player:() => createSoundscapePlayer(options.soundscape)}), timer:createStageTimer({React:options.React, window, ...options.timer}), video:createStageVideo(options.video),
                        ...createStagePortraits({React:options.React, document, window, ...options.portraits}),
                        ...createStageLabels({React:options.React, Icon:options.Icon, document, ...options.labels}),
                        ...createStageText({React:options.React, document, ...options.text})};
                }});}
                catch (error) {style.remove(); theme.remove(); throw error;}
                return () => {try {stop();} finally {style.remove(); theme.remove();}};
            }, 'dsh-tavern-stage: client lifetime');
        }
    });}
});
