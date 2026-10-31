window.__ModuleLoader__.load({
    id: 'dsh-tavern-stage',
    factory: () => ({
        name: 'dsh-tavern-stage',
        inject: ['tavernStageFrontend'],
        apply(ctx) {
            // Private migration bridge: the stage package owns mounting/unmounting.
            // UI implementation is being extracted from the core client closure.
            const host = ctx.get('tavernStageFrontend');
            ctx.effect(() => host.mount(), 'dsh-tavern-stage: client lifetime');
        }
    })
});
