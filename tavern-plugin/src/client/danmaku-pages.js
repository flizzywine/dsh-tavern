// the panel side. Included inside the asset-pack
// UI factory next to mod-config-pages.js, so it uses the panel's one StageSection / Help / ModField / HintLine.
//  - DanmakuModPage: 舞台设置 › 基础设置 › 弹幕 › — set-once engine settings only (ui-design R21): the model actually
//    used and the call cadence (the model itself is chosen in 酒馆设置 › 模组模型; this page only links there) and the
//    audience groups. The view is switched on the stage corner; 飘屏 appearance and density live in the stage CONFIG.
//  - AudienceFields / AudienceRuleSections: the 观众群 (audience) entry's content for the entry editor (人设 /
//    语气与尺度 / 口癖 / 示例, then one row per 预设弹幕 / 接话 rule).

const DANMAKU_CADENCE = Object.freeze({ minIntervalMs: 3000, maxPerMinute: 20, maxInFlight: 1 });
const AUDIENCE_LIMITS = Object.freeze({ persona: 1200, tone: 600, catchphrases: 12, catchphrase: 120, examples: 12, example: 240, nicknames: 32, nickname: 24 });
const danmakuChars = s => [...String(s ?? '')].length;
// '最多 20 次/分 · 间隔 ≥ 3 秒'. Pure; tests.
function danmakuCadenceText(c = DANMAKU_CADENCE) {
    return '最多 ' + c.maxPerMinute + ' 次/分 · 间隔 ≥ ' + Math.round(c.minIntervalMs / 100) / 10 + ' 秒';
}
// The model the slot really uses: its own global choice, else the foreground default it follows (frozen per request by
// the host). { label, follow, available }. Pure; tests.
function danmakuModelInfo({ selection, foreground, catalog = [] }) {
    const pick = selection || foreground || null;
    const follow = !selection;
    if (!pick) return { label: 'DSH 默认模型', follow, available: true };
    const group = catalog.find(g => g.provider === pick.provider), model = group?.models?.find(m => m.id === pick.model);
    return { label: model ? model.name || model.id : pick.model || '未知模型', follow, available: !!model };
}
// The entry editor's content limits (the backend's validateAudienceContent is the real boundary). '' = fine. Pure; tests.
function audienceProblem(key, value) {
    const L = AUDIENCE_LIMITS;
    if (key === 'persona') return !String(value || '').trim() ? '请填写人设' : danmakuChars(value) > L.persona ? '人设最多 ' + L.persona + ' 字' : '';
    if (key === 'tone') return !String(value || '').trim() ? '请填写语气与尺度' : danmakuChars(value) > L.tone ? '语气与尺度最多 ' + L.tone + ' 字' : '';
    if (key === 'catchphrases') return value.length > L.catchphrases ? '口癖最多 ' + L.catchphrases + ' 条' : value.some(w => danmakuChars(w) > L.catchphrase) ? '每条口癖最多 ' + L.catchphrase + ' 字' : '';
    if (key === 'nicknamePool') return value.length > L.nicknames ? '昵称最多 ' + L.nicknames + ' 个' : value.some(w => danmakuChars(w) > L.nickname) ? '每个昵称最多 ' + L.nickname + ' 字' : '';
    if (key === 'examples') return value.length > L.examples ? '示例最多 ' + L.examples + ' 条' : value.some(w => danmakuChars(w) > L.example) ? '每条示例最多 ' + L.example + ' 字' : '';
    return '';
}
const audienceLines = text => String(text || '').split('\n').map(s => s.trim()).filter(Boolean);

// props: { content: AudienceContent, onCommit(nextContent) → Promise, Help }. Rows for the editor's InlineGrid; empty
// optional rows (口癖 / 示例 / 昵称) fold into the grid's 「＋ 名称」 chips (InlineGrid hideEmpty).
function AudienceFields({ content, onCommit, Help: HelpTip }) {
    const h = React.createElement, c = content || {}, help = (label, text) => HelpTip ? h(HelpTip, { text, label: label + ' 说明' }) : null;
    // nicknamePool (contract v4.2: 1..32 whole handles, ≤ 24 characters, used as-is) is optional: an emptied list is left out, not stored as [].
    const commit = patch => { const next = { ...c, persona: c.persona || '', tone: c.tone || '', catchphrases: c.catchphrases || [], examples: c.examples || [], ...patch }; if (!next.nicknamePool?.length) delete next.nicknamePool; return onCommit(next); };
    return [
        h(InlineField, { key: 'persona', kind: 'text', multiline: true, label: '人设', className: 'ap-note-field', help: help('人设', '这群观众是谁、爱看什么、怎么说话。'), placeholder: '未填写', value: c.persona || '',
            validate: v => audienceProblem('persona', v), onCommit: v => commit({ persona: v }) }),
        h(InlineField, { key: 'tone', kind: 'text', multiline: true, label: '语气与尺度', className: 'ap-note-field', help: help('语气与尺度', '可以吐槽到什么程度、哪些话不说。'), placeholder: '未填写', value: c.tone || '',
            validate: v => audienceProblem('tone', v), onCommit: v => commit({ tone: v }) }),
        h(InlineField, { key: 'catchphrases', kind: 'chips', label: '口癖', hideEmpty: true, addLabel: '添加口癖', value: c.catchphrases || [],
            split: text => [...new Set(String(text || '').split(/[\n，、]/).map(w => w.trim()).filter(Boolean))],
            validate: list => audienceProblem('catchphrases', list), onCommit: list => commit({ catchphrases: list }) }),
        h(InlineField, { key: 'examples', kind: 'text', multiline: true, lines: true, label: '示例', className: 'ap-note-field', hideEmpty: true, help: help('示例', '每行一条示范弹幕。Shift+Enter 换行。'), value: (c.examples || []).join('\n'),
            validate: v => audienceProblem('examples', audienceLines(v)), onCommit: v => commit({ examples: audienceLines(v) }) }),
        h(InlineField, { key: 'nicknamePool', kind: 'chips', label: '昵称', hideEmpty: true, addLabel: '添加昵称', help: help('昵称', '这群观众的模拟昵称（编的，别用真实账号），约五分之一的弹幕原样使用。不填就只用通用昵称。'), value: c.nicknamePool || [],
            split: text => [...new Set(String(text || '').split(/[\n，、]/).map(w => w.trim()).filter(Boolean))],
            validate: list => audienceProblem('nicknamePool', list), onCommit: list => commit({ nicknamePool: list }) }),
    ];
}

