// The phone mod's settings page (core's mod-config-pages.js lays the page out by the parts registered in mod-clients.js).
// Built into the settings factory scope (// @include-mods client/settings.js in mod-config-pages.js).
// the phone's look
// (壁纸, 主题色, 内容底色, 机身颜色, 机型, 状态栏 and its parts, 来信提示音) is edited only in the phone's own 设置 app on the stage
// (phone-settings.js), the same two layers; this page keeps what is not the phone's look:
// 状态来源, the date / weekday bindings and 联系人 (card content).
const PHONE_APP_SETTINGS = new Set(['photos', 'wallpaper', 'accentColor', 'surfaceColor', 'bodyColor', 'cutout', 'statusBar', 'clockText', 'carrier', 'signal', 'battery', 'sound']);
// 摘要中转（实验）: its own section; the switch is off by default and a card inherits the global layer until it sets its own.
const PHONE_RELAY_KEYS = ['summaryRelay'];
const PHONE_RELAY_HELP = {
    summaryRelay: '实验功能。开启后手机通话的上下文由摘要中转站整理；需要先开启手机。全局开启时，本卡可以单独关闭，本卡关闭优先。'
};
// The phone's contacts. exactly the stage's — the stage source's /contacts
// (mod-config-host.js: the enabled figures of the card's packs through the one figure catalogue, keyed by the actor
// key the stage uses), each with its figure ref for the face. Without them (no card): the stage's characters of an open
// chat, then the stage source's characters. Plus any alias the settings already name.
const cfgNodeValue = node => node.children ? Object.fromEntries(node.children.map(child => [child.name, cfgNodeValue(child)])) : node.value;
function phoneModContacts(config, characters) {
    const rows = [], seen = new Set(), add = row => { if (row && row.alias && !seen.has(row.alias)) { seen.add(row.alias); rows.push(row); } };
    const stage = (config.sources || []).find(s => s.id === 'stage'), node = path => stage && (stage.tree || []).find(n => n.path === path);
    const listed = node('/contacts');
    if (listed && listed.children && listed.children.length) for (const row of listed.children.map(cfgNodeValue)) add({ alias: row.id, name: row.name || row.id, color: row.color, figure: row.figure && row.figure.packId ? row.figure : null, face: null });
    else {
        for (const c of characters || []) add({ alias: c.alias, name: c.name || c.alias, color: c.color, face: typeof c.avatar === 'string' ? c.avatar : c.avatar && c.avatar.src || null });
        const list = node('/characters');
        for (const row of (list && list.children || []).map(cfgNodeValue)) add({ alias: row.id, name: row.name || row.id, color: row.color, figure: row.figure && row.figure.packId ? row.figure : null, face: null });
    }
    const set = cfgResolved(config, 'contacts'), value = set && set.value && typeof set.value === 'object' ? set.value : {};
    for (const alias of Object.keys(value)) add({ alias, name: alias, color: null, face: null });
    return rows;
}
function phoneModContactView(config, files, contact) {
    const r = cfgResolved(config, 'contacts'), own = r && r.value && r.value[contact.alias] || {};
    const avatar = own.avatar && own.avatar.file ? files({ layer: r.layer, path: own.avatar.file }) : null;
    return { name: own.name || contact.name, avatar: avatar || contact.face, overridden: !!(own.name || own.avatar) };
}
// One round face: the uploaded / given picture, else the figure's own avatar (faceOf), else the initial on its colour.
function PhoneFace({ shown, contact, faceOf, className }) {
    const h = React.createElement, art = !shown.avatar && contact && contact.figure && faceOf ? faceOf(contact.figure, shown.name) : null;
    return h('span', { className, 'data-art': art ? true : undefined, style: shown.avatar ? { backgroundImage: 'url("' + shown.avatar + '")' } : contact && contact.color ? { background: contact.color } : undefined },
        shown.avatar ? '' : art || Array.from(String(shown.name || '?'))[0]);
}
// 联系人: one row per character — 备注名 (empty = the card's name) and 头像 (upload; 恢复 = the card's face). The map is one
// setting, written whole at the layer being edited; removing the last override clears the key (恢复为全局 / 自动).
function PhoneContactsEditor({ config, files, contacts, faceOf, anchor, beside, placement, onClose }) {
    const h = React.createElement, pop = React.useRef(null), input = React.useRef(null), target = React.useRef(null), titleId = 'fork-phone-contacts-t';
    const [place, setPlace] = React.useState(null), [sheet, setSheet] = React.useState(false), [busy, setBusy] = React.useState('');
    const close = reason => { onClose && onClose(reason); if (reason === 'escape' && anchor && anchor.focus) anchor.focus(); };
    useOverlay(true, () => [pop.current, anchor, ...(typeof document !== 'undefined' ? document.querySelectorAll('[data-fork-cfg-keep]') : [])], close);
    useCfgPlacement(pop, { anchor, beside, placement }, setPlace, setSheet);
    React.useEffect(() => { config.needSources(); }, []);
    const focused = React.useRef(false);
    React.useEffect(() => { if (focused.current || !(place || sheet) || !pop.current) return; focused.current = true; const first = pop.current.querySelector('button'); if (first) first.focus({ preventScroll: true }); }, [place, sheet]);
    const data = config.data || {}, layer = config.layerFor('contacts'), own = cfgOwn(data[layer], 'contacts');
    // The map being edited: this layer's own value, else what this layer shows now (so a first edit keeps the others).
    const base = latest => { const d = latest || data, mine = d[layer] && d[layer].contacts; if (mine && mine.fixed) return mine.fixed; const r = d.resolved && d.resolved.contacts; return r && !r.error && r.value && typeof r.value === 'object' ? r.value : {}; };
    const write = next => Object.keys(next).length ? config.set('contacts', { fixed: next }) : config.clear('contacts');
    const change = (alias, patch) => {
        const all = { ...base() }, row = { ...(all[alias] || {}), ...patch };
        for (const k of Object.keys(row)) if (row[k] === undefined || row[k] === '') delete row[k];
        if (Object.keys(row).length) all[alias] = row; else delete all[alias];
        return write(all);
    };
    const upload = file => {
        const alias = target.current; if (!alias) return;
        setBusy(alias);
        Promise.resolve(config.upload('contacts', file, (path, latest) => { const all = { ...base(latest) }; all[alias] = { ...(all[alias] || {}), avatar: { file: path } }; return { fixed: all }; })).finally(() => setBusy(''));
    };
    const current = base(), rows = contacts.length ? contacts : [];
    const style = sheet || !place ? (sheet ? undefined : { visibility: 'hidden', left: -9999, top: 0 }) : { left: place.left, top: place.top };
    const node = h('section', { ref: pop, className: 'fork-cfg-pop fk-surface fork-phone-contacts', 'data-level': 'popover', 'data-sheet': sheet || undefined, role: 'dialog', 'aria-modal': false, 'aria-labelledby': titleId, style },
        h('header', { className: 'fork-cfg-pop-head' }, h('span', { className: 'fork-cfg-pop-title', id: titleId }, '联系人'),
            own ? h(OverrideDot, { layer }) : null,
            own ? h(ResetButton, { label: cfgResetLabel(layer), onClick: () => config.clear('contacts') }) : null,
            h('button', { type: 'button', className: 'fork-cfg-icon', 'aria-label': '关闭', title: '关闭', onClick: () => close('button') }, h(InlineGlyph, { name: 'close' }))),
        h('div', { className: 'fork-cfg-pop-body' },
            rows.length ? rows.map(contact => {
                const mine = current[contact.alias] || {}, shown = phoneModContactView(config, files, contact), face = mine.avatar && mine.avatar.file ? files({ layer: own ? layer : (cfgResolved(config, 'contacts') || {}).layer, path: mine.avatar.file }) : contact.face;
                return h('div', { key: contact.alias, className: 'fork-phone-contact' },
                    face ? h('span', { className: 'fork-cfg-thumb is-round' }, h('img', { src: face, alt: '' })) : h(PhoneFace, { shown: { name: shown.name, avatar: null }, contact, faceOf, className: 'fork-cfg-thumb is-round' }),
                    h(InlineField, { kind: 'text', label: contact.name + ' 备注名', hideLabel: true, value: mine.name || '', placeholder: contact.name, maxLength: 64, trim: true, onCommit: next => change(contact.alias, { name: next || undefined }) }),
                    config.fields.get('contacts')?.recordAssetMedia ? h(CfgAssetPicker, { config, fieldKey: 'contacts', label: contact.name + ' 头像', value: mine.avatarRef, onChange: ref => change(contact.alias, { avatarRef: ref.packId ? ref : undefined }) }) :
                        h('button', { type: 'button', className: 'fork-cfg-link', disabled: !!busy, 'aria-label': contact.name + ' 上传头像', onClick: () => { target.current = contact.alias; input.current && input.current.click(); } }, busy === contact.alias ? h(Spinner, null) : null, '头像'),
                    mine.name || mine.avatar || mine.avatarRef ? h('button', { type: 'button', className: 'fork-cfg-link', 'aria-label': contact.name + ' 恢复', onClick: () => change(contact.alias, { name: undefined, avatar: undefined, avatarRef: undefined }) }, '恢复') : null);
            }) : h('div', { className: 'fork-cfg-meta' }, '这张卡还没有人物')),
        config.error ? h('div', { className: 'fork-cfg-result is-warn', role: 'alert' }, '⚠ ', config.error) : null,
        h('input', { ref: input, type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onChange: event => { const file = event.target.files && event.target.files[0]; event.target.value = ''; if (file) upload(file); } }));
    return inlineCanPortal() ? ReactDOM.createPortal(h('div', { className: 'ap-ui ap-layer fork-cfg-layer' }, node), document.body) : node;
}
// a compact page like the other settings — 状态来源, the date /
// weekday bindings and 联系人 (备注名 / 头像, opened as a popover beside its row; a bottom sheet on a narrow window). The page's 设置
// section carries the 全局 / 本卡 switch in its head.
// faceOf(figureRef, name): the panel's face of a figure (the stage settings pass it; without it the initial shows).
function PhoneConfigPage({ rpc, cardId, cardName, sessionId, faceOf, manifest, entries }) {
    const h = React.createElement, files = useCfgFiles(rpc, 'dsh.phone', cardId);
    const config = useModConfig({ call: rpc, modId: 'dsh.phone', cardId, sessionId, cardName, fileUrl: files });
    const bubbles = useBubbles(sessionId || '', !!sessionId), characters = bubbles && bubbles.config && bubbles.config.characters || [];
    const [editing, setEditing] = React.useState(false), opener = React.useRef(null);
    React.useEffect(() => { config.needSources(); }, []);
    const contacts = phoneModContacts(config, characters);
    const listed = config.data ? Array.from(config.fields.keys()).filter(key => key !== 'contacts' && !PHONE_APP_SETTINGS.has(key) && !PHONE_RELAY_KEYS.includes(key)) : [];
    const own = config.data && cfgOwn(config.data[config.layerFor('contacts')], 'contacts');
    const renamed = contacts.filter(contact => phoneModContactView(config, files, contact).overridden).length;
    return h('div', { className: 'fork-cfg-page fork-phone-page', 'data-compact': true },
        h(ModSettings, { modId: 'dsh.phone', config, help: '壁纸、提示音素材和联系人头像从素材库选择；主题色、机身和状态栏也能在手机自己的「设置」里改。' },
            h(CfgList, { rpc, config, keys: listed, state: true, help: modFieldHelp('dsh.phone', manifest) }),
            config.data ? h(InlineRow, { label: '联系人', help: h(Help, { text: '手机里显示的备注名和头像；空着就用卡里的名字和头像。', label: '联系人 说明' }) },
                h('button', { ref: opener, type: 'button', className: 'fork-inline-trigger fork-phone-contacts-open', 'aria-haspopup': 'dialog', 'aria-expanded': editing, 'data-fork-cfg-keep': true,
                    onClick: () => setEditing(open => !open) }, contacts.length ? contacts.length + ' 人' + (renamed ? ' · 改了 ' + renamed + ' 人' : '') : '还没有人物'),
                own ? h(OverrideDot, { layer: config.layerFor('contacts') }) : null) : null,
            editing ? h(PhoneContactsEditor, { config, files, contacts, faceOf, anchor: opener.current, placement: 'below', onClose: () => setEditing(false) }) : null),
        config.data ? h(StageSection, { title: '摘要中转（实验）', help: '手机通话的上下文改由摘要中转站整理；需要先开启手机。全局与本卡各有一层，本卡关闭优先。', foldKey: 'mod:dsh.phone/relay', className: 'fork-mod-settings' },
            h(CfgList, { rpc, config, keys: PHONE_RELAY_KEYS, help: PHONE_RELAY_HELP })) : null,
        entries || null);
}
modClients.register('dsh.phone', { settings: PhoneConfigPage });
