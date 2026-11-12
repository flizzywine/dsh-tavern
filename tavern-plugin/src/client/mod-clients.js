// Mods' parts in the core client (docs/mod-authoring.md): each mod's client/core.js is built in by `// @include-mods`
// and registers its parts here under its mod id, with a label for error reports. Core and stage render the parts by slot and never name a mod:
//   floor:   component({useChat, nativeTurn, nodeKey, input}) before a round's story text on its chat floor
//   page:    component({useChat, nativeTurn, pageKey, input}) on the stage text box's top edge
//            input = modClients.input(executeSlash, sessionId): {submit(text)} sends text as the player's next message,
//            the way the stage's own choices do; floor and page parts get it, so a record can hand over an answer by a click
//   overlay: component({sessionId, useChat, nativeTurn, running, following, device, rootRef, calm, safety, veiled,
//            replay, live}) over the stage, after the text box
//   backlog: {kind, use(useChat), entries(rows, value, nativeTurnOf, rowOf), line(h, record)}: 履历 rows of the
//            performance kind `kind`, merged into the rows by entries(); line() writes one row's words
//   source:  {beat(direction, para), protocol}: a mod whose director mark shows a page on its own surface (source-beat.cjs; the
//            stage's source widgets get protocol: {phoneModDirect, phoneModOwnership, run})
// How the panel (舞台设置 › 模组, the mod's page) shows a mod, read by mod id from slot(name):
//   description: one sentence a player understands, the (?) of the mod's page head
//   glyph:       the icon name (the panel's Glyph) of the mod's row
//   fieldHelp:   {settingKey: text}, a setting's (?) where the config schema carries none
//   assetKind:   [kind, label], the asset kind the mod brings (kind lists order it after the built-in kinds)
//   settings:    component({rpc, cardId, cardName, sessionId, faceOf, manifest, data, entries}), the mod's settings page; it uses the
//                settings factory's helpers, so it is registered from mods/<name>/client/settings.js (`// @include-mods client/settings.js`,
//                built into mod-config-pages.js) and not core.js
// createAssetPackUI reads them through its `modClients` option (default: tavernModClients when the bundle has it, else no parts).
// A mod may register more than once (core.js, settings.js): the parts of one mod id merge into one.
const tavernModClients = (function () {
    const parts = [];
    return {
        register(modId, part) {
            const at = parts.findIndex(row => row.modId === modId);
            const merged = Object.freeze(Object.assign({}, parts[at], part, { modId }));
            if (at < 0) parts.push(merged); else parts[at] = merged;
        },
        input(executeSlash, sessionId) {
            return typeof executeSlash === "function" ? { submit(text) { return executeSlash("/send " + String(text).replace(/\|/g, "｜") + "|/trigger", sessionId); } } : undefined;
        },
        slot(name) { return parts.filter(part => part[name]).map(part => ({ modId: part.modId, label: part.label, value: part[name] })); }
    };
})();
// A value kept from the player (数据删除's second kind: a resource only the model reads, such as a card's 混沌): a black
// bar in its place that cannot be opened, the shared look of every mod's floor, HUD and record card (mod-config.css
// `.dsh-redact`). glyphs: how wide it is, in glyphs (default 3); label: what is hidden, for screen readers.
function TavernRedacted(props) {
    const glyphs = Math.max(1, Math.min(16, Math.round(props.glyphs || 3)));
    return React.createElement("span", { className: "dsh-redact", "data-redact": "hidden", role: "img", "aria-label": (props.label ? props.label + "：" : "") + "已隐藏", title: "已隐藏" }, "\u2588".repeat(glyphs));
}