// 预设弹幕 (triggers: keywords in newly shown text → one of the lines, by probability, with a cool-down) and 接话 (chains: a
// comment containing `match` → one of the replies, by probability). P6-CONTRACT §3/§5; the runtime does the matching and
// the dice, the editor only edits the rules. Each rule has a stable id inside the entry (never its text).
// One rule = one row: 「关键词 → 内容」 as chips, the probability as a small %, (预设) the cool-down; the
// grammar is explained once in the section's (?).
const AUDIENCE_RULE_KINDS = Object.freeze({
    triggers: { title: '预设弹幕', help: '正文新显示的文字里出现左边任一关键词时，按概率从右边随机发一条，不调用模型；发过后冷却期内不再触发。点一句内容可设为醒目留言。', add: '添加预设弹幕', prefix: 't',
        when: '关键词', say: { key: 'lines', label: '内容', add: '添加内容' }, probability: 1 },
    chains: { title: '接话', help: '飘过的弹幕包含左边这段文字时，按概率有观众从右边随机接一句。点一句接话可设为醒目留言。', add: '添加接话', prefix: 'c',
        when: '弹幕含', say: { key: 'replies', label: '接话', add: '添加接话内容' }, probability: 0.5 },
});
const AUDIENCE_RULE_LIMITS = Object.freeze({ rules: 12, words: 12, wordMin: 2, word: 120, lines: 12, line: 160, matchMin: 2, match: 160, cooldown: 3600 });
// '' = fine. field: keywords | lines | replies | match. Pure; tests.
function audienceRuleProblem(field, value) {
    const L = AUDIENCE_RULE_LIMITS;
    if (field === 'match') { const n = danmakuChars(String(value || '').trim()); return n < L.matchMin ? '至少 ' + L.matchMin + ' 个字' : n > L.match ? '最多 ' + L.match + ' 字' : ''; }
    if (field === 'keywords') return value.length > L.words ? '最多 ' + L.words + ' 个关键词' : value.some(w => danmakuChars(w) < L.wordMin) ? '关键词至少 ' + L.wordMin + ' 个字' : value.some(w => danmakuChars(w) > L.word) ? '每个关键词最多 ' + L.word + ' 字' : '';
    return value.length > L.lines ? '最多 ' + L.lines + ' 条' : value.some(w => danmakuChars(w) > L.line) ? '每条最多 ' + L.line + ' 字' : '';
}
// A rule is stored once it has its trigger and something to say (the contract requires both). Pure; tests.
function audienceRuleReady(kind, rule) {
    if (kind === 'chains') return !audienceRuleProblem('match', rule.match) && (rule.replies || []).length > 0;
    return (rule.keywords || []).length > 0 && (rule.lines || []).length > 0;
}
// A new stable id: prefix + base36 time + a counter, unique in the list. Pure given `now`; tests.
function audienceRuleId(kind, rules, now = Date.now()) {
    const taken = new Set(rules.map(r => r.id)), base = AUDIENCE_RULE_KINDS[kind].prefix + '-' + now.toString(36);
    let id = base, n = 1;
    while (taken.has(id)) id = base + '-' + n++;
    return id;
}
function audienceRuleBlank(kind, rules) {
    const id = audienceRuleId(kind, rules);
    return kind === 'chains' ? { id, match: '', replies: [], probability: AUDIENCE_RULE_KINDS.chains.probability } : { id, keywords: [], lines: [] };
}
// Probability shown as a whole percent; stored as 0..1. Pure; tests.
const audiencePercent = (rule, kind) => Math.round((rule.probability ?? AUDIENCE_RULE_KINDS[kind].probability) * 100);
// Preset v4 candidates: a line / reply is a string or {text, kind, amount} (a 醒目留言 candidate). The chips edit the
// text; a candidate whose text is kept keeps its kind and amount (set from the chip's menu below). Pure; tests.
const audienceLineText = line => typeof line === 'string' ? line : String(line?.text ?? '');
// 醒目留言 candidates (decided: in the chip's own menu): a line's chip opens 普通弹幕 / 醒目留言 · 金额随机 /
// 醒目留言 ¥30 … ¥2,000; a 醒目留言 chip wears its amount in that tier's colour. The weighted random amount is the
// contract's omitted amount.
const AUDIENCE_SC_AMOUNTS = Object.freeze([30, 50, 100, 500, 1000, 2000]);
// null for an ordinary line, else {amount: one of the amounts | null (random)}. Pure; tests.
function audienceLineSc(line) {
    return line && typeof line === 'object' && line.kind === 'highlight' ? { amount: AUDIENCE_SC_AMOUNTS.includes(line.amount) ? line.amount : null } : null;
}
// The line after a pick from its chip menu: 'comment' | 'auto' | an amount. Pure; tests.
function audienceSetLineKind(line, value) {
    const text = audienceLineText(line);
    if (value === 'comment') return text;
    return value === 'auto' ? { text, kind: 'highlight' } : { text, kind: 'highlight', amount: value };
}
function audienceLineMenu(line) {
    const sc = audienceLineSc(line), price = a => '¥' + a.toLocaleString('en-US');
    return [{ value: 'comment', label: '普通弹幕', checked: !sc }, { value: 'auto', label: '醒目留言 · 金额随机', checked: !!sc && sc.amount === null },
        ...AUDIENCE_SC_AMOUNTS.map(a => ({ value: a, label: '醒目留言 ' + price(a), checked: !!sc && sc.amount === a }))];
}
function audienceLineTag(line) {
    const sc = audienceLineSc(line);
    return sc ? { text: sc.amount ? '¥' + sc.amount.toLocaleString('en-US') : '醒目留言', tone: 'sc-' + Math.max(0, AUDIENCE_SC_AMOUNTS.indexOf(sc.amount)) } : null;
}
function audienceMergeLines(previous, texts) {
    const kept = new Map((previous || []).filter(line => line && typeof line === 'object').map(line => [audienceLineText(line), line]));
    return texts.map(text => kept.get(text) || text);
}
// Lines are whole sentences (they may contain commas): a chip per line, split only on line breaks.
const audienceSplitLines = text => [...new Set(String(text || '').split(/\n/).map(w => w.trim()).filter(Boolean))];

