// 人物卡库 「导出」 opens the one DSH card export sheet (DshCardExportSheet, asset-pack-card-ui.js; 舞台设置 › 素材包
// 「导出」 opens the same sheet); without the pack service the card library saves the plain .dshcard itself. useDshCardExport owns the sheet and its pack binding, like
// useCardZipImport (card-zip-entry.js); `open` is null while the pack service is not there.
// open(card, {hasImage}): `hasImage` false (no cover) leaves PNG out of the sheet's formats.
function useDshCardExport(options) {
    const opts = options || {};
    const [sheet, setSheet] = React.useState(null);
    if (!opts.binding && typeof usePackRevision === "function") usePackRevision(cardZipServiceReady);
    const service = opts.binding ? opts.binding.service : typeof packClient === "function" ? packClient() : undefined;
    const binding = useCardPackBinding(opts.binding, service, opts.sessionId || "", !!sheet);
    const ui = typeof packUi === "object" && packUi ? packUi : opts.views;
    const h = React.createElement;
    const props = sheet && { key: sheet.path, binding, path: sheet.path, cardName: sheet.name, hasImage: sheet.hasImage, onClose: function () { setSheet(null); } };
    return {
        open: service && ui ? function (card, how) { setSheet({ path: card.path, name: card.name, hasImage: how && how.hasImage }); } : null,
        // the sheet is a stage package page (asset-pack-card-ui.js): StagePackView holds the stage client while the sheet is open.
        element: sheet && binding && ui ? (!opts.views && typeof StagePackView === "function" ? h(StagePackView, Object.assign({ view: function (api) { return api.DshCardExportSheet; } }, props))
            : h(ui.DshCardExportSheet, props)) : null
    };
}
