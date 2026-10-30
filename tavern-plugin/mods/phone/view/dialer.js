'use strict';
// the phone's 电话 app, laid out as the
// iOS 26 Phone app (measured from the owner's iPhone): an inline 17 pt title and a floating
// tab bar with the two tabs that work here - 通话 (the host's call log, already cut to this branch and story position,
// newest first, no section label) and 通讯录 (every contact on the player's phone in the directory's order). No keypad, no
// search, no 编辑 / filter: we have no numbers and the list is the story's.
// As iOS 26 (phone-ios-r4, the owner's 通讯录具体条目 / 通话履历 screenshots): a 通话 row or a 通讯录 row opens that contact's
// card - her photo over the phone's wallpaper (style.css .poster), the name, round glyph-only actions (owner 「应该只有图标」) and a 通话记录 card
// with the call (the row's, else the latest); 通话记录 › lists every call with her, newest first (呼出通话, its length, when).
// The round handset on a 通话 row calls back; the card's handset calls. Who cannot be called now stays listed with one plain
// reason and her card's handset is dimmed. Every call starts through the page's one call path (`onCall`).
// A call's words live here: a call
// row with words opens its 通话内容 - who spoke and when into the call, then the words as the subtitles show them (owner 「不要
// 显示配音语言，只显示原文」: her Japanese voice's own words are never shown). Messages and 履历 never show calls.
// `contacts`: the phone source's contacts ({id,name,avatar?}); `call`: the stage call state (threads, available, voices,
// logFailed); `own`: the player's own phone is on screen (calls are only made from it).
function phoneModDialer({app, face, photo, nameOf, onCall, onVideo, onRetry, threadOf, onMessage}) {
    const root = app.querySelector('#dialer'), detailBody = app.querySelector('#call-detail-body'), historyBody = app.querySelector('#call-history-body'), transcriptBody = app.querySelector('#call-transcript-body');
    const tabBar = app.querySelector('#dial-tabs'), title = app.querySelector('#dial-title');
    const pages = {root:app.querySelector('#phone-root'), detail:app.querySelector('#call-detail'), history:app.querySelector('#call-history'), transcript:app.querySelector('#call-transcript')};
    const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
    const clock = seconds => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    const HANDSET = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.2 2.8 8 6.6c.2.5.1 1-.3 1.4L6.5 9.3c.9 1.9 2.3 3.3 4.2 4.2l1.3-1.2c.4-.4.9-.5 1.4-.3l3.8 1.8c.5.2.8.8.6 1.4l-.6 2.2c-.2.6-.7 1-1.3 1C8.6 18.2 1.8 11.4 1.6 4.1c0-.6.4-1.1 1-1.3l2.2-.6c.6-.2 1.2.1 1.4.6z"/></svg>';
    const BUBBLE = '<svg viewBox="0 0 60 60" aria-hidden="true"><ellipse cx="30" cy="28.4" rx="21.2" ry="17.4"/><path d="M15.6 40.2c.5 2.9-.7 5.6-3.4 7.3 4.6.3 8.8-1 11.9-3.4z"/></svg>';
    // iOS 26's FaceTime glyph (the camcorder of the contact card's 视频 key and a FaceTime row's call back).
    const CAMERA = '<svg viewBox="0 0 29 19" aria-hidden="true"><rect width="19.4" height="19" rx="4.2"/><path d="M21.2 7.1 27.3 2.9c.7-.5 1.7 0 1.7.9v11.4c0 .9-1 1.4-1.7.9l-6.1-4.2z"/></svg>';
    const OUTGOING = '<svg class="dial-arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 9 9 3M4.2 3H9v4.8"/></svg>';
    const CHEV = '<span class="chev" aria-hidden="true"><svg viewBox="0 0 8 13"><path d="M1.5 1.5 6.5 6.5l-5 5"/></svg></span>';
    const TABS = {recents:'通话', contacts:'通讯录'};
    // Real time of the call (startedAt), as iOS writes it: today the time, then 昨天, the weekday within a week, else the date.
    const midnight = at => { const day = new Date(at); day.setHours(0, 0, 0, 0); return day.getTime(); };
    const daysAgo = at => Math.round((midnight(Date.now()) - midnight(at)) / 864e5);
    const timeOf = at => { const day = new Date(at); return day.getHours() + ':' + String(day.getMinutes()).padStart(2, '0'); };
    function shortWhen(at) {
        const ago = daysAgo(at), day = new Date(at);
        if (ago <= 0) return timeOf(at);
        if (ago === 1) return '昨天';
        if (ago < 7) return '星期' + '日一二三四五六'[day.getDay()];
        return day.getFullYear() + '/' + (day.getMonth() + 1) + '/' + day.getDate();
    }
    // The card's and the history's 「今日·17:37」: the day (今天 / 昨天 / weekday / date) and the time.
    function longWhen(at) {
        const ago = daysAgo(at);
        return (ago <= 0 ? '今天' : ago === 1 ? '昨天' : shortWhen(at)) + '·' + timeOf(at);
    }
    const dayOf = at => { const ago = daysAgo(at); return ago <= 0 ? '今天' : ago === 1 ? '昨天' : shortWhen(at); };
    const secondsOf = row => row.endedAt ? Math.max(0, Math.round((row.endedAt - row.startedAt) / 1000)) : 0;
    const lengthOf = seconds => seconds < 60 ? seconds + '秒' : Math.floor(seconds / 60) + '分' + (seconds % 60 ? seconds % 60 + '秒' : '钟');
    // `chosen`: the tab the reader picked; until then 通话 when there are calls, else 通讯录 (where a first call is made).
    // `stack`: the pages pushed over the list, e.g. ['detail', 'history', 'transcript']; whose pages they are, the call on her card
    // (the 通话 row's, else her latest) and the call whose words are open.
    let input = {}, stack = [], shownContact = null, cardCall = null, wordsCall = null, chosen = null, entry = null;
    const page = () => stack.at(-1) || 'root';
    const reasonOf = id => input.call?.voices?.[id] === false ? '没有配音' : input.call?.available ? '' : '语音识别未就绪';
    // FaceTime needs what a call needs, a phone that declares its call view, and someone the stage can show.
    const videoable = id => Boolean(input.video && !reasonOf(id) && input.call?.videos?.[id] !== false);
    function model({contacts, call, own}) {
        if (!own) return {state:'elsewhere'};
        if (call?.logFailed) return {state:'error'};
        if (!Array.isArray(contacts) || !call?.voices) return {state:'loading'};
        if (!contacts.length) return {state:'empty'};
        const known = new Map(contacts.map(row => [row.id, row]));
        const recents = Object.entries(call.threads || {}).filter(([id]) => known.has(id))
            .flatMap(([id, rows]) => rows.map(row => ({key:'call:' + row.id, id:row.id, contact:known.get(id), at:row.startedAt, reason:reasonOf(id), meta:shortWhen(row.startedAt), video:row.video === true})))
            .sort((a, b) => b.at - a.at).slice(0, 20);
        return {state:'ready', recents, contacts:contacts.map(row => ({key:'contact:' + row.id, contact:row, reason:reasonOf(row.id)}))};
    }
    const tabOf = view => chosen || (view.recents?.length ? 'recents' : 'contacts');
    // 通讯录 (iOS 26 Contacts): face and name; the row opens her card. Who cannot be called keeps one plain grey reason.
    function contactRow(item) {
        const button = make('button', 'dial-row dial-contact'), name = nameOf(item.contact), holder = make('span', 'owner-face'), text = make('span', 'dial-text');
        button.type = 'button'; button.dataset.key = item.key; button.dataset.contactId = item.contact.id; button.dataset.callable = String(!item.reason);
        holder.append(face(item.contact, 36));
        text.append(make('span', 'dial-name', name));
        if (item.reason) text.append(make('span', 'dial-reason', item.reason));
        button.append(holder, text);
        button.setAttribute('aria-label', [name, item.reason].filter(Boolean).join('，'));
        button.onclick = () => show('detail', {contact:item.contact.id, call:null});
        return button;
    }
    // A recent call (iOS 26 Recents): face, name, ↗ 语音通话, when; the row opens her card on this call, the round handset calls back.
    function recentRow(item) {
        const row = make('div', 'dial-row dial-recent'), main = make('button', 'dial-main'), name = nameOf(item.contact), holder = make('span', 'owner-face'), text = make('span', 'dial-text');
        const kind = make('span', 'dial-kind');
        row.dataset.key = item.key; row.dataset.contactId = item.contact.id; row.dataset.callId = item.id;
        main.type = 'button'; main.dataset.key = item.key;
        holder.append(face(item.contact, 45));
        // A call that turned into FaceTime reads 「FaceTime 视频」 (its length stays in the record, never on the video).
        const label = item.video ? 'FaceTime 视频' : '语音通话';
        kind.innerHTML = OUTGOING; kind.append(label);
        text.append(make('span', 'dial-name', name), kind);
        main.append(holder, text, make('span', 'dial-meta', item.meta));
        main.setAttribute('aria-label', [name, label, item.meta, '详细信息'].join('，'));
        main.onclick = () => show('detail', {contact:item.contact.id, call:item.id});
        row.append(main);
        if (!item.reason) {
            // A FaceTime row calls back on FaceTime (iOS calls back the way the call was made).
            const video = item.video && videoable(item.contact.id), label = (video ? 'FaceTime 呼叫' : '呼叫') + name;
            const back = make('button', 'dial-call'); back.type = 'button'; back.dataset.key = 'dial:' + item.id; back.innerHTML = video ? CAMERA : HANDSET;
            if (video) back.dataset.video = 'true';
            back.setAttribute('aria-label', label); back.title = label;
            back.onclick = () => video ? onVideo(item.contact) : onCall(item.contact);
            row.append(back);
        }
        return row;
    }
    function list(items, paint, label) { const box = make('div', 'dial-list'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', label); box.append(...items.map(paint)); return box; }
    // Her contact row and her calls (newest first), read afresh from the latest input.
    const contactOf = id => input.contacts?.find(person => person.id === id) || null;
    const callsOf = id => [...(input.call?.threads?.[id] || [])].sort((a, b) => b.startedAt - a.startedAt);
    // One call as iOS's card and history write it: 呼出通话 over its length, the day and time on the right. A call with words
    // opens its 通话内容 (our calls have them; iOS has nothing to open), shown by a chevron.
    function callLine(row, contact, from) {
        const seconds = secondsOf(row), words = Boolean(row.lines?.length), line = make(words ? 'button' : 'div', 'call-line-row'), left = make('span', 'call-line-text');
        line.dataset.callId = row.id;
        left.append(make('span', 'call-line-kind', '呼出通话'));
        if (seconds) left.append(make('span', 'call-line-length', lengthOf(seconds)));
        line.append(left, make('span', 'call-line-when', longWhen(row.startedAt)));
        if (words) {
            line.type = 'button'; line.dataset.key = 'transcript:' + row.id; line.insertAdjacentHTML('beforeend', CHEV);
            line.setAttribute('aria-label', ['呼出通话', seconds ? lengthOf(seconds) : '', longWhen(row.startedAt), '通话内容'].filter(Boolean).join('，'));
            line.onclick = () => show('transcript', {contact:contact.id, call:row.id}, from);
        }
        return line;
    }
    function renderDetail(contact) {
        const name = nameOf(contact), reason = reasonOf(contact.id), calls = callsOf(contact.id), shown = calls.find(row => row.id === cardCall) || calls[0];
        const card = make('div', 'call-card'), holder = make('span', 'owner-face'), actions = make('div', 'call-actions');
        holder.append(face(contact, 200));
        // iOS 26 contact card actions: round glass keys with the glyph only; the name is for the screen reader and the tooltip.
        const action = (key, glyph, label, enabled, run) => {
            const button = make('button', 'call-action'); button.type = 'button'; button.dataset.key = key; button.innerHTML = glyph;
            button.setAttribute('aria-label', label); button.title = label;
            if (enabled) button.onclick = run; else button.disabled = true;
            return button;
        };
        const thread = threadOf(contact.id);
        actions.append(action('message', BUBBLE, '信息', Boolean(thread), () => onMessage(thread)), action('call', HANDSET, reason ? '语音通话（' + reason + '）' : '语音通话', !reason, () => onCall(contact)));
        // iOS 26's card has 视频 beside 通话: a FaceTime call from the first ring.
        if (input.video) actions.append(action('video', CAMERA, videoable(contact.id) ? 'FaceTime 视频' : 'FaceTime 视频（' + (reason || '无法显示对方') + '）', videoable(contact.id), () => onVideo(contact)));
        card.append(holder, make('h2', 'call-card-name', name), actions);
        const nodes = [card];
        if (shown) {
            const log = make('div', 'group call-log'), open = make('button', 'pref-main');
            open.type = 'button'; open.dataset.key = 'history';
            open.append(make('span', 'pref-label', '通话记录')); open.insertAdjacentHTML('beforeend', CHEV);
            open.onclick = () => show('history', {contact:contact.id});
            log.append(open, callLine(shown, contact, 'detail'));
            nodes.push(log);
        }
        detailBody.replaceChildren(...nodes);
    }
    function renderHistory(contact) {
        const box = make('div', 'group call-history'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', '通话记录');
        box.append(...callsOf(contact.id).map(row => callLine(row, contact, 'history')));
        app.querySelector('#history-name').textContent = nameOf(contact);
        historyBody.replaceChildren(box);
    }
    function renderTranscript(contact, row) {
        const name = nameOf(contact), seconds = secondsOf(row);
        app.querySelector('#transcript-name').textContent = name;
        const head = make('header', 'transcript-head');
        head.append(make('span', '', [dayOf(row.startedAt) + ' ' + timeOf(row.startedAt), seconds ? lengthOf(seconds) : ''].filter(Boolean).join(' · ')));
        const words = make('div', 'group transcript'); words.tabIndex = 0; words.setAttribute('aria-label', '通话内容');
        for (const line of row.lines || []) {
            const turn = make('section', 'said'), who = make('p', 'said-who');
            turn.dataset.role = line.role;
            who.append(make('span', 'said-name', line.role === 'player' ? '我' : name));
            if (Number.isFinite(line.at)) who.append(make('time', 'said-at', clock(Math.max(0, Math.round((line.at - row.startedAt) / 1000)))));
            // Her words as the subtitles showed them (`sub`), never the voice's own language; a line cut off before its first
            // sentence closed has no subtitle yet and keeps only the …
            turn.append(who, make('p', 'said-text', (line.role === 'player' ? line.text : line.sub || '') + (line.interrupted ? '…' : '')));
            words.append(turn);
        }
        transcriptBody.replaceChildren(head, words);
    }
    const backOf = name => app.querySelector(name === 'detail' ? '#call-detail-back' : name === 'history' ? '#call-history-back' : '#call-transcript-back');
    const focusTarget = () => page() === 'root' ? root.querySelector('button') || tabBar.querySelector('[aria-selected="true"]') : backOf(page());
    // Push a page (`from`: the page it is pushed over; the transcript comes from the card or from the history).
    function show(next, {contact, call}, from = page()) {
        shownContact = contact;
        if (next === 'detail') cardCall = call;
        if (next === 'transcript') wordsCall = call;
        const at = stack.indexOf(from);
        stack = next === 'root' ? [] : [...stack.slice(0, at + 1), next];
        paintPages();
        pages[page()].querySelector('.scroll').scrollTop = 0;
        focusTarget()?.focus({preventScroll:true});
    }
    function pop() {
        stack = stack.slice(0, -1);
        if (!stack.length) {
            shownContact = cardCall = wordsCall = null;
            if (entry) { const {onBack} = entry; entry = null; paintPages(); onBack(); return; }
        }
        paintPages();
        focusTarget()?.focus({preventScroll:true});
    }
    let shownPages = '';
    function paintPages() {
        const contact = shownContact ? contactOf(shownContact) : null, calls = contact ? callsOf(contact.id) : [];
        const row = calls.find(item => item.id === wordsCall) || null;
        // Her card is gone (another branch, another phone) or the call is (an earlier story position): back to the list.
        if (stack.length && (!contact || !input.own)) { stack = []; shownContact = cardCall = wordsCall = null; }
        if (page() === 'transcript' && !row) stack = stack.slice(0, -1);
        app.dataset.page = page();
        // Each pushed page lies on the one under it (slid 28 % left, hidden), the rest wait off the right edge.
        for (const [name, node] of Object.entries(pages)) {
            const at = name === 'root' ? 0 : stack.indexOf(name) + 1, top = stack.length;
            const pos = name !== 'root' && !at ? 'off' : at === top ? 'on' : 'under';
            if (node.dataset.pos !== pos) node.dataset.pos = pos;
        }
        const tab = TABS[tabOf(model(input))] || '通话', labels = {detail:entry ? entry.label : '返回' + tab, history:'返回' + (contact ? nameOf(contact) : ''), transcript:'返回' + (stack.at(-2) === 'history' ? '通话记录' : contact ? nameOf(contact) : '')};
        for (const [name, label] of Object.entries(labels)) { const back = backOf(name); if (back.getAttribute('aria-label') !== label) { back.setAttribute('aria-label', label); back.title = label; } }
        const key = JSON.stringify([stack, cardCall, wordsCall, contact ? [nameOf(contact), contact.avatar || '', contact.avatarPending === true, photo(contact) || '', Boolean(threadOf(contact.id)), reasonOf(contact.id), videoable(contact.id)] : null, calls, calls.length ? daysAgo(calls[0].startedAt) : null]);
        if (key === shownPages) return;
        shownPages = key;
        if (stack.includes('detail')) renderDetail(contact);
        if (stack.includes('history')) renderHistory(contact);
        if (page() === 'transcript') renderTranscript(contact, row);
    }
    backOf('detail').onclick = backOf('history').onclick = backOf('transcript').onclick = () => pop();
    // The tab bar: a tab list (←/→ move between the two), the picked tab tinted as iOS.
    const tabs = [...tabBar.querySelectorAll('[role="tab"]')];
    for (const tab of tabs) {
        tab.onclick = () => { chosen = tab.dataset.tab; shown = ''; paintRoot(); app.querySelector('#phone-root .scroll').scrollTop = 0; tab.focus({preventScroll:true}); };
        tab.onkeydown = event => {
            const step = {ArrowRight:1, ArrowLeft:-1}[event.key];
            if (!step) return;
            event.preventDefault(); tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length].click();
        };
    }
    let shown = '';
    function paintRoot() {
        const view = model(input), tab = tabOf(view), key = JSON.stringify([view, tab, input.video === true, input.call?.videos || null, view.state === 'ready' ? [...view.recents, ...view.contacts].map(item => [nameOf(item.contact), item.contact.avatar || '', item.contact.avatarPending === true]) : null]);
        if (key === shown) return;
        shown = key;
        const focused = root.contains(document.activeElement) ? document.activeElement.dataset.key : null, nodes = [];
        const ready = view.state === 'ready';
        title.textContent = ready ? TABS[tab] : '电话';
        tabBar.hidden = !ready; app.dataset.tab = ready ? tab : '';
        for (const button of tabs) { const on = button.dataset.tab === tab; button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1; }
        if (ready && tab === 'recents') nodes.push(view.recents.length ? list(view.recents, recentRow, '通话') : make('p', 'dial-empty', '没有最近通话'));
        else if (ready) nodes.push(list(view.contacts, contactRow, '通讯录'));
        else if (view.state === 'loading') {
            const line = make('p', 'prefs-status is-loading dial-status'); line.setAttribute('role', 'status');
            line.append(make('i', 'spin'), make('span', '', '正在载入…')); nodes.push(line);
        } else if (view.state === 'error') {
            const line = make('p', 'prefs-status dial-status'), again = make('button', 'link', '重试'); line.setAttribute('role', 'status');
            again.type = 'button'; again.dataset.key = 'retry'; again.onclick = onRetry;
            line.append('⚠ 没能读取通讯录。', again); nodes.push(line);
        } else nodes.push(make('p', 'dial-empty', view.state === 'empty' ? '还没有联系人' : '只能用自己的手机打电话'));
        root.replaceChildren(...nodes);
        if (focused) root.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    }
    return {
        render(next) { input = next; paintRoot(); paintPages(); },
        /** Messages enters the same card stack, with its thread as the return destination. */
        openContact(id, origin) { entry = origin; show('detail', {contact:id, call:null}, 'root'); },
        /** The control to focus on the page on screen (the first row on the list, ‹ on a pushed page). */
        first: focusTarget,
        /** Focus for the page on screen when the app opens. */
        focus: () => focusTarget()?.focus({preventScroll:true}),
        /** Esc / ‹: one page back; false on the list (the app itself goes home). */
        back() { if (!stack.length) return false; pop(); return true; },
        /** Back to the list, without focus (the phone was put away, or the story took it to Messages). */
        reset() { entry = null; if (stack.length) { stack = []; shownContact = cardCall = wordsCall = null; paintPages(); } },
        /** The scroll box on screen (the open phone owns the wheel). */
        scroller: () => pages[page()].querySelector('.scroll'),
    };
}