// props: { kind: 'triggers' | 'chains', rules, onCommit(nextRules) → Promise, start, onClose }. A level-2 section of the 观众群 editor.
// No rules: no section at all  — its 「＋ 名称」 chip sits in the entry's field grid
// (audienceRuleAdds). The chip mounts the section with `start`: one new row, focused; leaving that row still blank
// (focus out of the section, Esc, or 放弃这条) calls onClose and the chip comes back.
// InlineGrid's empty-row rule.
// ＋ adds an unsaved row that is stored once complete. No button on the row (R13: deleting a rule is rare):
// the row's own menu (cellMenuTrigger — right click / Shift+F10 / the menu key with a mouse or keyboard, a tap on the
// row's free space on touch) holds 「删除这条预设弹幕 / 接话」 (no …: no dialog follows); it deletes at once and leaves one 「撤销」 line.
function AudienceRules({ kind, rules = [], onCommit, start = false, onClose }) {
    const h = React.createElement, k = AUDIENCE_RULE_KINDS[kind];
    const [draft, setDraft] = React.useState(() => start && !rules.length ? audienceRuleBlank(kind, rules) : null), [busy, setBusy] = React.useState(false), [undo, setUndo] = React.useState(null);
    const save = async next => { setBusy(true); try { await onCommit(next); return true; } catch (_) { return false; } finally { setBusy(false); } };
    const change = (id, patch) => save(rules.map(rule => rule.id === id ? { ...rule, ...patch } : rule));
    const changeDraft = patch => { const next = { ...draft, ...patch }; if (audienceRuleReady(kind, next)) { setDraft(null); return save([...rules, next]); } setDraft(next); return Promise.resolve(true); };
    const remove = rule => { const at = rules.indexOf(rule); save(rules.filter(r => r !== rule)).then(ok => { if (ok) setUndo({ rule, at }); }); };
    const restore = () => { const u = undo; setUndo(null); if (u && rules.length < AUDIENCE_RULE_LIMITS.rules) save([...rules.slice(0, u.at), u.rule, ...rules.slice(u.at)]); };
    // Clicks, right clicks and keys that belong to a field (editing a chip or number, a text box's own context menu) stay
    // with it; the rest of the row is the menu trigger.
    const free = event => !event.target.closest?.('.fork-inline-field, button, input, textarea, [contenteditable]');
    const typing = event => !!event.target.closest?.('input, textarea, [contenteditable]');
    // An opened section with nothing in it folds back into its chip.
    const blank = rule => !(rule.keywords || []).length && !(rule.lines || []).length && !(rule.replies || []).length && !String(rule.match || '').trim();
    const dropDraft = () => { setDraft(null); if (!rules.length && onClose) onClose(); };
    const fold = node => setTimeout(() => { if (!node.contains(document.activeElement) && !node.querySelector('[data-menu-open]') && draft && blank(draft) && !rules.length && onClose) onClose(); }, 0);
    const row = (rule, set, isDraft) => h(Popover, { key: rule.id, label: k.title + ' 操作', className: 'ap-dm-rule-anchor', float: true, fit: true,
        content: close => [h(MenuItem, { key: 'delete', danger: true, onClick: () => { close(); if (isDraft) dropDraft(); else remove(rule); } }, isDraft ? '放弃这条' : '删除这条' + k.title)],
        trigger: ({ open, toggle }) => { const menu = cellMenuTrigger({ open, toggle, onPrimary: () => {} }); return rowBody(rule, set, isDraft, {
            'aria-haspopup': menu['aria-haspopup'], 'aria-expanded': menu['aria-expanded'], 'aria-keyshortcuts': menu['aria-keyshortcuts'], 'data-menu-open': open || undefined,
            onClick: event => { if (free(event)) menu.onClick(event); },
            onContextMenu: event => { if (!typing(event)) menu.onContextMenu(event); },
            onKeyDown: event => { if (!typing(event)) menu.onKeyDown(event); } }); } });
    const rowBody = (rule, set, isDraft, menuProps) => h('div', { className: 'ap-dm-rule', role: 'group', 'aria-label': k.title + (isDraft ? '（新）' : ''), ...menuProps },
        kind === 'chains'
            ? h(InlineField, { kind: 'text', label: k.when, hideLabel: true, className: 'ap-dm-rule-when', placeholder: k.when + '…', value: rule.match || '', disabled: busy, autoEdit: isDraft && start, validate: v => audienceRuleProblem('match', v), onCommit: v => set({ match: v }) })
            : h(InlineField, { kind: 'chips', label: k.when, hideLabel: true, className: 'ap-dm-rule-when', addLabel: '添加关键词', value: rule.keywords || [], disabled: busy, autoEdit: isDraft && start, validate: list => audienceRuleProblem('keywords', list), onCommit: list => set({ keywords: list }) }),
        h('span', { className: 'ap-dm-rule-arrow', 'aria-hidden': true }, '→'),
        h(InlineField, { kind: 'chips', label: k.say.label, hideLabel: true, className: 'ap-dm-rule-say', addLabel: k.say.add, value: (rule[k.say.key] || []).map(audienceLineText), split: audienceSplitLines, disabled: busy,
            chipMenu: (word, i) => audienceLineMenu((rule[k.say.key] || [])[i]), chipTag: (word, i) => audienceLineTag((rule[k.say.key] || [])[i]),
            onChipMenu: (word, i, value) => set({ [k.say.key]: (rule[k.say.key] || []).map((line, j) => j === i ? audienceSetLineKind(line, value) : line) }),
            validate: list => audienceRuleProblem(k.say.key, list), onCommit: list => set({ [k.say.key]: audienceMergeLines(rule[k.say.key], list) }) }),
        h('span', { className: 'ap-dm-rule-nums' },
            h(InlineField, { kind: 'number', label: '概率', hideLabel: true, title: '概率', className: 'ap-dm-rule-num', unit: '%', integer: true, min: 0, max: 100, value: audiencePercent(rule, kind), disabled: busy,
                onCommit: v => { const p = (v ?? k.probability * 100) / 100; if (Math.abs(p - (rule.probability ?? k.probability)) > 0.001) set({ probability: p }); } }),
            kind === 'triggers' ? h(InlineField, { kind: 'number', label: '冷却', hideLabel: true, title: '冷却', className: 'ap-dm-rule-num', unit: '秒', integer: true, min: 0, max: AUDIENCE_RULE_LIMITS.cooldown, value: rule.cooldown ?? 30, disabled: busy,
                onCommit: v => set({ cooldown: v ?? 30 }) }) : null));
    if (!rules.length && !draft && !undo) return null;
    return h(StageSection, { title: k.title, meta: rules.length || undefined, level: 2, help: k.help, foldKey: 'audience/' + kind },
        h('div', { className: 'ap-dm-rules fork-dm-scope',
                onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) fold(event.currentTarget); },
                onKeyDown: event => { if (event.key === 'Escape' && !event.defaultPrevented && draft && blank(draft) && !rules.length && onClose) { event.preventDefault(); event.stopPropagation(); onClose(); } } },
            rules.map(rule => row(rule, patch => change(rule.id, patch), false)),
            draft ? row(draft, changeDraft, true) : null,
            undo ? h('p', { className: 'ap-notice', role: 'status' }, h('span', null, '已删除一条' + k.title), h(Button, { className: 'ap-hint-chip', onClick: restore }, '撤销')) : null,
            !draft && rules.length < AUDIENCE_RULE_LIMITS.rules ? h(CatAddTile, { label: k.add, className: 'ap-dm-rule-add', onClick: () => { setUndo(null); setDraft(audienceRuleBlank(kind, rules)); } }) : null));
}
// Both rule sections under the entry's fields: props { content, onCommit(nextContent), open: Set of kinds opened from their
// chip, onClose(kind) }. A section is keyed by its open state so a chip always mounts it with its new row.
function AudienceRuleSections({ content, onCommit, open = new Set(), onClose }) {
    const h = React.createElement, c = content || {};
    return h(React.Fragment, null, ['triggers', 'chains'].map(kind => h(AudienceRules, { key: kind + (open.has(kind) ? ':open' : ''), kind, rules: c[kind] || [], start: open.has(kind),
        onClose: onClose && (() => onClose(kind)), onCommit: rules => onCommit({ ...c, [kind]: rules }) })));
}
// The 「＋ 预设弹幕」 / 「＋ 接话」 chips for the entry's field grid: one per rule kind with no rules that is not open.
function audienceRuleAdds({ content, open = new Set(), onOpen }) {
    const h = React.createElement, c = content || {};
    return ['triggers', 'chains'].filter(kind => !(c[kind] || []).length && !open.has(kind))
        .map(kind => h(InlineSectionAdd, { key: '@rules-' + kind, label: AUDIENCE_RULE_KINDS[kind].title, onAdd: () => onOpen(kind) }));
}

