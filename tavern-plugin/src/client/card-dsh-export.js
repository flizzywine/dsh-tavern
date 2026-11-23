// 人物卡库 「导出」 and 「加密导出」 open the one DSH card export sheet (DshCardExportSheet, asset-pack-card-ui.js; 舞台设置 › 素材包
// 「导出」 opens the same sheet); without the pack service the card library saves the plain .dshcard itself. useDshCardExport owns the sheet and its pack binding, like
// useCardZipImport (card-zip-entry.js); `open` is null while the pack service is not there.
// open(card, {encrypt}) opens it for 加密导出: `encrypt` is the sheet's password and host step (see DshCardExportSheet).
function useDshCardExport(options) {
    const opts = options || {};
    const [sheet, setSheet] = React.useState(null);
    if (!opts.binding && typeof usePackRevision === "function") usePackRevision(cardZipServiceReady);
    const service = opts.binding ? opts.binding.service : typeof packClient === "function" ? packClient() : undefined;
    const binding = useCardPackBinding(opts.binding, service, opts.sessionId || "", !!sheet);
    const ui = typeof packUi === "object" && packUi ? packUi : opts.views;
    const h = React.createElement;
    const props = sheet && { key: sheet.path + (sheet.encrypt ? ":encrypt" : ""), binding, path: sheet.path, cardName: sheet.name, encrypt: sheet.encrypt, onClose: function () { setSheet(null); } };
    return {
        open: service && ui ? function (card, how) { setSheet({ path: card.path, name: card.name, encrypt: how && how.encrypt || null }); } : null,
        // the sheet is a stage package page (asset-pack-card-ui.js): StagePackView holds the stage client while the sheet is open.
        element: sheet && binding && ui ? (!opts.views && typeof StagePackView === "function" ? h(StagePackView, Object.assign({ view: function (api) { return api.DshCardExportSheet; } }, props))
            : h(ui.DshCardExportSheet, props)) : null
    };
}
