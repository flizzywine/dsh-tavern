// Shared by the host director and the bundled client; no platform dependencies.
function stageOffstage(config) {
    const offstage = new Set((config && config.characters || []).filter(character => character.offstage).map(character => character.alias));
    const legacy = config && config.stage && config.stage.protagonist;
    if (!offstage.size && legacy) offstage.add(legacy);
    return offstage;
}
// The client includes this source inside its module factory, without exporting it.
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { stageOffstage };