// 弹幕库: the corpus an audience entry carries
// (extensions['dsh.danmaku.corpus']), read-only, as a compact list inside the entry. Nothing
// ships in the client: the section fetches the host's prepared view (readAudienceCorpus → corpusBrowseView) when it is
// open, once per corpus file. One row per segment (source · summary · mood tags · the most-said comments · count); a
// click opens that row in place (its most-said comments, then its script as one line), one row at a time. The group menu and the search
// filter the same rows; the list is paged. 备用反应 is the runtime's fallback pool by class, as the same rows.
const CORPUS_EXTENSION = 'dsh.danmaku.corpus';
const audienceHasCorpus = asset => typeof asset?.extensions?.[CORPUS_EXTENSION]?.path === 'string';
const CORPUS_CLASSES = Object.freeze({ laugh: '笑', cute: '萌', sad: '悲伤', tense: '紧张', shock: '惊讶', sweet: '甜', cool: '帅', awkward: '尴尬', applause: '鼓掌', greeting: '招呼', neutral: '中性' });
// rows: the first page and each 「再显示」 step; inline: comments in a closed row; open: comments in an opened row.
const CORPUS_PAGE = Object.freeze({ rows: 10, more: 40, inline: 3, open: 12 });
const CORPUS_ALL = '\u0000all';
const corpusNumber = n => Number(n || 0).toLocaleString('en-US');
// Corpus-declared grouping is optional; segment and comment counts are universal.
function corpusTotals(totals) {
    return [totals.groups && totals.groupLabel ? totals.groups + ' ' + totals.groupLabel : '', corpusNumber(totals.segments) + ' 段', corpusNumber(totals.comments) + ' 条'].filter(Boolean).join(' · ');
}
const corpusSource = place => [place.window.source, place.window.position].filter(Boolean).join(' · ') || '第 ' + place.n + ' 段';
// The view's windows in reading order with their place: [{window, group, n (1-based within the corpus)}]. Pure; tests.
function corpusPlaces(view) {
    return view.segments.map((window, i) => ({ window, group: window.group || '', n: i + 1 }));
}
// The rows to list: the places in `group` (CORPUS_ALL = every group) and, while searching, only those whose label,
// lines, summary, mood or comments contain the text (case-insensitive). A row's comments put the matching ones first
// (each part most said first); `hits` counts the matching comments. Pure; tests.
function corpusRows(places, { group = CORPUS_ALL, query = '' } = {}) {
    const q = String(query || '').trim().toLowerCase(), out = [];
    for (const place of places) {
        if (group !== CORPUS_ALL && place.group !== group) continue;
        const w = place.window;
        if (!q) { out.push({ place, comments: w.comments, hits: 0 }); continue; }
        const hit = w.comments.filter(([text]) => text.toLowerCase().includes(q));
        if (!hit.length && ![corpusSource(place), ...w.lines, w.summary, w.mood].some(text => text.toLowerCase().includes(q))) continue;
        const first = new Set(hit);
        out.push({ place, comments: hit.length ? [...hit, ...w.comments.filter(c => !first.has(c))] : w.comments, hits: hit.length });
    }
    return out;
}
// The text split around case-insensitive matches of `query`: [{text, hit}]. Pure; tests.
function corpusMarks(text, query) {
    const q = String(query || '').trim().toLowerCase(), out = [];
    if (!q) return [{ text, hit: false }];
    const lower = text.toLowerCase();
    for (let at = 0; at < text.length;) {
        const i = lower.indexOf(q, at);
        if (i < 0) { out.push({ text: text.slice(at), hit: false }); break; }
        if (i > at) out.push({ text: text.slice(at, i), hit: false });
        out.push({ text: text.slice(i, i + q.length), hit: true });
        at = i + q.length;
    }
    return out;
}
// One fetch per corpus file (its manifest hash), kept for the two most recent; a failed read is forgotten.
const corpusViews = new Map();
function corpusKey(pack, asset) {
    const path = asset.extensions[CORPUS_EXTENSION].path;
    return pack.manifest.id + '/' + asset.id + '/' + (pack.manifest.files || []).find(f => f.path === path)?.sha256;
}
function corpusLoad(binding, pack, asset) {
    const key = corpusKey(pack, asset);
    if (!corpusViews.has(key)) {
        const read = Promise.resolve((binding.engineRpc || binding.rpc)('readAudienceCorpus', { packId: pack.manifest.id, assetId: asset.id }));
        corpusViews.set(key, read);
        read.catch(() => corpusViews.delete(key));
        while (corpusViews.size > 2) corpusViews.delete(corpusViews.keys().next().value);
    }
    return corpusViews.get(key);
}
function CorpusMarked({ text, query }) {
    const h = React.createElement;
    return h(React.Fragment, null, corpusMarks(text, query).map((part, i) => part.hit ? h('mark', { key: i, className: 'ap-dm-hit' }, part.text) : part.text));
}
function CorpusComment({ text, count, query }) {
    const h = React.createElement;
    return h('li', { className: 'ap-dm-comment' }, h('span', { className: 'ap-dm-comment-text' }, h(CorpusMarked, { text, query })),
        count > 1 ? h('span', { className: 'ap-dm-times', 'aria-label': count + ' 次' }, '×' + corpusNumber(count)) : null);
}
const corpusCommentList = (comments, query) => comments.length ? React.createElement('ul', { className: 'ap-dm-comments', 'aria-label': '弹幕' },
    comments.map(([text, count], i) => React.createElement(CorpusComment, { key: i, text, count, query }))) : null;
