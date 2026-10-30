// 设置 › 高级 › 模组管理
// and the managed mods' text switches. Host RPCs: managedModsList / managedModDetail /
// managedModPlan / managedModSwitchPlan / managedModApply.
// Included in the asset-pack UI factory (mod-library.js): it uses the panel's one Modal / SubpageHead / StageSection /
// Popover / HintLine / ConfirmDialog.
//
// Switches are words, not lamps (blue / green / grey stay for entries). On a card the switch is one single-choice list of
// four: 全局开启 / 全局关闭 (global on/off, this card unset), 本卡开启 / 本卡关闭 (card on / off). A card
// key, when set, is the choice shown; picking a 全局 option clears it.
// The host still resolves 本卡关闭 > 全局开启 > 本卡开启 > 全局关闭 (switches.effective). Every change is a host plan; its
// confirmations (code consent, a 本卡关闭 dependency, a version conflict) are asked with the host's own options, then
// managedModApply commits. The client never resolves dependencies itself.

// The one checked choice of a switch (and the words on the tag): the card key when set, else the global switch.
function modSwitchWord(global, card) { return card === 'off' ? '本卡关闭' : card === 'on' ? '本卡开启' : global === true ? '全局开启' : '全局关闭'; }
const modSwitchOn = (global, card) => card !== 'off' && (global === true || card === 'on');
// The host's dependency reasons in player words.
const MOD_DEP_REASONS = { missing: '未安装', version: '版本不符', operation: '版本过旧', disabled: '未开启', unauthorized: '未获允许' };
const MOD_STATUS_WORDS = { unauthorized: '未获允许', incompatible: '版本不符', blocked: '无法运行' };
const modQuote = name => '「' + name + '」';
// A failed host call in player words (never a code); `nameOf(id)` names the mods a message mentions.
function modManagerError(error, nameOf) {
  const name = id => nameOf?.(id) || id, ids = error?.details?.ids || error?.details?.mods || [];
  if (error?.code === 'MOD_DEPENDENCY_CYCLE') {
    const ring = [...new Set(ids)].map(id => modQuote(name(id)));
    return '不能安装：' + (ring.length > 2 ? ring.join('') + '循环' : ring.join('和')) + '互相必需';
  }
  if (error?.code === 'MOD_CODE_CONFLICT') return [...new Set(ids)].map(id => modQuote(name(id))).join('和') + '不能同时开启';
  if (error?.code === 'MOD_REVISION_CONFLICT') return '内容已变化，请重试';
  if (error?.code === 'MOD_SESSION_REQUIRED') return '新会话才能使用这项改动';
  if (error?.code === 'MOD_PERMISSION_DENIED') return '没有权限进行这项操作';
  return '操作失败，请重试';
}

// The managed mods of the profile (and of a card, with `cardId`). Every surface re-reads after any applied change
// (dsh-tavern-mods-changed), so 高级设置 and 舞台设置 never disagree.
function useManagedMods(rpc, cardId) {
  const [data, setData] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false), life = React.useRef(0), latest = React.useRef(null);
  latest.current = data;
  const nameOf = id => latest.current?.mods.find(row => row.id === id)?.name;
  const reload = async () => {
    const own = life.current;
    try { const next = await rpc('managedModsList', cardId ? { cardId } : {}); if (own === life.current) { setData(next); setError(''); } return next; }
    catch (e) { if (own === life.current) setError(modManagerError(e, nameOf)); }
  };
  React.useEffect(() => {
    life.current++; setData(null); setError(''); reload();
    const changed = () => reload(), events = typeof window === 'undefined' ? null : window;
    events?.addEventListener('dsh-tavern-mods-changed', changed);
    return () => { life.current++; events?.removeEventListener('dsh-tavern-mods-changed', changed); };
  }, [rpc, cardId]);
  // One host call at a time; a failure shows here in words and is rethrown to stop the caller.
  async function task(run) {
    const own = life.current;
    setBusy(true); setError('');
    try { return await run(latest.current); }
    catch (e) { if (own === life.current) setError(modManagerError(e, nameOf)); throw e; }
    finally { if (own === life.current) setBusy(false); }
  }
  const changed = () => window.dispatchEvent(new CustomEvent('dsh-tavern-mods-changed'));
  return { data, error, busy, reload, task, changed, nameOf, setError };
}

