// Presentation only: keep host-owned error nodes and append-only history intact.
const turnErrorControlOwners = new WeakMap();
function turnErrorRowTurn(row) {
    const direct = row.getAttribute('data-chat-turn');
    if (direct && /^\d+$/.test(direct)) return Number(direct);
    const match = /(\d+)$/.exec(row.getAttribute('data-chat-flow-key') || '');
    return match ? Number(match[1]) : NaN;
}
function setTurnErrorClass(element, name, on) {
    const names = String(element.className || '').split(/\s+/).filter(item => item && item !== name);
    if (on) names.push(name);
    const next = names.join(' ');
    if (element.className !== next) element.className = next;
}
function createTurnErrorControls(root, options) {
    turnErrorControlOwners.get(root)?.dispose();
    let disposed = false;
    const key = 'dsh-tavern-hidden-errors:' + options.sessionId;
    let hidden = new Set();
    try {
        const stored = JSON.parse(options.storage.getItem(key) || '[]');
        if (Array.isArray(stored)) hidden = new Set(stored.filter(value => typeof value === 'string'));
    } catch (_) {}
    if (Array.isArray(options.hiddenTurns)) hidden = new Set(options.hiddenTurns.map(String));
    const owned = new Map();
    // Cleared or superseded failures fold by default; revealing one is a local glance.
    const stale = new Set((options.staleTurns || []).map(String));
    const revealed = new Set();
    // A retry loop leaves one cleared failure per attempt, and the host never drops
    // those rows. Stacking them as one summary line keeps a long chat readable while
    // the raw errors stay one click away; removing them persists like a shake.
    let expanded = false;
    let summary = null;
    function rowKey(row) { return row.getAttribute('data-chat-turn') || row.getAttribute('data-chat-flow-key'); }
    function folded(id) { return stale.has(id) && !revealed.has(id) && !hidden.has(id); }
    function save() {
        try { options.storage.setItem(key, JSON.stringify([...hidden])); } catch (_) {}
    }
    function remove(row, entry) {
        if (row.style.display === 'none') row.style.display = entry.display;
        entry.panel.remove();
    }
    function createSummary() {
        const panel = root.ownerDocument.createElement('div');
        panel.className = 'dsh-tavern-error-summary';
        const label = root.ownerDocument.createElement('span');
        const toggle = root.ownerDocument.createElement('button');
        const discard = root.ownerDocument.createElement('button');
        toggle.type = discard.type = 'button';
        toggle.className = 'dsh-tavern-error-summary-toggle';
        discard.className = 'dsh-tavern-error-summary-discard';
        discard.title = '从对话里移除这些已清除的失败提示，正文和历史不受影响';
        panel.append(label, toggle, discard);
        const entry = { panel, label, toggle, discard, keys: [], turns: [] };
        toggle.onclick = function () {
            if (disposed) return;
            expanded = !expanded;
            apply();
        };
        discard.onclick = function () {
            if (disposed || discard.disabled) return;
            const keys = entry.keys.slice();
            const turns = entry.turns.slice();
            function commit() {
                if (disposed) return;
                for (const id of keys) hidden.add(id);
                save();
                apply();
            }
            if (typeof options.onRemoveStale !== 'function' || !turns.length) { commit(); return; }
            discard.disabled = true;
            return Promise.resolve().then(function () { return options.onRemoveStale(turns); })
                .then(commit, function (error) { if (options.onError) options.onError(error); })
                .finally(function () { discard.disabled = false; });
        };
        return entry;
    }
    function updateSummary(staleRows) {
        if (staleRows.length < 2) {
            if (summary) summary.panel.hidden = true;
            return;
        }
        if (!summary) summary = createSummary();
        const keys = staleRows.map(rowKey);
        const turns = staleRows.map(turnErrorRowTurn).filter(turn => Number.isSafeInteger(turn));
        summary.keys = keys;
        summary.turns = turns;
        const text = '共 ' + staleRows.length + ' 轮失败已清除' + (expanded ? '' : '，错误已收起');
        if (summary.label.textContent !== text) summary.label.textContent = text;
        const toggleText = expanded ? '收起' : '查看错误';
        if (summary.toggle.textContent !== toggleText) summary.toggle.textContent = toggleText;
        if (summary.discard.textContent !== '全部移除') summary.discard.textContent = '全部移除';
        summary.panel.hidden = false;
        const anchor = owned.get(staleRows[staleRows.length - 1]);
        if (anchor && anchor.panel.nextSibling !== summary.panel) anchor.panel.insertAdjacentElement('afterend', summary.panel);
    }
    function apply() {
        if (disposed) return;
        const rows = new Set(root.querySelectorAll('[data-chat-flow-kind="turn-error"]'));
        for (const [row, entry] of owned) if (!rows.has(row)) { remove(row, entry); owned.delete(row); }
        const staleRows = [];
        for (const row of rows) {
            const id = rowKey(row);
            // The superseded-turn projection hides some rows itself; a summary may
            // only count the notices a player can actually open.
            if (id && !row.hidden && stale.has(id) && !hidden.has(id)) staleRows.push(row);
        }
        if (staleRows.length < 2) expanded = false;
        const stacked = staleRows.length > 1 && !expanded;
        for (const row of rows) {
            const id = rowKey(row);
            if (!id) continue;
            let entry = owned.get(row);
            if (!entry) {
                if (row.hidden) continue;
                const panel = root.ownerDocument.createElement('div');
                panel.className = 'dsh-tavern-error-controls';
                const label = root.ownerDocument.createElement('span');
                const replay = root.ownerDocument.createElement('button');
                const details = root.ownerDocument.createElement('button');
                const toggle = root.ownerDocument.createElement('button');
                const withdraw = root.ownerDocument.createElement('button');
                const rewind = root.ownerDocument.createElement('button');
                replay.className = 'dsh-tavern-error-replay';
                withdraw.className = 'dsh-tavern-error-withdraw';
                rewind.className = 'dsh-tavern-error-rewind';
                details.className = toggle.className = 'dsh-tavern-error-quiet';
                replay.type = details.type = toggle.type = withdraw.type = rewind.type = 'button';
                // Appended last: hosts and smoke checks address the first two
                // controls positionally, and the tail actions are tail-only.
                panel.append(label, details, toggle, replay, withdraw, rewind);
                entry = { panel, label, replay, withdraw, rewind, details, toggle, display: row.style.display, expanded: false };
                owned.set(row, entry);
                details.onclick = function () { entry.expanded = !entry.expanded; apply(); };
                // One click removes the interrupted reply and replays the same
                // request, so the provider reuses the cached prompt prefix.
                replay.onclick = function () {
                    if (disposed || replay.disabled || typeof options.onReplay !== 'function') return;
                    replay.disabled = true;
                    return Promise.resolve().then(function () { return options.onReplay(turnErrorRowTurn(row)); })
                        .catch(function (error) { if (options.onError) options.onError(error); })
                        .finally(function () { replay.disabled = false; });
                };
                // A moderation stop repeats for the same request, so the tail also
                // offers to take the input back or to drop the round before it.
                for (const [button, action] of [[withdraw, 'onWithdraw'], [rewind, 'onRewind']]) button.onclick = function () {
                    if (disposed || button.disabled || typeof options[action] !== 'function') return;
                    button.disabled = true;
                    return Promise.resolve().then(function () { return options[action](turnErrorRowTurn(row)); })
                        .catch(function (error) { if (options.onError) options.onError(error); })
                        .finally(function () { button.disabled = false; });
                };
                toggle.onclick = function () {
                    if (disposed) return;
                    if (stale.has(id) && !expanded && folded(id)) { revealed.add(id); apply(); return; }
                    const dismiss = !hidden.has(id);
                    function commit() {
                        if (disposed) return;
                        if (dismiss) hidden.add(id); else { hidden.delete(id); revealed.add(id); }
                        save(); apply();
                    }
                    if (!options.onToggle) { commit(); return; }
                    if (toggle.disabled) return;
                    toggle.disabled = true;
                    return Promise.resolve().then(function () { return options.onToggle(Number(id), dismiss); })
                        .then(commit, function (error) { if (options.onError) options.onError(error); })
                        .finally(function () { toggle.disabled = false; });
                };
                row.insertAdjacentElement('afterend', panel);
            }
            const text = row.textContent || '';
            const long = text.length > 1000;
            const cleared = stale.has(id);
            const foldedNow = cleared && !expanded && folded(id);
            const dismissed = hidden.has(id) || foldedNow;
            if (options.onVisible && !row.hidden && !dismissed && !root.ownerDocument.hidden && root.getClientRects().length && Number.isSafeInteger(turnErrorRowTurn(row))) {
                options.onVisible?.(turnErrorRowTurn(row));
            }
            const conceal = dismissed || (long && !entry.expanded);
            const display = conceal ? 'none' : entry.display;
            // Superseded-turn projection owns `hidden`; keep its errors hidden.
            if (!row.hidden && row.style.display !== display) row.style.display = display;
            // A cleared failure that was removed or stacked away takes no row of its
            // own: the summary line (or the restore action) stands in for it.
            entry.panel.hidden = row.hidden || (cleared && hidden.has(id)) || (cleared && stacked);
            // Replaying is only meaningful for the failure still owning the tail.
            const replayable = typeof options.onReplay === 'function' &&
                Number.isSafeInteger(Number(options.replayTurn)) &&
                turnErrorRowTurn(row) === Number(options.replayTurn);
            const refusal = tavernProviderRefusalNotice(text);
            const streak = Number(options.filteredStreak) || 0;
            const moderated = replayable && refusal !== '' && !dismissed;
            const repeated = moderated && streak >= 2 && options.canRewind === true;
            const notice = !moderated ? refusal : repeated
                ? '已连续 ' + streak + ' 次被模型服务商的内容审核拦截，多半是前面的剧情触发了审核，换输入或重发都会继续被拦。建议回退上一轮，或编辑上一轮正文后再继续。'
                : '模型服务商的内容审核拦截了这一轮回复，这不是酒馆故障。原样重新生成通常还会被拦截；可以撤回这条输入，修改后再发送。';
            const summaryText = foldedNow ? '这一轮的失败已清除，错误已收起' : dismissed ? '错误提示已隐藏' : notice || (long
                ? (/message content cannot be empty/i.test(text) ? '模型接口错误：消息内容不能为空。' : '模型接口调用失败，已收起过长的错误信息。') : '');
            if (entry.label.textContent !== summaryText) entry.label.textContent = summaryText;
            if (entry.details.hidden !== (dismissed || !long)) entry.details.hidden = dismissed || !long;
            const detailText = entry.expanded ? '收起详情' : '显示原始错误';
            if (entry.details.textContent !== detailText) entry.details.textContent = detailText;
            const toggleText = foldedNow ? '查看错误' : dismissed ? '恢复错误提示' : '隐藏此错误';
            if (entry.toggle.textContent !== toggleText) entry.toggle.textContent = toggleText;
            if (entry.replay.hidden !== !replayable) entry.replay.hidden = !replayable;
            setTurnErrorClass(entry.replay, 'is-secondary', moderated);
            const canWithdraw = moderated && typeof options.onWithdraw === 'function';
            const canRewind = moderated && typeof options.onRewind === 'function' && options.canRewind === true;
            if (entry.withdraw.hidden !== !canWithdraw) entry.withdraw.hidden = !canWithdraw;
            if (entry.rewind.hidden !== !canRewind) entry.rewind.hidden = !canRewind;
            setTurnErrorClass(entry.withdraw, 'is-primary', canWithdraw && !repeated);
            setTurnErrorClass(entry.rewind, 'is-primary', canRewind && repeated);
            if (entry.withdraw.textContent !== '撤回这条输入') entry.withdraw.textContent = '撤回这条输入';
            if (entry.withdraw.title !== '清除这次失败，把原输入放回输入框') entry.withdraw.title = '清除这次失败，把原输入放回输入框';
            if (entry.rewind.textContent !== '回退上一轮') entry.rewind.textContent = '回退上一轮';
            if (entry.rewind.title !== '清除这次失败，并回退上一轮已保存的剧情') entry.rewind.title = '清除这次失败，并回退上一轮已保存的剧情';
            const replayText = '重新生成本轮';
            if (entry.replay.textContent !== replayText) entry.replay.textContent = replayText;
            const replayTitle = '移除被中断的回复，并原样重发本轮请求（复用模型缓存）';
            if (entry.replay.title !== replayTitle) entry.replay.title = replayTitle;
        }
        updateSummary(staleRows);
    }
    const controls = { apply, dispose() {
        if (disposed) return;
        disposed = true;
        for (const [row, entry] of owned) remove(row, entry);
        owned.clear();
        if (summary) { summary.panel.remove(); summary = null; }
        if (turnErrorControlOwners.get(root) === controls) turnErrorControlOwners.delete(root);
    } };
    turnErrorControlOwners.set(root, controls);
    return controls;
}
