// Native alert/confirm can strand Electron's input focus; prompt is unsupported.
// Keep product dialogs in the DOM. Never replace window.confirm with a Promise:
// callers expecting a boolean would treat even a cancelled Promise as approval.
let activeTavernConfirmation = null;
function askTavernConfirm(message, options) {
    const opts = options || {};
    if (typeof document === 'undefined' || opts.signal?.aborted || activeTavernConfirmation) return Promise.resolve(false);
    return new Promise(resolve => {
        const opener = document.activeElement;
        const dialog = document.createElement('dialog');
        dialog.className = 'dsh-tavern-prompt';
        dialog.setAttribute('aria-label', '确认操作');
        const panel = document.createElement('div');
        panel.className = 'dsh-tavern-prompt-panel';
        const title = document.createElement('div');
        title.className = 'dsh-tavern-prompt-title';
        title.textContent = '确认操作';
        const description = document.createElement('div');
        description.textContent = String(message);
        description.style.whiteSpace = 'pre-wrap';
        const actions = document.createElement('div');
        actions.className = 'dsh-tavern-prompt-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.className = 'dsh-tavern-btn'; cancel.textContent = opts.cancelText || '取消';
        const confirm = document.createElement('button');
        confirm.type = 'button'; confirm.className = 'dsh-tavern-btn primary'; confirm.textContent = opts.confirmText || '确认';
        actions.append(cancel, confirm); panel.append(title, description, actions); dialog.append(panel);
        let settled = false;
        function finish(value, restoreFocus = true) {
            if (settled) return;
            settled = true;
            opts.signal?.removeEventListener('abort', abort);
            window.removeEventListener('pagehide', abort);
            window.removeEventListener('popstate', abort);
            window.removeEventListener('hashchange', abort);
            if (dialog.open) dialog.close();
            dialog.remove();
            if (activeTavernConfirmation === dialog) activeTavernConfirmation = null;
            if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
            resolve(value === true && !opts.signal?.aborted);
        }
        function abort() { finish(false, false); }
        cancel.addEventListener('click', () => finish(false));
        confirm.addEventListener('click', () => finish(true));
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
        dialog.addEventListener('close', () => finish(false));
        dialog.addEventListener('click', event => { if (event.target === dialog) finish(false); });
        dialog.addEventListener('keydown', event => {
            // WebKit 可能先发 compositionend；此时仍不能把选字确认当成操作确认。
            if ((event.isComposing || event.keyCode === 229) && event.key === 'Enter') event.preventDefault();
        });
        opts.signal?.addEventListener('abort', abort, { once: true });
        window.addEventListener('pagehide', abort);
        window.addEventListener('popstate', abort);
        window.addEventListener('hashchange', abort);
        activeTavernConfirmation = dialog;
        try { document.body.append(dialog); dialog.showModal(); cancel.focus(); }
        catch (_) { finish(false); }
    });
}

// Tie outstanding confirmations to the initiating component and session.
function useTavernConfirm(scope) {
    const state = React.useRef({ scope, mounted: true, pending: null });
    state.current.scope = scope;
    React.useLayoutEffect(() => {
        state.current.mounted = true;
        return () => {
            state.current.mounted = false;
            state.current.pending?.abort();
            state.current.pending = null;
        };
    }, [scope]);
    return async (message, options) => {
        const owner = state.current;
        if (!owner.mounted || owner.scope !== scope || owner.pending) return false;
        const controller = new AbortController();
        owner.pending = controller;
        try {
            const accepted = await askTavernConfirm(message, { ...options, signal: controller.signal });
            return accepted && owner.mounted && owner.scope === scope && !controller.signal.aborted;
        } finally {
            if (owner.pending === controller) owner.pending = null;
        }
    };
}