// Plan → ask each confirmation → apply. `askAll` dialogs show the host's message and options (取消 never writes);
// the result notice names what the plan also switched on for the card, and 新会话生效 when the host says so.
function useModPlans(rpc, mods) {
  const [ask, setAsk] = React.useState(null), [notice, setNotice] = React.useState('');
  const answer = confirmation => new Promise(resolve => setAsk({ confirmation, resolve }));
  async function execute(makePlan) {
    setNotice('');
    let plan;
    try { plan = await mods.task(data => makePlan(data)); } catch (_) { return null; }
    const answers = {};
    for (const confirmation of plan.confirmations || []) {
      const choice = await answer({ ...confirmation, planModId: plan.modId });
      setAsk(null);
      if (!choice || choice === 'cancel') return null;
      answers[confirmation.id] = choice;
    }
    try {
      const result = await mods.task(() => rpc('managedModApply', { token: plan.token, revision: plan.revision, answers }));
      mods.changed();
      const declined = new Set((plan.confirmations || []).filter(row => row.kind === 'card-off' && answers[row.id] !== 'enable').map(row => row.modId));
      const also = (plan.changes || []).filter(change => change.scope === 'card' && change.id !== plan.modId && change.after === 'on' && !declined.has(change.id)).map(change => modQuote(mods.nameOf(change.id) || change.id));
      const enabled = (plan.confirmations || []).filter(row => row.kind === 'card-off' && answers[row.id] === 'enable').map(row => modQuote(mods.nameOf(row.modId) || row.modId));
      const both = [...new Set([...also, ...enabled])];
      setNotice([both.length ? '已同时开启' + both.join('、') : '', result?.requiresNewSession || plan.requiresNewSession ? '新会话生效' : ''].filter(Boolean).join('；'));
      return { plan, result };
    } catch (_) { return null; }
  }
  const dialog = ask && h(ModConfirmation, { confirmation: ask.confirmation, nameOf: mods.nameOf, onAnswer: ask.resolve });
  return { execute, dialog, notice, setNotice };
}
// One plan confirmation: the title says what is being decided; the body is the host's message; the buttons are the host's
// options (the safe 取消 first and always there). The option that goes ahead is the one solid button.
const MOD_GO_OPTIONS = new Set(['enable', 'upgrade', 'approve']);
function ModConfirmation({ confirmation: c, nameOf, onAnswer }) {
  const name = id => modQuote(nameOf(id) || id);
  const title = c.kind === 'card-off' ? '开启' + name(c.planModId) : c.kind === 'version-conflict' ? name(c.modId) + '版本不符' : '允许' + name(c.modId) + '运行';
  const options = (c.options || []).filter(option => option.id !== 'cancel');
  return h(Modal, { title, onClose: () => onAnswer('cancel'), closable: false, className: 'ap-confirm fork-mod-prompt' },
    h('p', null, c.message),
    h(Actions, null, h(Button, { onClick: () => onAnswer('cancel') }, '取消'),
      options.map(option => h(Button, { key: option.id, primary: MOD_GO_OPTIONS.has(option.id), 'data-autofocus': MOD_GO_OPTIONS.has(option.id) || undefined, onClick: () => onAnswer(option.id) }, option.label))));
}

