// 「以后不再显示」 on a confirmation hides that one kind (`hide`, e.g. 'chat'): ticking it on 删除素材 never skips 删除对话.
// The browser stores these preferences in localStorage.
// Read by the host's askTavernConfirm (modules/confirm-dialog.js) and the asset dialogs' askDelete / ConfirmDialog (asset-pack-widgets.js).
const HIDDEN_CONFIRMS_KEY = 'dsh-tavern:hidden-confirms';
const hiddenConfirms = (() => {
    // the two single switches this list replaced carry over once: 素材删除 (entries and figures) and 付费试听.
    const legacy = { 'dsh-tavern:asset-delete-ask': ['asset-entry', 'asset-figure'], 'dsh-tavern:voice-paid-preview-ask': ['voice-paid-preview'] };
    const list = () => { try { const value = JSON.parse(localStorage.getItem(HIDDEN_CONFIRMS_KEY)); return Array.isArray(value) ? value : []; } catch (_) { return []; } };
    const write = kinds => { try { localStorage.setItem(HIDDEN_CONFIRMS_KEY, JSON.stringify(kinds)); } catch (_) {} };
    try {
        const carried = Object.keys(legacy).filter(key => localStorage.getItem(key) === 'off');
        if (carried.length) { write([...new Set([...list(), ...carried.flatMap(key => legacy[key])])]); carried.forEach(key => localStorage.removeItem(key)); }
    } catch (_) {}
    return {
        has: kind => list().includes(kind),
        hide(kind) {
            const kinds = list();
            if (!kinds.includes(kind)) write([...kinds, kind]);
        },
    };
})();
