// Optional ambience follows the selected session in both stage and chat.
const ambience = {
    activate:id => stageViews?.ambience.activate(id),
    present:(...args) => stageViews?.ambience.present(...args) || Promise.resolve(),
    performance:(...args) => stageViews?.ambience.performance(...args),
    release:() => stageViews?.ambience.release(),
    resume:() => stageViews?.ambience.resume(),
    snapshot:() => stageViews?.ambience.snapshot() || {plan:null,performance:null,player:null}
};
window.forkSoundscapeDebug = {snapshot: () => ambience.snapshot()};