// The switch tag: the checked choice + ⌄; the menu is one selection list with one ✓ — 全局开启 / 全局关闭, and on a card also
// 本卡开启 / 本卡关闭. No segmented control (owner: the scope is rarely changed).
const MOD_SWITCH_CHOICES = [['全局开启', 'global', true], ['全局关闭', 'global', false], ['本卡开启', 'card', 'on'], ['本卡关闭', 'card', 'off']];
function ModSwitchTag({ name, switches, cardScoped, busy, onChange }) {
  const { global, card } = switches || {}, word = modSwitchWord(global, cardScoped ? card : undefined);
  const item = ([label, scope, value]) => { const checked = label === word; return h('button', { key: label, type: 'button', role: 'menuitemradio', 'aria-checked': checked, className: 'ap-state-opt fork-mod-switch-opt', onClick: () => { closeMenu.current?.(); if (!checked) onChange(scope, value); } },
    h('span', { className: 'ap-state-label' }, label), checked && h('span', { className: 'ap-state-check' }, h(Glyph, { name: 'check' }))); };
  const closeMenu = React.useRef(null);
  return h(Popover, { label: name + ' 开关', className: 'fork-mod-switch-anchor', stopClicks: true,
    trigger: ({ toggle, open }) => h('button', { type: 'button', className: 'fork-mod-switch', 'data-on': switches?.effective || undefined, 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-busy': busy || undefined,
        'aria-label': name + '：' + word + '，更改', disabled: busy || undefined, onClick: toggle },
      busy ? h(Spinner, { key: 'busy' }) : null, h('span', null, word), h(Glyph, { name: 'chevDown' })),
    content: close => { closeMenu.current = close; return h('div', { role: 'group', 'aria-label': name + ' 开关', className: 'fork-mod-switch-group' }, (cardScoped ? MOD_SWITCH_CHOICES : MOD_SWITCH_CHOICES.slice(0, 2)).map(item)); } });
}
// A switch change as host plans (managedModSwitchPlan). On a card a 全局 choice is two stored writes: clear this card's key
// (when set), then the global switch (when it differs) — each its own plan, the second on the revision after the first.
// The stage drops a mod switched off at once (dsh-tavern-mod-scope) and gets it back if
// the change is cancelled or fails with the mod still on.
function useModSwitchChange(rpc, mods, plans, cardId) {
  // The revision belongs to the displayed card context, even when writing the global scope.
  const plan = (row, scope, value, revision) => plans.execute(data => rpc('managedModSwitchPlan', { scope, kind: 'mod', id: row.id, value, ...(cardId ? { cardId } : {}), revision: revision ?? data.revision }));
  return async (row, scope, value) => {
    const before = row.switches, card = cardId ? before.card ?? null : null;
    const steps = scope === 'card' ? [['card', value]] : [...(card != null ? [['card', null]] : []), ...(before.global !== value ? [['global', value]] : [])];
    const after = scope === 'card' ? { global: before.global, card: value } : { global: value, card: null };
    const off = before.effective && !modSwitchOn(after.global, after.card);
    const scoped = enabled => window.dispatchEvent(new CustomEvent('dsh-tavern-mod-scope', { detail: { modId: row.id, enabled } }));
    if (off) scoped(false);
    let state = { global: before.global, card }, done = null, revision;
    for (const [stepScope, stepValue] of steps) {
      done = await plan(row, stepScope, stepValue, revision);
      if (!done) break;
      state = { ...state, [stepScope]: stepValue };
      revision = done.result.revision;
    }
    if (off && !done && modSwitchOn(state.global, state.card)) scoped(true);
    return done;
  };
}
// One dependency notice (the consumer runs without it) in words; `dep` is the dependency's row when it is listed.
function modNoticeText(notice, dep, cardId) {
  const reason = notice.reason === 'disabled' && cardId && dep?.switches?.card === 'off' ? '本卡已关闭' : MOD_DEP_REASONS[notice.reason] || notice.message;
  return '需要' + modQuote(dep?.name || notice.dependencyId) + '：' + reason;
}
const modShownNotices = row => (row?.notices || []).filter(notice => notice.policy !== 'silent' && notice.reason);

