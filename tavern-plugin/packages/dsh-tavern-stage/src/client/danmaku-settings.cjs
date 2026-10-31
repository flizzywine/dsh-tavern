function createStageDanmakuSettings({window,CustomEvent}) {
let disposed=false;const DANMAKU_MOD='dsh.danmaku';
const DANMAKU_VIEW_NAMES = Object.freeze({ overlay: '飘屏', sidebar: '直播风格', off: '关闭' });
// The stage CONFIG rows, in order; a row shows only when the manifest declares its field (P6-REQUESTS.md F9).
const DANMAKU_AREA_NAMES = Object.freeze({ quarter: '1/4', half: '半屏', 'three-quarter': '3/4', full: '不限' });
const DANMAKU_STAGE_FIELDS = Object.freeze(['area', 'opacity', 'fontScale']);
// The menu rows: the manifest's view choices in order, plus 关闭 when the setting accepts it. Pure; tests.
function danmakuViewOptions(manifest) {
    const field = manifest?.settingsSchema?.fields?.find(f => f.key === 'view');
    const values = (field?.choices || []).map(c => c.value).filter(v => Object.hasOwn(DANMAKU_VIEW_NAMES, v));
    return values.map(value => ({ value, label: DANMAKU_VIEW_NAMES[value] }));
}
// D on the stage: 关闭 ⇄ the last shown view (飘屏 when there is none). Only when 关闭 is a real choice; never while typing
// or with modifiers.
function danmakuShortcut(event, { current, last, options }) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
    if (event.key !== 'd' && event.key !== 'D') return null;
    const t = event.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="menu"], [role="dialog"]')) return null;
    if (!options.some(o => o.value === 'off')) return null;
    const on = options.find(o => o.value === last && last !== 'off') || options.find(o => o.value === 'overlay') || options.find(o => o.value !== 'off');
    return current === 'off' ? on?.value || null : 'off';
}
// The stage CONFIG rows the manifest really declares: [{key, field}] in DANMAKU_STAGE_FIELDS order. Pure; tests.
function danmakuStageFields(manifest) {
    const fields = manifest?.settingsSchema?.fields || [];
    return DANMAKU_STAGE_FIELDS.map(key => ({ key, field: fields.find(f => f.key === key) })).filter(row => row.field);
}
// One CAS write of a settings patch over the stored values; a revision conflict is retried once with fresh values.
async function danmakuSave(rpc, patch, presentationOnly = false, confirm) {
    if(disposed)return false;
    for (let attempt = 0; attempt < 2; attempt++) {
        const current = await rpc('getMod', { modId: DANMAKU_MOD });
        if(disposed)return false;
        let revision = current.revision;
        try {
            // A release can revoke its grant while retaining global scope and the chosen view.
            if (patch.view && patch.view !== 'off' && !current.authorized) {
                if (!await confirm?.('允许弹幕读取已显示的剧情并调用所选模型？模型调用可能计费。', { confirmText: '允许并开启弹幕' })) return false;
                if(disposed)return false;
                revision = (await rpc('authorizeMod', { modId: DANMAKU_MOD, allowed: true, expectedRevision: revision })).revision;
                presentationOnly = false;
            }
            if(disposed)return false;
            await rpc('saveModSettings', { modId: DANMAKU_MOD, values: { ...current.settings.storedValues, ...patch }, expectedRevision: revision });
            break;
        } catch (error) { if (error?.code !== 'MOD_REVISION_CONFLICT' || attempt) throw error; }
    }
    if(disposed)return false;
    window.dispatchEvent(new CustomEvent('dsh-tavern-mods-changed', { detail: { modId: DANMAKU_MOD, presentationOnly } }));
    return true;
}

return {options:danmakuViewOptions,shortcut:danmakuShortcut,fields:danmakuStageFields,save:danmakuSave,areaNames:DANMAKU_AREA_NAMES,viewNames:DANMAKU_VIEW_NAMES,dispose(){disposed=true;}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageDanmakuSettings};
