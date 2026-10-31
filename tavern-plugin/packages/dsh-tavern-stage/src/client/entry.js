window.__ModuleLoader__.load({
    id: 'dsh-tavern-stage',
    factory: () => ({
        name: 'dsh-tavern-stage',
        inject: ['tavernStageFrontend'],
        apply(ctx) {
            // Private migration bridge: the stage package owns mounting/unmounting.
            // UI implementation is being extracted from the core client closure.
            const host = ctx.get('tavernStageFrontend');
            ctx.effect(() => {
                const style = document.createElement('style');
                style.dataset.pluginCss = 'dsh-tavern-stage/presentation.css';
                style.textContent = __STAGE_PRESENTATION_CSS__;
                document.head.appendChild(style);
                let stop;
                try {stop = host.mount();}
                catch (error) {style.remove(); throw error;}
                return () => {try {stop();} finally {style.remove();}};
            }, 'dsh-tavern-stage: client lifetime');
        }
    })
});
