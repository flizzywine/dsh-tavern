// Mods' parts in the core client (docs/mod-authoring.md): each mod's client/core.js is built in by `// @include-mods`
// and registers its parts here under its mod id, with a label for error reports. Core and stage render the parts by slot and never name a mod:
//   floor:   component({useChat, nativeTurn, nodeKey}) before a round's story text on its chat floor
//   page:    component({useChat, nativeTurn, pageKey}) on the stage text box's top edge
//   overlay: component({sessionId, useChat, nativeTurn, running, following, device, rootRef, calm, safety, veiled,
//            replay, live}) over the stage, after the text box
//   backlog: {kind, use(useChat), entries(rows, value, nativeTurnOf, rowOf), line(h, record)}: 履历 rows of the
//            performance kind `kind`, merged into the rows by entries(); line() writes one row's words
const tavernModClients = (function () {
    const parts = [];
    return {
        register(modId, part) { parts.push(Object.freeze(Object.assign({ modId }, part))); },
        slot(name) { return parts.filter(part => part[name]).map(part => ({ modId: part.modId, label: part.label, value: part[name] })); }
    };
})();
