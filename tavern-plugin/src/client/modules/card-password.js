let activeTavernCardPassword = null;
function askTavernCardPassword(options = {}) {
    if (activeTavernCardPassword || typeof document === 'undefined') return Promise.resolve(null);
    return new Promise(resolve => {
        const opener = document.activeElement;
        const dialog = document.createElement('dialog'); dialog.className = 'dsh-tavern-prompt';
        const panel = document.createElement('form'); panel.className = 'dsh-tavern-prompt-panel';
        const title = document.createElement('div'); title.className = 'dsh-tavern-prompt-title';
        title.textContent = options.confirm ? '设置人物卡密码' : '输入人物卡密码';
        dialog.setAttribute('aria-label', title.textContent);
        const description = document.createElement('div'); description.textContent = options.name || '加密人物卡';
        const message = document.createElement('div'); message.setAttribute('role', 'alert'); message.textContent = options.error || '';
        const field = document.createElement('input'); field.type = 'password'; field.required = true;
        field.autocomplete = options.confirm ? 'new-password' : 'current-password'; field.setAttribute('aria-label', '密码');
        field.placeholder = '密码'; field.style.width = '100%'; field.style.boxSizing = 'border-box';
        panel.append(title, description, field);
        let second;
        if (options.confirm) {
            second = document.createElement('input'); second.type = 'password'; second.required = true;
            second.autocomplete = 'new-password'; second.setAttribute('aria-label', '确认密码'); second.placeholder = '再次输入密码';
            second.style.width = '100%'; second.style.boxSizing = 'border-box'; panel.append(second);
        }
        const actions = document.createElement('div'); actions.className = 'dsh-tavern-prompt-actions';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'dsh-tavern-btn'; cancel.textContent = '取消';
        const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'dsh-tavern-btn primary'; submit.textContent = options.action || (options.confirm ? '加密并下载' : '解锁并导入');
        actions.append(cancel, submit); panel.append(message, actions); dialog.append(panel);
        let finished = false;
        function finish(value) {
            if (finished) return; finished = true;
            field.value = ''; if (second) second.value = '';
            window.removeEventListener('pagehide', abort);
            window.removeEventListener('popstate', abort);
            if (dialog.open) dialog.close(); dialog.remove(); activeTavernCardPassword = null;
            if (opener?.isConnected) opener.focus({ preventScroll: true });
            resolve(value);
        }
        function abort() { finish(null); }
        cancel.addEventListener('click', abort);
        dialog.addEventListener('cancel', event => { event.preventDefault(); abort(); });
        dialog.addEventListener('close', abort);
        panel.addEventListener('submit', event => {
            event.preventDefault();
            if (!field.value) { message.textContent = '请输入密码'; field.focus(); return; }
            if (second && field.value !== second.value) { message.textContent = '两次密码不一致'; second.focus(); return; }
            finish(field.value);
        });
        dialog.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault(); });
        window.addEventListener('pagehide', abort); window.addEventListener('popstate', abort);
        activeTavernCardPassword = dialog;
        try { document.body.append(dialog); dialog.showModal(); field.focus(); } catch (_) { abort(); }
    });
}

async function importTavernPasswordCard(run, name, cleanup, askPassword = askTavernCardPassword) {
    let password;
    try {
        for (;;) {
            try { return await run(password); }
            catch (error) {
                if (!['TAVERN_CARD_PASSWORD_REQUIRED', 'TAVERN_CARD_PASSWORD_INVALID'].includes(error?.code)) throw error;
                password = await askPassword({ name, error: error.code === 'TAVERN_CARD_PASSWORD_INVALID' ? error.message : '' });
                if (password === null) {
                    if (cleanup) await cleanup();
                    throw Object.assign(new Error('已取消人物卡导入'), { code: 'TAVERN_CARD_IMPORT_CANCELLED' });
                }
            }
        }
    } finally { password = undefined; }
}

async function encryptTavernCardFile(file, call, decrypt = false) {
    const password = decrypt ? undefined : await askTavernCardPassword({ name: file.name, confirm: true });
    if (!decrypt && password === null) return null;
    const response = await fetch('/api/dsh-tavern/card-upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const reply = await response.json();
    if (!reply?.ok) throw new Error(reply?.error || '人物卡上传失败');
    try {
        if (decrypt) return await importTavernPasswordCard(value => call('decryptCardUpload', { uploadId: reply.uploadId, name: file.name, password: value }), file.name, () => call('discardCardUpload', { uploadId: reply.uploadId }), options => askTavernCardPassword({ ...options, action: '解密并下载' }));
        return await call('encryptCardUpload', { uploadId: reply.uploadId, name: file.name, password });
    }
    catch (error) { await call('discardCardUpload', { uploadId: reply.uploadId }).catch(() => {}); throw error; }
}
