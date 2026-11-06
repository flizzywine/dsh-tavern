// Read-only phone presentation. Paragraph IDs belong to the existing GAL source index.
function phoneModMarker(raw, unit, characters, threads = {}) {
    if (!raw || Object.keys(raw).some(key => !['op', 'contact', 'to', 'thread', 'sender', 'side', 'form'].includes(key)) || raw.op !== 'phone.message'
        || !unit || unit.kind !== 'line' || !['in', 'out'].includes(raw.side) || raw.form !== undefined && !['text', 'voice'].includes(raw.form)) return null;
    // both source speakers and marker contacts resolve before identity comparisons.
    const resolver = typeof figureResolution !== 'undefined' ? figureResolution : require('../../packages/dsh-presentation-protocol/src/figure-resolution.cjs');
    const rows = characters.map(row => ({...row, actorKey:row.alias}));
    if (raw.thread !== undefined) {
        const thread = Object.hasOwn(threads, raw.thread) && threads[raw.thread];
        if (!thread || raw.contact !== undefined || raw.to !== undefined || typeof raw.sender !== 'string') return null;
        const sender = raw.sender === '$player' ? '$player' : resolver.resolveFigureName(rows, raw.sender).actorKey;
        const speaker = unit.alias === '$player' ? '$player' : resolver.resolveFigureName(rows, unit).actorKey;
        if (!sender || sender !== speaker || !thread.participants.includes(sender) || raw.side !== (sender === '$player' ? 'out' : 'in')) return null;
        return {op:'phone.message',thread:raw.thread,sender,side:raw.side,...(raw.form ? {form:raw.form} : {})};
    }
    if (typeof raw.contact !== 'string' || raw.sender !== undefined) return null;
    const contact = resolver.resolveFigureName(rows, raw.contact);
    if (contact.status !== 'resolved' || !contact.row.name?.trim()) return null;
    const speaker = resolver.resolveFigureName(rows, unit);
    if (speaker.status !== 'resolved' || (raw.side === 'in' ? speaker.actorKey !== contact.actorKey : speaker.actorKey === contact.actorKey)) return null;
    let to;
    if (raw.to !== undefined && raw.to !== '$player') {
        const recipient = resolver.resolveFigureName(rows, raw.to);
        if (recipient.status !== 'resolved' || !recipient.row.name?.trim() || recipient.actorKey === speaker.actorKey || raw.side !== 'in') return null;
        to = recipient.actorKey;
    }
    return { op: 'phone.message', contact: contact.actorKey, ...(to ? {to} : {}), side: raw.side, ...(raw.form ? {form:raw.form} : {}) };
}
// New director input names only a destination; source owns the sender, never a bubble side.
function phoneModSourceMarker(raw, unit, characters, threads = {}, playerId = null) {
    if (unit?.kind !== 'line' || (raw.to === undefined) === (raw.thread === undefined)) return null;
    const resolver = typeof figureResolution !== 'undefined' ? figureResolution : require('../../packages/dsh-presentation-protocol/src/figure-resolution.cjs');
    const rows = characters.map(row=>({...row,actorKey:row.alias}));
    const identity = value => {
        if (value === '$player' || value?.alias === '$player') return '$player';
        const found = resolver.resolveFigureName(rows,value);
        return found.status === 'resolved' && found.row.name?.trim() ? found.actorKey === playerId ? '$player' : found.actorKey : null;
    };
    const sender = identity(unit);
    if (!sender) return null;
    if (raw.thread !== undefined) {
        const thread = Object.hasOwn(threads,raw.thread) && threads[raw.thread];
        if (!thread || !thread.participants.some(id=>identity(id) === sender)) return null;
        return {op:'phone.message',thread:raw.thread,sender,side:sender === '$player' ? 'out' : 'in',form:raw.form};
    }
    const recipient = identity(raw.to);
    if (!recipient || recipient === sender) return null;
    return {op:'phone.message',contact:sender === '$player' ? recipient : sender,
        ...(sender !== '$player' && recipient !== '$player' ? {to:recipient} : {}),side:sender === '$player' ? 'out' : 'in',form:raw.form};
}
// These helpers consume canonical marks/threads; identity resolution stays at admission and source projection.
function phoneModDirect(mark, playerId = null) {
    const player = id => id === playerId ? '$player' : id;
    const sender = player(mark.side === 'out' ? '$player' : mark.contact);
    const recipient = player(mark.side === 'out' ? mark.contact : mark.to || '$player');
    const participants = [sender, recipient].sort();
    return {threadId:participants.includes('$player') ? participants.find(id=>id !== '$player') : 'direct:' + JSON.stringify(participants),sender,recipient,participants};
}
function phoneModOwnership(threads, latestMessage = null, playerId = null) {
    const player = id => id === playerId ? '$player' : id;
    const phones = new Map();
    for (const source of threads) {
        if (source.kind !== 'group' && !source.messages?.length && !source.typing) continue;
        const thread = {...source,participants:[...new Map(source.participants.map(person=>[player(person.id),{...person,id:player(person.id)}])).values()]};
        for (const owner of thread.participants) {
            if (!phones.has(owner.id)) phones.set(owner.id,{id:owner.id,name:owner.name,threads:[]});
            const side = message => ({...message,sender:player(message.sender),...(message.recipient ? {recipient:player(message.recipient)} : {}),side:player(message.sender) === owner.id ? 'out' : 'in'});
            phones.get(owner.id).threads.push({...thread,
                name:thread.kind === 'direct' ? thread.participants.find(person=>person.id !== owner.id).name : thread.name,
                messages:(thread.messages || []).map(side),typing:thread.typing ? side(thread.typing) : null});
        }
    }
    const list = [...phones.values()].sort((a,b)=>(b.id === '$player') - (a.id === '$player'));
    const recipient = latestMessage?.recipient ? player(latestMessage.recipient) : null;
    return {phones:list,latestRecipientPhoneId:phones.has(recipient) ? recipient : null};
}
function phoneModProjection(pages, at, record, characters) {
    const empty = { active: false, current: null, messages: [], key: '' };
    // validated pack prefixes have ops and a stable binding, not a legacy key.
    const pack = Boolean(record?.token?.bindingKey);
    const key = pack ? record.token.bindingKey + ':' + record.token.generation : record?.key;
    const ready = pack ? ['partial', 'done'].includes(record.phase) && pages[at]?.para <= record.through : record?.status === 'done';
    if (!ready || typeof key !== 'string' || !key || !Array.isArray(record.entries) || !pages[at]) return empty;
    const marks = new Map();
    for (const entry of record.entries) {
        const ops = pack ? entry?.at <= record.through && entry.ops : entry?.commands;
        for (const raw of Array.isArray(ops) ? ops : []) {
            if (!raw || raw.op !== 'phone.message') continue;
            const unit = pages.find(page => page.para === entry.at);
            const mark = phoneModMarker(raw, unit, characters || []);
            if (marks.has(entry.at) || !mark) marks.set(entry.at, null); else marks.set(entry.at, mark);
        }
    }
    const ordered = [...marks].filter(([, mark]) => mark).sort((a, b) => a[0] - b[0]);
    const groups = [];
    for (const [para, mark] of ordered) {
        let group = groups[groups.length - 1];
        if (!group || group.contact !== mark.contact || pages.some(item => item.para > group.last && item.para < para && item.kind === 'line' && !marks.get(item.para))) {
            group = { first: para, last: para, contact: mark.contact, marks: new Map() }; groups.push(group);
        }
        group.last = para; group.marks.set(para, mark);
    }
    const current = pages[at], group = groups.find(item => current.para >= item.first && current.para <= item.last);
    if (!group) return empty;
    const seen = new Set(), messages = [];
    for (const line of pages.slice(0, at + 1)) {
        const mark = group.marks.get(line.para);
        if (!mark || seen.has(line.para)) continue;
        seen.add(line.para);
        const prior = messages[messages.length - 1];
        const resolver = typeof figureResolution !== 'undefined' ? figureResolution : require('../../packages/dsh-presentation-protocol/src/figure-resolution.cjs');
        const rows = (characters || []).map(row => ({...row, actorKey:row.alias}));
        messages.push({ line, mark, continued: Boolean(prior && resolver.resolveFigureName(rows, prior.line).actorKey === resolver.resolveFigureName(rows, line).actorKey
            && prior.mark.side === mark.side && prior.line.para + 1 === line.para) });
    }
    return { active: true, current: group.marks.get(current.para) || null, messages, contact: group.contact,
        first: group.first, last: group.last, key: key + ':' + group.first + ':' + group.contact };
}
function phoneModSize(screenWidth) { return { screenWidth, width: screenWidth + 14, height: screenWidth * 932 / 430 + 14 }; }
function phoneModPlace({ width, height, size, figures = [], blocked = [], previous }) {
    const w = size.width, h = size.height, padding = 16;
    const valid = r => r && !r.hidden && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
    const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + n * 2, height: r.height + n * 2 });
    const obstacles = [...blocked.filter(valid).map(r => inflate(r, 12)), ...figures.flatMap(f => [valid(f.body) && inflate(f.body, 18), valid(f.head) && inflate(f.head, 24)]).filter(Boolean)];
    const safe = r => r.x >= padding && r.y >= padding && r.x + w <= width - padding + 1e-7 && r.y + h <= height - padding + 1e-7
        && !obstacles.some(b => r.x < b.x + b.width - 1e-7 && r.x + w > b.x + 1e-7 && r.y < b.y + b.height - 1e-7 && r.y + h > b.y + 1e-7);
    const box = (x, y) => ({ x, y, width: w, height: h });
    if (previous && previous.width === w && previous.height === h && safe(previous)) return box(previous.x, previous.y);
    const cx = (width - w) / 2, cy = (height - h) / 2, xs = new Set([cx, padding, width - w - padding]), ys = new Set([cy, padding, height - h - padding]);
    for (const r of obstacles) { xs.add(r.x - w); xs.add(r.x + r.width); ys.add(r.y - h); ys.add(r.y + r.height); }
    const candidates = [];
    for (const x of xs) for (const y of ys) { const r = box(x, y); if (safe(r)) candidates.push(r); }
    candidates.sort((a, b) => ((a.x - cx) ** 2 + (a.y - cy) ** 2) - ((b.x - cx) ** 2 + (b.y - cy) ** 2) || Math.abs(a.y - cy) - Math.abs(b.y - cy) || a.x - b.x);
    return candidates[0] || null;
}
function phoneModLayout({ width, height, figures, blocked, caption, previous, compactPrevious }) {
    const normalWidth = Math.min(280, width - 46, (height - 110 - 14) * 430 / 932);
    if (normalWidth < 200) return null;
    const normal = phoneModSize(normalWidth), place = (size, prior) => phoneModPlace({ width, height, figures, blocked, size, previous: prior });
    let bounds = place(normal, previous);
    if (bounds) return { ...bounds, compact: false };
    if (!caption) return null;
    const attempt = value => { const size = phoneModSize(value), found = place(size, compactPrevious); return found && { ...found, compact: true }; };
    let low = 200, high = Math.min(normalWidth, (caption.y - 28 - 14) * 430 / 932);
    if (high < low) return null;
    bounds = attempt(high); if (bounds) return bounds;
    bounds = attempt(low); if (!bounds) return null;
    for (let i = 0; i < 12 && high - low > .1; i++) { const mid = (low + high) / 2, candidate = attempt(mid); if (candidate) { low = mid; bounds = candidate; } else high = mid; }
    return bounds;
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = { phoneModMarker, phoneModSourceMarker, phoneModDirect, phoneModOwnership, phoneModProjection, phoneModSize, phoneModPlace, phoneModLayout };
