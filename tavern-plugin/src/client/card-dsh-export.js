// 人物卡库 「导出」 opens the one DSH card export sheet (DshCardExportSheet, asset-pack-card-ui.js; 舞台设置 › 素材包
// 「导出」 opens the same sheet); without the pack service it downloads the plain .dshcard. useDshCardExport owns the sheet and its pack binding, like
// useCardZipImport (card-zip-entry.js); `open` is null while the pack service is not there.
function useDshCardExport(options) {
    const opts = options || {};
    const [sheet, setSheet] = React.useState(null);
    if (!opts.binding && typeof usePackRevision === "function") usePackRevision(cardZipServiceReady);
    const service = opts.binding ? opts.binding.service : typeof packClient === "function" ? packClient() : undefined;
    const binding = useCardPackBinding(opts.binding, service, opts.sessionId || "", !!sheet);
    const ui = typeof packUi === "object" && packUi ? packUi : opts.views;
    const h = React.createElement;
    return {
        open: service && ui ? function (card) { setSheet({ path: card.path, name: card.name }); } : null,
        // the sheet is a stage package page (asset-pack-card-ui.js): StagePackView holds the stage client while the sheet is open.
        element: sheet && binding && ui ? (!opts.views && typeof StagePackView === "function" ? h(StagePackView, { key: sheet.path, view: function (api) { return api.DshCardExportSheet; }, binding, path: sheet.path, cardName: sheet.name, onClose: function () { setSheet(null); } })
            : h(ui.DshCardExportSheet, { key: sheet.path, binding, path: sheet.path, cardName: sheet.name, onClose: function () { setSheet(null); } })) : null
    };
}
