// 「以后不再显示」 on a confirmation hides that one kind (`hide`, e.g. 'chat'): ticking it on 删除素材 never skips 删除对话.
// One machine-wide UI preference (localStorage); 设置 › 显示与交互 「恢复所有已隐藏的确认」 brings them all back, nothing else does.
// Read by the host's askTavernConfirm (modules/confirm-dialog.js) and the asset dialogs' askDelete / ConfirmDialog (asset-pack-widgets.js).
const HIDDEN_CONFIRMS_KEY = 'dsh-tavern:hidden-confirms';
const hiddenConfirms = (() => {
    const listeners = new Set();
    // the two single switches this list replaced carry over once: 素材删除 (entries and figures) and 付费试听.
    const legacy = { 'dsh-tavern:asset-delete-ask': ['asset-entry', 'asset-figure'], 'dsh-tavern:voice-paid-preview-ask': ['voice-paid-preview'] };
    const raw = () => { try { return localStorage.getItem(HIDDEN_CONFIRMS_KEY) || '[]'; } catch (_) { return '[]'; } };
    const list = () => { try { const value = JSON.parse(raw()); return Array.isArray(value) ? value : []; } catch (_) { return []; } };
    const write = kinds => { try { if (kinds.length) localStorage.setItem(HIDDEN_CONFIRMS_KEY, JSON.stringify(kinds)); else localStorage.removeItem(HIDDEN_CONFIRMS_KEY); } catch (_) {} for (const fn of [...listeners]) fn(); };
    try {
        const carried = Object.keys(legacy).filter(key => localStorage.getItem(key) === 'off');
        if (carried.length) { write([...new Set([...list(), ...carried.flatMap(key => legacy[key])])]); carried.forEach(key => localStorage.removeItem(key)); }
    } catch (_) {}
    return {
        has: kind => list().includes(kind),
        hide: kind => { if (!list().includes(kind)) write([...list(), kind]); },
        restoreAll: () => write([]),
        snapshot: raw,
        subscribe(fn) {
            const onStorage = event => { if (event.key === HIDDEN_CONFIRMS_KEY) fn(); };
            listeners.add(fn); window.addEventListener('storage', onStorage);
            return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
        }
    };
})();
