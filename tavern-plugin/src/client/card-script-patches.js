// In-memory patches for known card scripts, applied while a Helper module is assembled: the card's own file, saves and
// preferences are never changed. Each patch is data ({markers, replace: [[from, to], ...]}) registered in
// `cardScriptPatches`; it applies only when every marker is present and each `from` occurs exactly once, otherwise the
// script loads as shipped (an updated card needs its patch rechecked). A patched script no longer contains `from`, so
// patching is idempotent.
const cardScriptPatches = [{
    markers: ["// CJ_SHENGHAO_STABLE_LOADER", 'projectId:"cj-shenghao-terminal-v2"', 'mark:"CJ_SHENGHAO_TERMINAL_CORE"'],
    // The detached loader registers the card's MVU validation hooks after its
    // download. Include that promise in module readiness.
    requiredForMvu: true,
    replace: [
        [";(async()=>{", ";await (async()=>{"],
        ['!loaded&&!k&&F("error",', "if(!loaded&&!k)throw Error("],
        ['})().catch(e=>{console.log("[神豪终端 加载器] "+e.message);try{toastr.error("终端加载器未能启动，请检查配置与网络。","神豪终端");}catch{}});', "})();"]
    ]
}];
function findCardScriptPatch(source) {
    return cardScriptPatches.find(patch => patch.markers.every(marker => source.includes(marker))
        && patch.replace.every(([from]) => source.split(from).length === 2));
}
function patchCardScript(script) {
    let source = String(script && script.content || "");
    const patch = findCardScriptPatch(source);
    if (patch) for (const [from, to] of patch.replace) source = source.replace(from, () => to);
    return source;
}