// One list row: a button with the label, the one-line summary, mood tags, the first comments and the count; opened, its
// body below. Text the row's width cuts short carries its whole text as its title.
function CorpusRow({ id, label, summary, moods = [], comments, count, query, open, onToggle, children }) {
    const h = React.createElement, bodyId = 'ap-dm-seg-' + id;
    return h('li', { className: 'ap-dm-seg', 'data-open': open || undefined },
        h('button', { type: 'button', className: 'ap-dm-seg-row', 'aria-expanded': open, 'aria-controls': open ? bodyId : undefined, onClick: onToggle },
            h('span', { className: 'ap-dm-seg-src', title: label }, h(CorpusMarked, { text: label, query })),
            summary ? h('span', { className: 'ap-dm-seg-sum', title: summary }, h(CorpusMarked, { text: summary, query })) : null,
            moods.length ? h('span', { className: 'ap-dm-seg-moods' }, moods.map(m => h('span', { key: m, className: 'ap-dm-mood', title: m }, h(CorpusMarked, { text: m, query })))) : null,
            comments.length ? h('span', { className: 'ap-dm-seg-top' }, comments.slice(0, CORPUS_PAGE.inline).map(([text], i) =>
                h('span', { key: i, className: 'ap-dm-seg-dm', title: text }, h(CorpusMarked, { text, query })))) : null,
            h('span', { className: 'ap-dm-seg-count' }, corpusNumber(count) + ' 条')),
        open ? h('div', { className: 'ap-dm-seg-body', id: bodyId, role: 'region', 'aria-label': label }, children) : null);
}
// An opened segment's script as one line: its lines joined by ／, cut with …; only
// when cut, a chevron (or a click on the text) shows the whole script wrapped, and again folds it. A search hit in the
// script starts it whole, so the highlight is never hidden.
function CorpusScript({ lines, query }) {
    const h = React.createElement, text = React.useRef(null), q = String(query || '').toLowerCase();
    const [whole, setWhole] = React.useState(() => !!q && lines.some(line => line.toLowerCase().includes(q))), [cut, setCut] = React.useState(false);
    React.useLayoutEffect(() => {
        if (whole) return undefined;
        const node = text.current, measure = () => setCut(node.scrollWidth > node.clientWidth + 1);
        measure();
        const watch = new ResizeObserver(measure);
        watch.observe(node);
        return () => watch.disconnect();
    }, [whole, lines]);
    const toggle = cut || whole, name = whole ? '收起台词' : '展开台词';
    return h('div', { className: 'ap-dm-seg-lines', 'data-whole': whole || undefined, onClick: toggle ? () => setWhole(!whole) : undefined },
        h('span', { ref: text, className: 'ap-dm-seg-script', title: cut && !whole ? lines.join('\n') : undefined },
            lines.map((line, i) => h(React.Fragment, { key: i }, i ? h('span', { className: 'ap-dm-seg-sep', 'aria-hidden': true }, '／') : null,
                h('span', { className: 'ap-dm-seg-line' }, h(CorpusMarked, { text: line, query }))))),
        toggle ? h('button', { type: 'button', className: 'ap-dm-seg-more', 'aria-expanded': whole, 'aria-label': name, title: name, onClick: e => { e.stopPropagation(); setWhole(!whole); } },
            h(InlineGlyph, { name: 'chevDown' })) : null);
}
// Rows (each {id, label, …, body() → the opened content}), paged; one is open at a time (opening another closes it).
function CorpusList({ rows, resetKey, label }) {
    const h = React.createElement, [limit, setLimit] = React.useState(CORPUS_PAGE.rows), [open, setOpen] = React.useState(null);
    React.useEffect(() => { setLimit(CORPUS_PAGE.rows); setOpen(null); }, [resetKey]);
    const rest = rows.length - limit;
    return h(React.Fragment, null,
        h('ul', { className: 'ap-dm-segs', 'aria-label': label }, rows.slice(0, limit).map(({ body, ...row }) =>
            h(CorpusRow, { key: row.id, ...row, open: open === row.id, onToggle: () => setOpen(open === row.id ? null : row.id) }, open === row.id ? body() : null))),
        rest > 0 ? h(Button, { className: 'ap-dm-more', onClick: () => setLimit(limit + CORPUS_PAGE.more) }, '再显示 ' + corpusNumber(Math.min(rest, CORPUS_PAGE.more)) + ' 段') : null);
}
function CorpusScenes({ found, query, resetKey }) {
    const h = React.createElement;
    const rows = found.map(({ place, comments }) => { const w = place.window; return {
        id: w.id, label: corpusSource(place), summary: w.summary || w.lines[0] || '', moods: w.mood ? w.mood.split('、').filter(Boolean) : [],
        comments, count: w.comments.length, query,
        body: () => [h(React.Fragment, { key: 'comments' }, corpusCommentList(comments.slice(0, CORPUS_PAGE.open), query)),
            w.lines.length ? h(CorpusScript, { key: 'lines', lines: w.lines, query }) : null] }; });
    return h(CorpusList, { rows, resetKey, label: '片段' });
}
function CorpusReactions({ reactions }) {
    const h = React.createElement, order = Object.keys(CORPUS_CLASSES);
    const rows = [...reactions].sort((a, b) => order.indexOf(a.reactionClass) - order.indexOf(b.reactionClass)).map(r => ({
        id: 'r-' + r.reactionClass, label: CORPUS_CLASSES[r.reactionClass] || r.reactionClass, comments: r.rows, count: r.rows.length,
        body: () => corpusCommentList(r.rows) }));
    if (!rows.length) return h(EmptyState, { compact: true, text: '没有备用反应' });
    return h(CorpusList, { rows, resetKey: 'reactions', label: '备用反应' });
}
function CorpusBrowser({ view }) {
    const h = React.createElement, places = React.useMemo(() => corpusPlaces(view), [view]);
    const [tab, setTab] = React.useState('scenes'), [group, setGroup] = React.useState(CORPUS_ALL);
    const [query, setQuery] = React.useState(''), deferred = React.useDeferredValue(query).trim();
    const found = React.useMemo(() => corpusRows(places, { group, query: deferred }), [places, group, deferred]);
    if (!view.totals.segments) return h(EmptyState, { compact: true, text: '弹幕库是空的' });
    const groups = [...view.groups, ...(view.groups.length && view.segments.some(s => !s.group) ? [''] : [])];
    return h('div', { className: 'ap-dm-corpus' },
        h('div', { className: 'ap-dm-corpus-tools' },
            h(Segmented, { label: '弹幕库视图', className: 'ap-dm-corpus-tabs', value: tab, onChange: setTab, options: [['scenes', '片段'], ['reactions', '备用反应']] }),
            tab === 'scenes' && groups.length > 1 ? h(InlineField, { kind: 'menu', label: '分组', hideLabel: true, className: 'ap-dm-group-picker', value: group,
                options: [{ value: CORPUS_ALL, label: '全部' }, ...groups.map(g => ({ value: g, label: g || '未分组' }))], onCommit: setGroup }) : null,
            tab === 'scenes' ? h(PackSearchBox, { label: '搜索弹幕库', placeholder: '搜索', className: 'ap-dm-search', value: query, onChange: setQuery }) : null),
        tab === 'reactions' ? h(CorpusReactions, { reactions: view.reactions })
            : found.length ? h(CorpusScenes, { found, query: deferred, resetKey: group + '\u0000' + deferred })
            : h(EmptyState, { compact: true, query: deferred, onClear: () => setQuery('') }));
}
// props { binding, pack, asset }: the 弹幕库 section of an audience entry that has a corpus.
function AudienceCorpus({ binding, pack, asset }) {
    const h = React.createElement, foldKey = 'audience/corpus', key = corpusKey(pack, asset);
    const [startFolded] = useStageFold(foldKey), [open, setOpen] = React.useState(!startFolded);
    const [state, setState] = React.useState({}), [attempt, setAttempt] = React.useState(0);
    React.useEffect(() => {
        if (!open) return undefined;
        let alive = true;
        setState(s => s.key === key && s.view ? s : { key });
        corpusLoad(binding, pack, asset).then(view => { if (alive) setState({ key, view }); }, () => { if (alive) setState({ key, error: true }); });
        return () => { alive = false; };
    }, [open, key, attempt]);
    const view = state.key === key ? state.view : null;
    return h(StageSection, { title: '弹幕库', meta: view ? corpusTotals(view.totals) : undefined, level: 2, foldKey, onFold: folded => setOpen(!folded), className: 'ap-dm-corpus-section' },
        open ? view ? h(CorpusBrowser, { key, view }) : state.key === key && state.error ? h(ErrorBox, { error: '弹幕库没能载入', reload: () => setAttempt(n => n + 1) }) : h(Loading) : null);
}

