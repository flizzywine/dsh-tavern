// Stable readers keep core React subscribers alive while the optional provider comes and goes.
let stageNavigation = null;
const stageNavigationSignals = new Map();
function stageNavigationSignal(name, fallback) {
    const listeners = new Set();
    const signal = {get: () => stageNavigation?.[name].get() ?? fallback,
        subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
        emit() {for (const fn of listeners) fn();}};
    stageNavigationSignals.set(name,signal);
    return signal;
}
const galActive = stageNavigationSignal('galActive', '');
const galStageAvailable = stageNavigationSignal('galStageAvailable', false);
const galMenuSignal = stageNavigationSignal('galMenuRequest', 0);
const galMenuRequest = {...galMenuSignal, request: () => stageNavigation?.galMenuRequest.request()};
const galEntering = {get: () => stageNavigation?.galEntering.get() || ''};
const galEnter = (...args) => stageNavigation?.galEnter(...args);
const galLeave = () => stageNavigation?.galLeave();
const galEscapeLock = on => stageNavigation?.galEscapeLock(on);
const galStageShortcut = () => stageNavigation.galStageShortcut();
const galStageLifetime = () => stageNavigation.galStageLifetime();
const galCurrentEntry = () => stageNavigation?.getEntry() || null;
const galHoldLeave = hold => stageNavigation?.holdLeave(hold) || (() => {});
function bindStageNavigation(createNavigation, ctx) {
    if (stageNavigation) throw new Error('Stage navigation already mounted');
    const navigation = createNavigation({window, document, navigator:window.navigator,
        playCue:cue => forkUiSfx.play(cue), checkSetup:stageSetupGate,
        getSessionId:() => tavernMainSessionId(ctx.sessions), getSettings:id => bubbleStore.get(id),
        uncover:() => galUncover?.()});
    const stops = [];
    stageNavigation = navigation;
    for (const [name, signal] of stageNavigationSignals) stops.push(navigation[name].subscribe(signal.emit));
    return () => {
        for (const stop of stops) stop();
        if (stageNavigation !== navigation) return;
        stageNavigation = null;
        galActive.emit(); galStageAvailable.emit();
    };
}
