// Built-in stage dialogue themes, shared by the plugin's appearance and text settings.
const STAGE_THEMES = Object.freeze([
    ["classic", "经典"], ["gothic", "哥特金边"], ["magical", "魔法少女"],
    ["crt", "显像管"], ["aero", "千禧晴空"]
].map(row => Object.freeze(row)));
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {STAGE_THEMES};