// The model menu: '' follows the foreground model; a choice is [provider, model] as JSON. The stored choice stays listed
// (marked 不可用) when its provider no longer offers it. Pure; tests.
function danmakuModelOptions({ selection, foreground, catalog = [] }) {
    const followName = danmakuModelInfo({ selection: null, foreground, catalog }).label;
    const options = [{ value: '', label: '跟随前台（' + followName + '）' }];
    for (const g of catalog) for (const m of g.models || []) options.push({ value: JSON.stringify([g.provider, m.id]), label: m.name || m.id, ...(catalog.length > 1 ? { group: g.providerName || g.provider } : {}) });
    const value = selection ? JSON.stringify([selection.provider, selection.model]) : '';
    if (value && !options.some(o => o.value === value)) options.push({ value, label: (selection.model || '未知模型') + '（不可用）' });
    return { value, options };
}
const danmakuModelSelection = value => { if (!value) return null; const [provider, model] = JSON.parse(value); return { provider, model }; };
// 弹幕量 and the call cadence: fixed values on 全局 or 本卡 in the mod config,
// written to the layer the section's 「全局 | 本卡」 picks, like every other two-layer setting.
// The 设置 (?): what the mod reads, and what the stage's 「观众 N」 counts. The stage itself carries no (?) (ui-design.md
// R24); the formula is true to tavern-plugin/mods/danmaku/contract.js viewers (recalled groups + the last 30 s of comments, plus heat).
const DANMAKU_SETTINGS_HELP = Object.freeze(['弹幕只读你已读完的正文和你发出的选择，不影响剧情。',
    '舞台上的「观众」是直播间在线人数：本轮召回的观众群越多、最近 30 秒弹幕越多就越高，剧情热度上来时会短暂上涨；翻页不清零。']);
