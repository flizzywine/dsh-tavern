window.__ModuleLoader__.load({
    id: 'dsh-tavern-stage',
    factory: () => {
        __STAGE_NAVIGATION__
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
                try {stop = host.mount({createNavigation:createStageNavigation, createViews:createStageViews});}
                catch (error) {style.remove(); theme.remove(); throw error;}
                return () => {try {stop();} finally {style.remove(); theme.remove();}};
            }, 'dsh-tavern-stage: client lifetime');
        }
    });}
});
