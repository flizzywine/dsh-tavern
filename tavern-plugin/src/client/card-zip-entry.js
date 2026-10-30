// one 「导入人物卡」 for every card a new user may hold — PNG / JSON
// card files go through the host importer as before, a card ZIP (by name, or a renamed file with a ZIP header) opens the
// 导入卡片 sheet (CardImportSheet, asset-pack-ui.js) for a new card. 「从网址导入卡」 sits beside it and opens the
// small 从网址导入卡 sheet (CardUrlSheet); reading the address happens in the same 导入卡片 sheet, so a download failure
// (404, no network, not a card, too large) is one plain line there with 「换一个网址」 / 「重试」.
//
// useCardZipImport(options) owns the reservation, the pack binding and both sheets; the 人物卡库 tab (through the
// registerTab wrapper below, tab-icons.js) and the 游玩 card picker (sidebar.js) each use it. The host components
// get `forkCardZip` = {openFile(file), openUrl(), busy, available}; `openFile` rejects with a plain sentence.
// `openExample` is 「导入示例卡：大肥鱼」: the 从网址导入卡 sheet with the example's address, read at once (as if pasted and
// 读取 pressed), so progress, failures and 「换一个网址」/「重试」 are the pasted-address ones.
//
// Reservations allocate an identity, not a placeholder; ZIP validation stays in the import sheet.
const cardZipTarget = {
    async reserve() {
        const reserved = await rpc('reserveCardZipTarget', {});
        return { path: reserved.path, release: () => rpc('releaseCardZipTarget', { path: reserved.path }) };
    }
};
// A card ZIP by its name; a file named neither .png nor .json is sniffed for the ZIP header (4 bytes, never the whole file).
async function isCardZip(file) {
    const name = String(file && file.name || "");
    if (!file) return false;
    if (/\.zip$/i.test(name)) return true;
    // Native archive formats belong to the upstream importer, not the fork bundle sheet.
    if (/\.(png|json|charx|dshcard)$/i.test(name) || typeof file.slice !== "function") return false;
    try { const head = new Uint8Array(await file.slice(0, 4).arrayBuffer()); return head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4; }
    catch (_) { return false; }
}
// Picked files split by kind: card files for the host importer, card ZIPs for the import sheet (one at a time).
async function splitCardFiles(files) {
    const cards = [], zips = [];
    for (const file of files || []) (await isCardZip(file) ? zips : cards).push(file);
    return { cards, zips };
}
function cardZipServiceReady() { return typeof packClient === "function" && !!packClient(); }
function cardZipErrorText(error) {
    const code = error && error.code || "";
    if (code === "DUPLICATE_ID") return "没能开始导入，请重试。";
    return playerErrorText(error, { fallback: "没能开始导入，请重试。" });
}
function useCardZipImport(options) {
    const opts = options || {};
    const serial = React.useRef(0), lastUrl = React.useRef("");
    const [sheet, setSheet] = React.useState(null), [asking, setAsking] = React.useState(false), [busy, setBusy] = React.useState(false);
    const target = opts.target === undefined ? cardZipTarget : opts.target;
    // The pack service (same transport as 素材库 / 舞台设置); a binding exists only while a sheet is open. Only its
    // availability re-renders the caller (the sidebar and the card library are large), not every pack change.
    if (!opts.binding && typeof usePackRevision === "function") usePackRevision(cardZipServiceReady);
    const service = opts.binding ? opts.binding.service : typeof packClient === "function" ? packClient() : undefined;
    const open_ = !!sheet, sessionId = opts.sessionId || "";
    const binding = React.useMemo(function () {
        if (opts.binding) return opts.binding;
        if (!open_ || !service || typeof packTransport === "undefined" || !packTransport) return null;
        return createAssetPackBinding({ service, tts: typeof forkTtsScope !== "undefined" && forkTtsScope && forkTtsScope.get("ttsClient"), rpc: workbenchRpc(sessionId), settings: packTransport.settings,
            download: function (result) { return packTransport.download(result); }, readExport: function (result) { return packTransport.bytes(result); },
            onUnavailable: function (fn) { return packTransport.onUnavailable(fn); } });
    }, [opts.binding, service, sessionId, open_]);
    React.useEffect(function () { return function () { if (binding && binding !== opts.binding && binding.dispose) binding.dispose(); }; }, [binding]);
    const available = !!target && !!service;
    async function begin(file, url) {
        if (!target) throw new Error("现在不能导入卡片 ZIP。");
        if (!service) throw new Error("舞台素材还没准备好，请稍后再试。");
        if (busy) return;
        setBusy(true);
        try { const reserved = await target.reserve(file); setSheet({ key: "card-zip-" + (++serial.current), file, url, path: reserved.path, release: reserved.release }); }
        catch (err) { throw new Error(cardZipErrorText(err)); }
        finally { setBusy(false); }
    }
    function release(current) { if (current) Promise.resolve().then(function () { return current.release && current.release(); }).catch(function () {}); }
    function cancel(current) { setSheet(null); release(current); }
    function finish(current) {
        setSheet(null);
        if (typeof notifyTavernDataChanged === "function") notifyTavernDataChanged(["cards"], "cards");
        if (opts.onDone) opts.onDone(current.path);
    }
    const api = {
        available, busy,
        openFile: function (file) { return begin(file, null); },
        openUrl: function () { if (!busy) setAsking(true); },
    };
    const ui = typeof packUi === "object" && packUi ? packUi : opts.views;
    const h = React.createElement;
    // Both sheets portal themselves into the top layer (Modal → TopLayer, .ap-ui tokens).
    const element = h(React.Fragment, null,
        asking && ui && ui.CardUrlSheet ? h(ui.CardUrlSheet, { initial: lastUrl.current, busy, autoRead: asking === "read",
            onClose: function () { setAsking(false); },
            onRead: async function (url) { lastUrl.current = url; await begin(null, url); setAsking(false); } }) : null,
        sheet && binding && ui ? h(ui.CardImportSheet, { key: sheet.key, binding, path: sheet.path, file: sheet.file, url: sheet.url,
            // 「换一个文件」 picks again; for an address it reopens the address sheet with the address to correct.
            onPick: sheet.url ? function () { cancel(sheet); setAsking(true); } : opts.pickFile ? function () { cancel(sheet); opts.pickFile(); } : null,
            onClose: function () { cancel(sheet); },
            onDone: function () { finish(sheet); } }) : null);
    return { api, element };
}
// The 人物卡库 tab (registerTab wraps the host component): the host renders with `forkCardZip`, the sheets beside it.
function CardLibraryWithZip(props) {
    const hostProps = props.hostProps || {}, picker = React.useRef(null);
    const zip = useCardZipImport({ target: props.target, binding: props.binding, views: props.views, sessionId: hostProps.scope && hostProps.scope.sessionId || "",
        pickFile: function () { if (picker.current) picker.current(); },
        // The host tab opens a card named in its tab meta (card-library.js requestedPath).
        onDone: function (path) { const sidebar = hostProps.ctx && hostProps.ctx.betterSidebar; if (path && sidebar && hostProps.tab) sidebar.updateTab(hostProps.tab.id, { meta: { cardPath: path } }); } });
    const h = React.createElement, forkCardZip = props.target === null ? null : Object.assign({}, zip.api, { pickerRef: picker });
    return h(React.Fragment, null, h(props.host, Object.assign({}, hostProps, { forkCardZip })), zip.element);
}