// 显示密度 / 弹幕来源 live only here, in the two layers.
const DANMAKU_OPTION_HELP = Object.freeze({ density: '疏朗：同屏弹幕减半，来不及显示的就跳过。飘屏和直播风格都生效。', aiRatio: 'AI 弹幕占的比例，其余是真实弹幕。' });
const DANMAKU_RATE_FIELDS = Object.freeze(['commentsPerRequest', 'maxCallsPerMinute', 'minIntervalSeconds']);
const DANMAKU_RATE_HELP = Object.freeze({ commentsPerRequest: '每次请求让模型写几条弹幕；越多越热闹，也越慢、越费额度。', minIntervalSeconds: '两次请求之间至少等几秒；越长越省额度，弹幕也越稀。' });
// A 全局 value saved before the two-layer settings (saveModSettings) still applies while neither layer sets the key
// (SETTINGS-INTERFACE precedence: 本卡 → 全局 → legacy → default), so the rows show it rather than the default.
function danmakuRateConfig(config, legacy) {
    const data = config.data;
    if (!data || !legacy) return config;
    const resolved = { ...data.resolved };
    for (const key of DANMAKU_RATE_FIELDS) if (Object.hasOwn(legacy, key) && !cfgOwn(data.global, key) && !cfgOwn(data.card, key)) resolved[key] = { value: legacy[key] };
    return { ...config, data: { ...data, resolved } };
}

