// Temporary callers delegate to the optional stage-owned sound player.
const stageSfx = {
    play:(...args) => stageViews?.sfx.play(...args) || Promise.resolve(),
    stop:(...args) => stageViews?.sfx.stop(...args),
    stopToken:(...args) => stageViews?.sfx.stopToken(...args),
    thunder:(...args) => stageViews?.sfx.thunder(...args),
    setThunder:(...args) => stageViews?.sfx.setThunder(...args),
};