// The 舞台设置 › 模组 rows: icon · name · › · ⚠ (a dependency notice or a version conflict) · the switch tag. The whole row
// but the tag opens the mod's page.
function ManagedModRow({ row, cardId, busy, byId, change, onOpen, onVersion, takeFocus }) {
  const open = () => onOpen(row.id), jump = React.useRef(null), notice = modShownNotices(row)[0];
  React.useEffect(() => { if (takeFocus?.(row.id)) jump.current?.focus?.(); }, []);
  const warn = row.status === 'incompatible' && cardId ? h(HintLine, { compact: true, text: modQuote(row.name) + '版本不符', action: '处理', onAction: () => onVersion(row) })
    : notice ? h(HintLine, { compact: true, text: modNoticeText(notice, byId(notice.dependencyId), cardId) })
    : MOD_STATUS_WORDS[row.status] && row.switches.effective === false && row.switches.global ? h(HintLine, { compact: true, text: MOD_STATUS_WORDS[row.status] }) : null;
  return h('div', { className: 'ap-switch-row is-openable fork-mod-row', onClick: switchRowClick(open) },
    h('div', { className: 'ap-switch-main' },
      h('span', { className: 'ap-switch-name' }, h(Glyph, { name: MOD_GLYPHS[row.id] || 'widgets' }), h('span', null, row.name)), warn,
      h(ModSwitchTag, { name: row.name, switches: row.switches, cardScoped: !!cardId, busy, onChange: (scope, value) => change(row, scope, value) }),
      h('button', { type: 'button', ref: jump, className: 'ap-kind-jump', 'aria-label': row.name + ' 设置', title: row.name, onClick: open }, h(Glyph, { name: 'chevRight' }))));
}
// 舞台设置 › 模组: every installed mod with this card's switches. A version conflict of this card's lock is asked by planning
// the card's current choice again (the host answers with upgrade / keep-missing).
function ManagedModSection({ rpc, cardId, onOpen, takeFocus }) {
  const mods = useManagedMods(rpc, cardId), plans = useModPlans(rpc, mods), change = useModSwitchChange(rpc, mods, plans, cardId);
  const rows = mods.data?.mods.filter(row => row.installed && !row.internal) || [], byId = id => mods.data?.mods.find(row => row.id === id);
  return h(StageSection, { title: '模组', meta: mods.data ? rows.length : undefined, className: 'ap-widget-section fork-mod-section',
      help: '全局开启 / 关闭对所有卡生效，并清除这张卡的设置；本卡开启 / 关闭只在这张卡生效。安装与卸载在 设置 › 高级 › 模组管理。' },
    h(ErrorBox, { error: mods.error, reload: mods.data ? null : mods.reload }),
    plans.notice ? h('p', { className: 'ap-notice', role: 'status' }, h(Glyph, { name: 'check' }), h('span', null, plans.notice)) : null,
    !mods.data ? !mods.error && h(Loading) : rows.length ? rows.map(row => h(ManagedModRow, { key: row.id, row, cardId, busy: mods.busy, byId, change, onOpen, takeFocus,
      onVersion: item => change(item, 'card', 'on') })) : h(EmptyState, { text: '没有安装模组' }),
    plans.dialog);
}
// A mod page's head switch and its dependency notices (舞台设置 › 模组 › <mod>): the notices name what this mod runs without
// on this card; one the card disables offers 开启 (planned like any card 开启).
function useManagedModControls({ rpc, cardId, modId, name }) {
  const mods = useManagedMods(rpc, cardId), plans = useModPlans(rpc, mods), change = useModSwitchChange(rpc, mods, plans, cardId);
  const row = mods.data?.mods.find(item => item.id === modId), byId = id => mods.data?.mods.find(item => item.id === id);
  const toggle = row ? h(ModSwitchTag, { name, switches: row.switches, cardScoped: !!cardId, busy: mods.busy, onChange: (scope, value) => change(row, scope, value) }) : null;
  const shown = modShownNotices(row);
  const notices = shown.length || mods.error || plans.notice ? h('div', { className: 'fork-mod-notices' },
    h(ErrorBox, { error: mods.error }),
    shown.map(notice => {
      const dep = byId(notice.dependencyId), enable = notice.reason === 'disabled' && dep?.installed && cardId;
      return h(HintLine, { key: notice.dependencyId, text: modNoticeText(notice, dep, cardId), action: enable ? '开启' : undefined, onAction: enable ? () => change(dep, 'card', 'on') : undefined });
    }),
    plans.notice ? h('p', { className: 'ap-notice', role: 'status' }, h(Glyph, { name: 'check' }), h('span', null, plans.notice)) : null) : null;
  return { toggle, notices, dialog: plans.dialog };
}