// The live room's host (主播) for this card: its name and face, stored per card in the
// mod config (streamerName, streamerAvatarRef; card layer only, fixed values). The face is one of the characters of the
// card's lit packs, drawn by the panel's identity resolver (FigureCastFace + figureAvatar, as StageAvatar); a custom
// image appears once the config declares streamerAvatarImage (an image field). Unset: the stage shows the player's
// name and a neutral face.
function DanmakuRoomRows({ config, ctx }) {
    const h = React.createElement, card = config.data?.card || {}, cardLayer = config.layerFor('streamerName') === 'card' && !!config.cardId;
    const name = card.streamerName?.fixed || '', ref = card.streamerAvatarRef?.fixed || null, image = card.streamerAvatarImage?.fixed || null;
    const rows = ctx ? stageFigureRows(ctx).filter(row => row.figure && row.figure.enabled !== false) : [];
    const picked = ref && rows.find(row => row.ref.packId === ref.packId && row.ref.figureId === ref.figureId);
    const face = row => h(FigureCastFace, { binding: ctx.binding, packId: row.ref.packId, pack: row.pack, figure: row.figure, sprites: row.sprites, avatar: figureAvatar(row.figure, row.sprites), label: row.figure.name, className: 'ap-avatar fork-dm-host-face', frame: 'face' });
    const imageUrl = image ? config.fileUrl('card', image) : null, hasImageField = config.fields.has('streamerAvatarImage');
    const setRef = next => { const writes = [next ? config.set('streamerAvatarRef', { fixed: next }) : config.clear('streamerAvatarRef')]; if (image) writes.push(config.clear('streamerAvatarImage')); return Promise.all(writes); };
    const upload = file => file && config.upload('streamerAvatarImage', file).then(() => ref && config.clear('streamerAvatarRef'));
    const current = imageUrl ? h('img', { className: 'ap-avatar fork-dm-host-face', src: imageUrl, alt: '' }) : picked ? face(picked) : h('span', { className: 'ap-avatar fork-dm-host-face fork-dm-host-none', 'aria-hidden': true });
    const label = image ? '自定义图片' : picked ? picked.figure.name : ref ? '人物不在本卡素材里' : '默认';
    const disabled = !cardLayer || config.loading;
    return [
        h(InlineField, { key: 'streamerName', kind: 'text', label: '主播名称', value: name, placeholder: '默认：玩家称呼', maxLength: 64, disabled,
            onCommit: value => { const text = String(value || '').trim(); return text ? config.set('streamerName', { fixed: text }) : config.clear('streamerName'); } }),
        h(InlineRow, { key: 'streamerAvatar', label: '主播头像' },
            h(Popover, { label: '选择主播头像', className: 'fork-dm-host-pick', float: true, fit: true,
                trigger: ({ toggle, open }) => h('button', { type: 'button', className: 'fork-inline-trigger fork-dm-host-trigger', 'aria-haspopup': 'menu', 'aria-expanded': open, disabled,
                    'aria-label': '主播头像：' + label, onClick: toggle }, current, h('span', { className: 'fork-inline-text' }, label), h(InlineGlyph, { name: 'chevDown' })),
                content: close => [
                    h(MenuItem, { key: 'none', onClick: () => { close(); setRef(null); } }, h('span', { className: 'ap-avatar fork-dm-host-face fork-dm-host-none', 'aria-hidden': true }), '默认'),
                    ...rows.map(row => h(MenuItem, { key: row.ref.packId + '/' + row.ref.figureId, onClick: () => { close(); setRef(row.ref); } }, face(row), row.figure.name)),
                    hasImageField ? h('label', { key: 'upload', className: 'ap-menu-item fork-dm-host-upload' }, '上传图片…',
                        h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', className: 'ap-sr-only', onChange: event => { const file = event.target.files?.[0]; event.target.value = ''; close(); upload(file); } })) : null] })),
        !cardLayer && config.cardId ? h(HintLine, { key: 'scope', compact: true, text: '主播名称和头像只在本卡设置' }) : null
    ];
}

// MOD_CONFIG_PAGES['dsh.danmaku'] on the one mod page pattern (mod-page.js; ModDetail draws the head with the
// (?) and the global switch): 设置 — the model (chosen here, its one place) and the call cadence — then the
// shared `entries` (观众群 with their lamps, the built-in groups first: rule 15). The view is on the stage corner, 飘屏
// appearance and density in the stage CONFIG.
// Registered below in the host's MOD_CONFIG_PAGES (mod-config-pages.js, included before this file).
function DanmakuModPage({ rpc, cardId, cardName, sessionId, manifest, entries, modSettings, ctx }) {
    const h = React.createElement;
    const files = useCfgFiles(rpc, DANMAKU_MOD, cardId);
    const config = useModConfig({ call: rpc, modId: DANMAKU_MOD, cardId, sessionId, cardName, fileUrl: files });
    const section = manifest?.settingsSchema?.sections?.find(row => row.id === 'model-cadence');
    const rateHelp = { ...DANMAKU_RATE_HELP, ...(section?.help ? { maxCallsPerMinute: modText(manifest, section.help) } : {}) };
    const rate = danmakuRateConfig(config, modSettings?.stored);
    const tip = key => rateHelp[key] ? h(Help, { text: rateHelp[key], label: (config.fields.get(key)?.label || key) + ' 说明' }) : undefined;
    const rates = config.data ? DANMAKU_RATE_FIELDS.filter(key => config.fields.has(key)).map(key => h(CfgField, { key, config: rate, fieldKey: key, help: tip(key) }))
        : config.error ? null : h(InlineRow, { label: '弹幕量' }, h(Loading, { shape: 'line' }));
    // 显示密度 / 弹幕来源: the mod's user options; a skin lock shows read-only (CfgField).
    const shown = config.data ? cfgUserKeys(config, ['density', 'aiRatio']).map(key => h(CfgField, { key, config, fieldKey: key,
        help: h(Help, { text: DANMAKU_OPTION_HELP[key], label: (config.fields.get(key)?.label || key) + ' 说明' }) })) : [];
    return h(React.Fragment, null,
        h(ModSettings, { modId: DANMAKU_MOD, config, help: DANMAKU_SETTINGS_HELP.map((text, i) => h('span', { key: i }, text)) },
            cardId ? h(InlineGrid, { label: '直播间', columns: 1, className: 'fork-dm-settings' }, DanmakuRoomRows({ config, ctx })) : null,
            shown.length ? h(InlineGrid, { label: '显示', columns: 1, className: 'fork-dm-settings' }, shown) : null,
            h(InlineGrid, { label: '弹幕量与节奏', columns: 1, className: 'fork-dm-settings fork-dm-rates' }, rates),
            config.error ? config.data ? h(HintLine, { compact: true, text: config.error }) : h(ErrorBox, { error: config.error, reload: config.reload }) : null),
        entries);
}
if (typeof MOD_CONFIG_PAGES === 'object' && MOD_CONFIG_PAGES) MOD_CONFIG_PAGES['dsh.danmaku'] = DanmakuModPage;
