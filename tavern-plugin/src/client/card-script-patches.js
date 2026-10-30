// In-memory patches for known card scripts, applied while a Helper module is assembled: the card's own file, saves and
// preferences are never changed. Each patch is data ({markers, replace: [[from, to], ...]}) registered in
// `cardScriptPatches`; it applies only when every marker is present and each `from` occurs exactly once, otherwise the
// script loads as shipped (an updated card needs its patch rechecked). A patched script no longer contains `from`, so
// patching is idempotent.
const cardScriptPatches = [];
function patchCardScript(script) {
    let source = String(script && script.content || "");
    for (const patch of cardScriptPatches) {
        if (!patch.markers.every(marker => source.includes(marker))) continue;
        if (!patch.replace.every(([from]) => source.split(from).length === 2)) continue;
        for (const [from, to] of patch.replace) source = source.replace(from, () => to);
    }
    return source;
}