// 设置 › 高级 › 模组管理: a row with the installed count and ›; it opens the manager.
function ModManagerEntry({ rpc, Row }) {
  const [open, setOpen] = React.useState(false), mods = useManagedMods(rpc), count = mods.data?.mods.filter(row => row.installed && !row.internal).length;
  return h(React.Fragment, null,
    h(Row, { title: '模组管理', help: '安装、卸载模组，选择运行的版本，查看依赖。', className: 'fork-mod-manager-entry' },
      h('button', { type: 'button', className: 'fork-mod-manager-open', 'aria-label': '打开模组管理', onClick: () => setOpen(true) },
        count === undefined ? null : h('span', null, count + ' 个'), h(Glyph, { name: 'chevRight' }))),
    open && h(ModManager, { rpc, onClose: () => setOpen(false) }));
}

// The manager: 已安装 and 可安装 (the library's local first-party distributions), and a mod's page.
function ModManager({ rpc, onClose }) {
  const mods = useManagedMods(rpc), plans = useModPlans(rpc, mods), change = useModSwitchChange(rpc, mods, plans);
  const [openId, setOpenId] = React.useState(null), back = React.useRef(null), importInput = React.useRef(null);
  const importFile = file => plans.execute(async () => {
    if (file.size > 48 * 1024 ** 2) throw Object.assign(new Error('模组文件不能超过 48 MiB'), { code: 'MOD_INVALID' });
    const bytesBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const plan = await rpc('managedModInspect', { bytesBase64 });
    await mods.reload();
    return plan;
  });
  const all = mods.data?.mods.filter(row => !row.internal) || [], installed = all.filter(row => row.installed), available = all.filter(row => !row.installed);
  const detail = openId && all.find(row => row.id === openId);
  const goBack = () => { back.current = openId; setOpenId(null); };
  const notice = plans.notice ? h('p', { className: 'ap-notice', role: 'status' }, h(Glyph, { name: 'check' }), h('span', null, plans.notice)) : null;
  const list = (rows, label) => h('ul', { className: 'fork-mod-list', 'aria-label': label },
    rows.map(row => h(ModManagerRow, { key: row.id, row, busy: mods.busy, change, onOpen: () => setOpenId(row.id), focus: back.current === row.id })));
  return h(Modal, { title: '模组管理', onClose, headless: true, className: 'fork-mod-manager', initialFocus: 'dialog' },
    detail ? h(ModManagerDetail, { key: detail.id, rpc, mods, plans, change, row: detail, notice, onBack: goBack })
      : h(React.Fragment, null,
        h('header', { className: 'ap-subhead fork-mod-manager-head' },
          h('h2', { className: 'ap-subhead-title' }, h('span', { className: 'ap-subhead-text' }, '模组管理'),
            h(Help, { label: '模组管理 说明', text: '模组是引擎的能力，安装后默认全局关闭。每个模组只运行一个版本；本卡开启与关闭在 舞台设置 › 模组。' })),
          h('span', { className: 'ap-subhead-tools' },
            h(Button, { disabled: mods.busy, onClick: () => importInput.current?.click() }, '导入模组…'),
            h('input', { ref: importInput, type: 'file', hidden: true, tabIndex: -1, accept: '.dshmod', onChange: event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) importFile(file); } }),
            h(IconButton, { icon: 'close', label: '关闭', onClick: onClose }))),
        h(ErrorBox, { error: mods.error, reload: mods.data ? null : mods.reload }), notice,
        !mods.data ? !mods.error && h(Loading) : h(React.Fragment, null,
          h(StageSection, { title: '已安装', meta: installed.length, foldKey: 'mod-manager/installed' },
            installed.length ? list(installed, '已安装的模组') : h(EmptyState, { compact: true, text: '没有安装模组' })),
          available.length ? h(StageSection, { title: '可安装', meta: available.length, foldKey: 'mod-manager/available', help: '本机已有、尚未安装的模组。' }, list(available, '可安装的模组')) : null)),
    plans.dialog);
}
function ModManagerRow({ row, busy, change, onOpen, focus }) {
  const name = React.useRef(null), notice = modShownNotices(row).find(item => !item.optional), problem = row.installed && MOD_STATUS_WORDS[row.status];
  React.useEffect(() => { if (focus) name.current?.focus?.(); }, []);
  return h('li', { className: 'fork-mod-list-row', onClick: packRowClick(onOpen) },
    h('span', { className: 'fork-mod-list-icon', 'aria-hidden': true }, h(Glyph, { name: MOD_GLYPHS[row.id] || 'widgets' })),
    h('span', { className: 'fork-mod-list-title' },
      h('button', { type: 'button', ref: name, className: 'fork-mod-list-name', title: row.name, onClick: e => { e.stopPropagation(); onOpen(); } }, row.name),
      h('span', { className: 'fork-mod-list-version' }, row.version || row.versions?.[0]?.version || ''),
      row.experimental ? h('span', { className: 'fork-mod-list-version' }, '实验性') : null),
    problem || notice ? h(HintLine, { compact: true, text: problem || MOD_DEP_REASONS[notice.reason] || notice.message }) : null,
    row.installed ? h(ModSwitchTag, { name: row.name, switches: row.switches, busy, onChange: (scope, value) => change(row, scope, value) }) : h('span', { className: 'fork-mod-list-value' }, '未安装'),
    h('span', { className: 'fork-mod-list-chevron', 'aria-hidden': true }, h(Glyph, { name: 'chevRight' })));
}
// A labelled row of the mod page: name (+ meta, 「?」) left, the value right (iOS: grouped rows with values).
function ModInfoRow({ label, help, meta, children }) {
  return h('div', { className: 'fork-mod-info-row' },
    h('span', { className: 'fork-mod-info-label' }, h('span', null, label), meta ? h('span', { className: 'fork-mod-info-meta' }, meta) : null, help ? h(Help, { label: label + ' 说明', text: help }) : null),
    h('span', { className: 'fork-mod-info-value' }, children));
}
const MOD_DATA_HELP = {
  config: '模组参数：有全局默认值，卡里可以写本卡值，本卡值随卡带走。在 舞台设置 › 模组 修改。',
  preferences: '玩家偏好：只存在全局，不随卡带走。',
  assets: '素材条目：蓝灯常驻、绿灯按关键词、关闭，跟着卡走。在 舞台素材 管理。'
};
// A mod's page: 版本 (the one running version; 安装 for a mod not installed yet) · 依赖 (id + range, the host's state) · 冲突 ·
// 数据 (设置 / 玩家偏好 / 素材) · the red 卸载模组… behind a confirmation.
function ModManagerDetail({ rpc, mods, plans, change, row, notice, onBack }) {
  const [detail, setDetail] = React.useState(null), [confirm, setConfirm] = React.useState(null), [pick, setPick] = React.useState(null);
  React.useEffect(() => { let alive = true; rpc('managedModDetail', { modId: row.id }).then(next => { if (alive) setDetail(next); }, e => { if (alive) mods.setError(modManagerError(e, mods.nameOf)); }); return () => { alive = false; }; }, [row.id, mods.data?.revision]);
  const versions = row.versions || [], chosen = pick || row.version || versions[0]?.version, digest = version => versions.find(item => item.version === version)?.digest;
  const plan = (action, version) => plans.execute(data => rpc('managedModPlan', { action, modId: row.id, ...(version ? { version, digest: digest(version) } : {}) }));
  async function uninstall() {
    let ready;
    try { ready = await mods.task(() => rpc('managedModPlan', { action: 'uninstall', modId: row.id })); } catch (_) { return; }
    setConfirm(ready);
  }
  const apply = async () => { await mods.task(() => rpc('managedModApply', { token: confirm.token, revision: confirm.revision, answers: {} })); mods.changed(); onBack(); };
  const deps = row.dependencies || [], depNotice = id => (detail?.dependencies || row.notices || []).find(item => item.dependencyId === id), byId = id => mods.data?.mods.find(item => item.id === id);
  const config = detail?.config, labels = list => list?.length ? list.map(field => field.label).join('、') : '无';
  const conflicts = detail?.conflicts || [], assets = detail?.assetKinds, dependents = (detail?.dependents || []).map(item => modQuote(byId(item.consumerId)?.name || item.consumerId));
  return h('article', { className: 'fork-mod-manager-page', onKeyDown: subpageKeys(onBack) },
    h(SubpageHead, { parent: '模组管理', title: row.name, onBack, help: row.summary ? h(Help, { label: row.name + ' 说明', text: row.summary }) : null,
      tools: row.installed ? h(ModSwitchTag, { name: row.name, switches: row.switches, busy: mods.busy, onChange: (scope, value) => change(row, scope, value) }) : null }),
    h(ErrorBox, { error: mods.error }), notice,
    h(StageSection, { title: '版本', foldKey: 'mod-manager/version' },
      h(ModInfoRow, { label: '模组 ID' }, h('span', { className: 'fork-mod-info-meta' }, row.id)),
      h(ModInfoRow, { label: row.installed ? '运行版本' : '版本', help: '每个模组只运行一个版本；库里保留的其他版本可以在这里切换。' },
        h(InlineField, { kind: 'menu', label: row.installed ? '运行版本' : '版本', hideLabel: true, value: chosen, disabled: mods.busy || versions.length < 2,
          options: versions.map(item => ({ value: item.version, label: item.version })), onCommit: version => row.installed ? version !== row.version && plan('selectVersion', version) : setPick(version) })),
      row.installed ? null : h('div', { className: 'fork-mod-install-action' }, h(Button, { primary: true, disabled: mods.busy || !chosen, onClick: () => plan('install', chosen) }, '安装'))),
    h(StageSection, { title: '依赖', meta: deps.length, foldKey: 'mod-manager/dependencies', help: '本卡开启时，必需的依赖会一起开启；缺少时这个模组会少一部分功能。' },
      deps.length ? deps.map(dep => {
        const other = byId(dep.id), state = depNotice(dep.id), text = state?.reason ? MOD_DEP_REASONS[state.reason] || state.message : other?.installed ? '已安装 ' + other.version : '未安装';
        return h(ModInfoRow, { key: dep.id, label: other?.name || dep.id, meta: (other ? dep.id + ' ' : '') + dep.range + (dep.optional ? ' · 可选' : '') },
          state?.reason && !dep.optional && state.reason !== 'disabled' ? h(React.Fragment, null, h(HintLine, { compact: true, text }), h('span', { 'aria-hidden': true }, text)) : h('span', null, text));
      }) : h(EmptyState, { compact: true, text: '不依赖其他模组' }),
      dependents.length ? h(ModInfoRow, { label: '被依赖', help: '这些模组必需它。' }, h('span', { className: 'fork-mod-info-list' }, dependents.join('、'))) : null),
    conflicts.length ? h(StageSection, { title: '冲突', meta: conflicts.length, foldKey: 'mod-manager/conflicts', help: '冲突的两个模组不能同时开启。' },
      conflicts.map(item => h(ModInfoRow, { key: item.id, label: byId(item.id)?.name || item.id, meta: (byId(item.id) ? item.id + ' ' : '') + item.range },
        h('span', null, byId(item.id)?.switches?.effective ? '已开启' : byId(item.id)?.installed ? '已安装' : '未安装')))) : null,
    h(StageSection, { title: '数据', foldKey: 'mod-manager/data' },
      !detail ? h(Loading, { shape: 'fields' }) : h(React.Fragment, null,
        h(ModInfoRow, { label: '设置', help: MOD_DATA_HELP.config }, h('span', { className: 'fork-mod-info-list' }, labels(config?.fields))),
        h(ModInfoRow, { label: '玩家偏好', help: MOD_DATA_HELP.preferences }, h('span', { className: 'fork-mod-info-list' }, labels(config?.preferenceFields))),
        assets ? h(ModInfoRow, { label: '素材', help: MOD_DATA_HELP.assets }, h('span', { className: 'fork-mod-info-list' }, labels(assets))) : null)),
    row.installed && row.globalRoot !== false ? h('div', { className: 'fork-mod-danger' }, h(Button, { className: 'ap-danger-text', disabled: mods.busy, onClick: uninstall }, '卸载模组…')) : null,
    confirm && h(ConfirmDialog, { title: '卸载' + modQuote(row.name), danger: true, confirmLabel: '卸载', onConfirm: apply, onClose: () => setConfirm(null),
      body: confirm.retainedByCards?.length ? confirm.retainedByCards.length + ' 张卡仍在用它，这些卡保留它的代码；其他卡会缺少这个模组。' : '用到它的卡会缺少这个模组；卡里的选择和设置保留。',
      extra: dependents.length ? dependents.join('、') + '需要它。' : undefined }));
}
