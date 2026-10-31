'use strict';
function createStageSubtitles({React, document, window, foreground:forkForeground, fonts:tavernFonts, getComputedStyle, ResizeObserver, heldTail:stagePageHeldTail, quote:galQuoted}) {
// Film cards are display-only: offsets count source characters, never director paragraphs.
// An oversized bracketed passage is closed/reopened on each card; a pair that fits is kept whole.
// hold (galHeldCards) = the cards kept from before a streaming page
// changed and the end of its unchanged text. The kept cards stay as they were and the next one is only split at or after
// that end: text the reader may already see is never pulled back onto the next card when a chunk overflows the box.
// CJK line breaking (kinsoku) - a card never opens with closing
// punctuation (。、！？…～ closing brackets/quotes, small kana) and never ends on an opening bracket, so 」！ ?! …… ”。 stay together.
// No card is near-empty: a card that is not the last holds at least a third of what the box fits, and a last card that
// would hold less than a third of a full card makes the text re-split evenly over the same number of cards
// (galEvenCards).
// limit = at most that many cards (the player's input page between rounds shows 3). A
// text that needs more keeps the first limit - 1 cards and ends the last one with 「……」 at a sensible break; the rest
// is not shown (the backlog keeps the whole input).
function galSubtitleCards(text, fits, hold, limit) {
    const noStart = /[、。，．,.：:；;！!？?‼⁇⁈⁉…‥～~〜ー々ゝゞヽヾ・」』）)】〕〉》］\]｝}”’ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ—―]/;
    const noEnd = /[「『（(【〔〈《［\[｛{“‘]/;
    const chars = Array.from(String(text || ""));
    const pairs = { "「": "」", "『": "』", "（": "）", "(": ")", "【": "】", "[": "]", "“": "”", "‘": "’" };
    const stack = [], matched = new Map();
    chars.forEach(function (char, i) {
        if (pairs[char]) stack.push(i);
        else if (stack.length && pairs[chars[stack[stack.length - 1]]] === char) { const open = stack.pop(); matched.set(open, i); }
    });
    const active = [], edges = [[]];
    chars.forEach(function (char, i) {
        if (matched.has(i)) active.push(i);
        else if (active.length && matched.get(active[active.length - 1]) === i) active.pop();
        edges.push(active.slice());
    });
    const cardText = (start, end) => edges[start].map(i => chars[i]).join("") + chars.slice(start, end).join("") + edges[end].slice().reverse().map(i => pairs[chars[i]]).join("");
    // Sentence ends (also behind their closing brackets) outrank clause breaks and closing brackets, which outrank the rest.
    const rank = end => {
        let i = end - 1;
        while (i > 0 && /[」』）)】〕〉》］\]”’]/.test(chars[i])) i--;
        return /[。！？!?…‥～~]/.test(chars[i]) ? 3 : i < end - 1 || /[，；：、,;:\s—―]/.test(chars[i]) ? 2 : 1;
    };
    const kinsoku = i => !noStart.test(chars[i]) && !noEnd.test(chars[i - 1]);
    // Breaks in order of preference: outside brackets and kinsoku-clean, kinsoku-clean inside an oversized bracket, outside brackets.
    const pools = [i => !edges[i].length && kinsoku(i), kinsoku, i => !edges[i].length];
    // The furthest end that fits from a start (fits grows monotonically with the card); even a single glyph makes progress.
    // A start next to a measured one begins from its reach, so walking every start costs about two layouts each.
    const reach = new Map();
    const maxEnd = start => {
        if (reach.has(start)) return reach.get(start);
        const near = reach.get(start - 1);
        let low = start + 1, high = chars.length, max = start;
        if (near !== undefined && near > start) { if (fits(cardText(start, near))) { max = near; low = near + 1; high = Math.min(high, near + 4); if (high < chars.length && fits(cardText(start, high))) { max = high; low = high + 1; high = chars.length; } } else high = near - 1; }
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (fits(cardText(start, mid))) { max = mid; low = mid + 1; } else high = mid - 1;
        }
        reach.set(start, Math.max(start + 1, max));
        return reach.get(start);
    };
    const kept = hold ? hold.cards.slice() : [], from = kept.length ? kept[kept.length - 1].end : 0;
    const best = (ok, low, high) => { let end = 0; for (let i = low; i <= high; i++) if (ok(i) && (!end || rank(i) >= rank(end))) end = i; return end; };
    const floorOf = (start, high) => hold && start === from ? Math.max(start + 1, Math.min(hold.end, high)) : start + 1;
    const split = () => {
        const cards = kept.slice();
        for (let start = from; start < chars.length;) {
            const high = maxEnd(start);
            let end = high;
            if (high < chars.length) {
                const floor = floorOf(start, high);
                const least = Math.max(floor, start + Math.ceil((high - start) / 3));
                // A short card before a bracketed passage only to keep the passage whole, never for one that cannot fit a card anyway.
                end = best(pools[0], least, high);
                if (!end) {
                    const early = best(pools[0], floor, high), open = edges[high][0];
                    // The passage with the punctuation that may not open a card after it (“…”？！).
                    let close = open === undefined ? -1 : matched.get(open);
                    while (close >= 0 && close + 1 < chars.length && noStart.test(chars[close + 1])) close++;
                    const whole = early && (open === undefined || close + 1 - early <= high - start) ? early : 0;
                    end = whole || best(pools[1], least, high) || early || best(pools[1], floor, high) || best(pools[2], least, high) || best(pools[2], floor, high) || high;
                }
            }
            cards.push({ text: cardText(start, end), start, end });
            start = end;
        }
        return cards;
    };
    const greedy = split(), count = greedy.length - kept.length;
    if (!greedy.length) return [{ text: "", start: 0, end: 0 }];
    if (limit && greedy.length > limit) {
        // The 「……」 sits inside any bracket still open at the cut and is measured with the card, so it never overflows.
        const start = greedy[limit - 1].start;
        const cut = end => edges[start].map(i => chars[i]).join("") + chars.slice(start, end).join("").replace(/[\s，、；：,;:。．]+$/, "") + "……" + edges[end].slice().reverse().map(i => pairs[chars[i]]).join("");
        let low = start + 1, high = greedy[limit - 1].end, max = start + 1;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (fits(cut(mid))) { max = mid; low = mid + 1; } else high = mid - 1;
        }
        const least = start + Math.ceil((max - start) * 2 / 3);
        const end = best(pools[0], least, max) || best(pools[1], least, max) || max;
        return greedy.slice(0, limit - 1).concat({ text: cut(end), start, end });
    }
    const length = card => card.end - card.start, last = greedy[greedy.length - 1], prior = greedy[greedy.length - 2];
    if (count < 2 || length(last) * 3 >= maxEnd(prior.start) - prior.start) return greedy;
    // A tiny last card: the same number of cards, as evenly filled as the breaks allow (galEvenCards). Evening out never
    // cuts into a bracketed passage or breaks kinsoku more often than the greedy split did, and never cuts mid-phrase (no
    // punctuation before the break) a text the greedy split broke at punctuation only: a short last card after 「时候，」
    // beats even cards cut at 「宝|石」.
    const level = end => end >= chars.length ? 0 : pools.findIndex(ok => ok(end)) < 0 ? 3 : pools.findIndex(ok => ok(end));
    const even = galEvenCards(from, chars.length, count, maxEnd, floorOf, end => [0, 30, 60, 120][level(end)] + [0, 40, 2, 0][rank(end)]);
    const total = (cards, score) => cards.reduce((n, card) => n + (card.end < chars.length ? score(card.end) : 0), 0);
    const midPhrase = end => rank(end) === 1 ? 1 : 0;
    const worse = (a, b) => total(a, level) > total(b, level) || total(a, midPhrase) > 0 && !total(b, midPhrase);
    if (!even || worse(even, greedy.slice(kept.length))) return greedy;
    return kept.concat(even.map(({ start, end }) => ({ text: cardText(start, end), start, end })));
}
// The split of [from, to) into at most `count` cards that fit (maxEnd) with the least unused room, squared per card so the
// cards come out even, plus each break's penalty (a weaker break, a cut into a bracket). floorOf(start, reach) is the
// earliest end a card from `start` may take (the held cards of a streaming page). -> [{ start, end }] or null.
function galEvenCards(from, to, count, maxEnd, floorOf, penalty) {
    const memo = new Map(), full = maxEnd(from) - from;
    const solve = (start, left) => {
        if (start >= to) return { cost: 0, ends: [] };
        if (!left) return null;
        const key = start * (count + 1) + left;
        if (memo.has(key)) return memo.get(key);
        // A card that reaches the end is measured against a full card (the first one's room), so a short last card costs.
        const reach = maxEnd(start), room = reach >= to ? Math.max(full, reach - start) : reach - start;
        let found = null;
        // As the greedy split: a card that is not the last holds at least a third of what fits.
        for (let end = Math.min(to, Math.max(floorOf(start, reach), start + Math.ceil((reach - start) / 3))); end <= Math.min(reach, to); end++) {
            const rest = end >= to ? { cost: 0, ends: [] } : solve(end, left - 1);
            if (!rest) continue;
            const unused = (room - (end - start)) / room, cost = 100 * unused * unused + (end < to ? penalty(end) : 0) + rest.cost;
            if (!found || cost < found.cost) found = { cost, ends: [end, ...rest.ends] };
        }
        memo.set(key, found);
        return found;
    };
    const result = solve(from, count);
    if (!result) return null;
    let start = from;
    return result.ends.map(end => { const card = { start, end }; start = end; return card; });
}
// The measured cards of a page whose text changed in place (a streaming page grew, or its paragraph's pagination moved the
// unfinished sentence to the next page): every card but the last inside the unchanged prefix, and the end of the text that
// may already be on screen. `shown` (galShownEnd) excludes the held unfinished sentence of a streaming narration page:
// it was never typed, so it may still move to the next card and the card can break at the sentence end the box fits
// (「…少女身」: freezing the split at the chunk boundary cut the paragraph
// mid-sentence at the box's last line, unlike the same paragraph read from history).
function galHeldCards(cards, before, text, shown = Infinity) {
    const a = Array.from(before), b = Array.from(text);
    let end = 0;
    while (end < a.length && end < b.length && a[end] === b[end]) end++;
    end = Math.min(end, Math.max(shown, cards.length > 1 ? cards[cards.length - 2].end : 0));
    const kept = [];
    for (const card of cards.slice(0, -1)) { if (card.end > end) break; kept.push(card); }
    return { cards: kept, end };
}
// The end (in characters) of a page's text that may be on screen: all of it, except the unfinished last sentence of a
// streaming narration page (or the unfinished clause of one that opens it: stagePageHeldTail), which its last card holds
// back (GalStage `movable`).
function galShownEnd(item) {
    const length = Array.from(item.text).length;
    return item.pending && item.kind === "narration" ? length - Array.from(stagePageHeldTail(item.text)).length : length;
}
function galSubtitleStep(page, card, delta, counts) {
    if (delta > 0 && card + 1 < counts[page]) return { page, card: card + 1 };
    if (delta < 0 && card > 0) return { page, card: card - 1 };
    const next = Math.max(0, Math.min(counts.length - 1, page + delta));
    return { page: next, card: next === page ? card : delta < 0 ? counts[next] - 1 : 0 };
}
function galSubtitleVoiceTime(cards, card, duration) {
    const total = cards.reduce((sum, item) => sum + item.end - item.start, 0);
    return total > 0 && Number.isFinite(duration) && duration > 0 ? duration * cards.slice(0, card + 1).reduce((sum, item) => sum + item.end - item.start, 0) / total : null;
}
function galSubtitleCache(limit) {
    const entries = new Map();
    return {
        clear() { entries.clear(); },
        get(text, width, font, size, measure) {
            const key = JSON.stringify([text, width, font, size]);
            if (entries.has(key)) { const value = entries.get(key); entries.delete(key); entries.set(key, value); return value; }
            const value = measure();
            entries.set(key, value);
            while (entries.size > limit) entries.delete(entries.keys().next().value);
            return value;
        }
    };
}
// Display cards fit the actual text box without changing canonical/director page indices.
// lines per card at a percent of the skin's size. A full card keeps the height
// of the skin's own full card: the whole line count whose block is nearest to `lines` lines of the skin's size (a tie
// takes the shorter block), so its margins in the box stay the skin's. A box sized for exactly the skin's lines (classic,
// ADV layouts) never holds more than floor(lines / scale). A box with room of its own (--gal-skin-lines-fit: box, the art
// textbox image) holds the stage's GAL_PAGE_LINES reading lines whatever the skin's own count (art.textbox.lines, which
// is at most that) - no more than `room`, the whole lines the box's text area holds (galBoxRoom).
// So a 3-line display line is never cut over two 2-line cards when the box has room for its 3 lines.
const GAL_PAGE_LINES = 3;
function stageTextLines(lines, percent, room) {
    const full = room === undefined ? lines : Math.max(lines, GAL_PAGE_LINES);
    const scaled = full * 100 / percent, nearest = Math.ceil(scaled - .5 - 1e-6);
    return Math.max(1, Math.min(nearest, room === undefined ? Math.floor(scaled + 1e-6) : room));
}
// The whole lines (lineHeight apart, fontSize glyphs) that fit a box's text area (its content height): the block's outer
// half-leading may hang into the padding, its glyphs stay inside (a centred art column sits 3 lines 1-2 px past its padded
// area at 1920, its glyphs 12 px clear of the box).
function galBoxRoom(content, lineHeight, fontSize) {
    return Math.floor((content + lineHeight - fontSize) / lineHeight + 1e-3);
}
// textScales (CONFIG 文字大小) only re-measures when a value changes; the scale itself is read off the box (--fk-text-scale).
// the stage runs two of these on the
// one text element - the round's pages and the player's input page between rounds - and only the active one measures, so
// neither lays out its text in the other's box (the input page's box is pre-wrap with its own indent) and the one that
// becomes active re-measures before paint. limit caps the cards of each page (galSubtitleCards; the input page: 3).
const GAL_INPUT_CARDS = 3;
// the input page's label rides the box's top
// edge where the skin puts it (theme.css「Between turns」); where that edge is the text's first line (a frameless or
// slanted art box) the text gets room of its own below the label. Measured here, by the pager, so the cards are cut for the
// room left: with a full page's column in place (a centred column starts no higher), the label's overhang past the text top
// becomes top padding on the text (box data-fk-input-room, --fk-input-page / --fk-input-room), which the
// measuring clone carries too. No overhang: nothing is reserved and the skin's column is as before. Layout px (dock scaling).
function galInputLabelRoom(text, page) {
    const box = text.closest(".fork-gal-box"), label = box && box.querySelector(":scope > .fork-gal-transition-label");
    if (!label) return 0;
    box.style.setProperty("--fk-input-page", page + "px");
    box.style.setProperty("--fk-input-room", "0px");
    box.setAttribute("data-fk-input-room", "");
    // The column's top for exactly a full page, whatever cards it shows now (else the top and the room would chase each other).
    const scale = box.getBoundingClientRect().height / box.offsetHeight || 1, height = text.style.height;
    text.style.height = page + "px";
    const over = (label.getBoundingClientRect().bottom - text.getBoundingClientRect().top) / scale;
    text.style.height = height;
    if (over <= 0) { box.removeAttribute("data-fk-input-room"); return 0; }
    const room = Math.ceil(over) + 2;
    box.style.setProperty("--fk-input-room", room + "px");
    return room;
}
function useGalSubtitles(film, pages, page, identity, theme, textScales, active = true, limit = 0) {
    const [element, setElement] = React.useState(null);
    const textRef = React.useCallback(node => setElement(node), []);
    const [layout, setLayout] = React.useState(null);
    const layoutRef = React.useRef(null);
    const [position, setPosition] = React.useState(null);
    const cache = React.useMemo(() => galSubtitleCache(256), []);
    const measureNode = React.useRef(null);
    const texts = JSON.stringify(pages.map(item => item.text));
    const key = identity + ":" + page;
    const current = layout && layout.theme === theme && layout.film === film ? layout : null;
    // a page keeps its last measured cards until the new text is measured
    // (before paint, below); a streaming page that changed keeps the cards of its unchanged text and the rest is one card
    // meanwhile. Falling back to one whole-page card for that render painted the next card's lines into the box (or jumped
    // a later card back to the first and remounted its typewriter) on every chunk.
    const cardsOf = (item, index) => {
        const old = current && current.cards[index], before = current && current.pageTexts[index];
        if (!old || typeof before !== "string") return null;
        if (before === item.text) return old;
        const kept = galHeldCards(old, before, item.text).cards, chars = Array.from(item.text), from = kept.length ? kept[kept.length - 1].end : 0;
        return kept.concat({ text: chars.slice(from).join(""), start: from, end: chars.length });
    };
    // only the current page and its neighbours are measured (navigation needs
    // their card counts). Measuring every page of the turn on each width change (the face gutter toggles it between
    // faced and unfaced pages) thrashed the cache and cost a 0.5–1 s long task per toggle in reading and fast-forward.
    const pageRef = React.useRef(page);
    pageRef.current = page;
    const measureNow = React.useRef(null);
    const all = pages.map((item, index) => cardsOf(item, index) || [{ text: item.text, start: 0, end: Array.from(item.text).length }]);
    const cards = all[page] || [{ text: "", start: 0, end: 0 }];
    const sameText = position && pages[page] && (pages[page].text === position.text || position.pending && pages[page].text.startsWith(position.text));
    const offset = position && position.key === key && sameText ? position.offset : 0;
    const card = Math.max(0, cards.findIndex(item => item.end > offset || item === cards[cards.length - 1]));
    React.useLayoutEffect(function () {
        if (!element) return;
        let scheduled = 0, disposed = false;
        const clone = measureNode.current || (measureNode.current = element.cloneNode(false));
        clone.removeAttribute("id"); clone.removeAttribute("aria-live"); clone.setAttribute("aria-hidden", "true");
        clone.className = element.className;
        Object.assign(clone.style, { position: "fixed", left: "-100000px", top: "0", height: "auto", maxHeight: "none", minHeight: "0", boxSizing: "border-box", visibility: "hidden", overflow: "visible", pointerEvents: "none" });
        // The typing indicator at its full inline width (on the stage it hangs past the line end with a negative margin).
        const typingSlot = document.createElement("span");
        typingSlot.className = "fork-gal-typing";
        typingSlot.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
        typingSlot.style.marginRight = "0";
        function measure() {
            if (disposed || scheduled) return;
            scheduled = forkForeground.requestAnimationFrame(function () { scheduled = 0; run(); });
        }
        function run() {
            if (disposed || !active) return;
            const width = element.clientWidth || element.getBoundingClientRect().width;
            if (!width) return;
            clone.style.width = width + "px";
            element.parentNode.appendChild(clone);
            try {
                const style = getComputedStyle(clone), lineHeight = parseFloat(style.lineHeight);
                // Without the stage stylesheet there is no fixed-height box to paginate.
                if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
                // Match the visible stage: ADV art layouts do not add classic dialogue brackets.
                const skinLayout = element.closest('.fork-gal-stage')?.dataset.fkSkinLayout;
                const quoted = !film && (theme || 'classic') === 'classic' && (!skinLayout || skinLayout === 'box');
                const font = [style.fontFamily, style.fontWeight, style.fontStyle, style.fontStretch, style.letterSpacing, style.lineHeight, style.wordBreak, style.overflowWrap, style.whiteSpace, style.padding, style.boxSizing, quoted].join("|");
                // a skin's art textbox holds up to GAL_PAGE_LINES lines per page, as many
                // whole lines of the CONFIG 文字大小 text as its text area fits (stageTextLines, galBoxRoom).
                const percent = Math.round((parseFloat(style.getPropertyValue("--fk-text-scale")) || 1) * 100), box = style.getPropertyValue("--gal-skin-lines-fit").trim() === "box" ? element.closest(".fork-gal-box") : null;
                // a box whose height follows
                // its lines holds up to its max lines - a fixed room, never its current height (that would chase the cards).
                const fitMax = !film && box ? parseInt(style.getPropertyValue("--art-fit-max"), 10) || 0 : 0, fitMin = parseInt(style.getPropertyValue("--art-fit-min"), 10) || 1;
                const boxStyle = box && getComputedStyle(box), room = box ? fitMax || galBoxRoom(box.clientHeight - parseFloat(boxStyle.paddingTop) - parseFloat(boxStyle.paddingBottom), lineHeight, parseFloat(style.fontSize)) : undefined;
                const lines = film ? 2 : stageTextLines(parseInt(style.getPropertyValue("--gal-skin-lines"), 10) || 3, percent, room), near = index => Math.abs(index - pageRef.current) <= 1;
                const labelRoom = !film && pages.some(item => item.kind === "transition") ? galInputLabelRoom(element, lineHeight * lines) : 0;
                const fits = item => text => {
                    // The real inline typewriter/cursor also occupies the line after a trailing newline.
                    clone.textContent = (quoted && item.kind === 'line' ? galQuoted(text, false) : text) + (/[\r\n]$/.test(text) ? "\u200b" : "");
                    // the last line keeps room for the typing indicator that
                    // follows the last glyph while the page streams; a full third line wrapped it onto a clipped fourth.
                    // Every card reserves it, so a paragraph read live and from history still has the same cards.
                    if (!film) clone.appendChild(typingSlot);
                    // Layout pixels ignore both dock scaling and statement rotation; a rotated AABB distorts height.
                    return clone.offsetHeight <= lineHeight * lines + 0.5;
                };
                // In the same box a page keeps its cards; one whose text changed since (streaming) keeps them as galSubtitleCards' hold.
                const at = JSON.stringify([width, font, lines, labelRoom, style.fontSize, theme || 'classic']), prev = layoutRef.current && layoutRef.current.at === at ? layoutRef.current : null;
                const next = { pageTexts: pages.map(item => item.text), pageShown: pages.map(galShownEnd), at, theme, film, cards: pages.map((item, index) => {
                    if (!near(index)) return null;
                    const before = prev && prev.pageTexts[index], old = prev && prev.cards[index];
                    if (old && before === item.text) return old;
                    const hold = old && typeof before === "string" ? galHeldCards(old, before, item.text, prev.pageShown[index]) : null;
                    if (hold && hold.end > 0) return galSubtitleCards(item.text, fits(item), hold, limit);
                    return cache.get(item.text, width, font + ':' + lines + ':' + labelRoom + ':' + item.kind + ':' + limit, style.fontSize, () => galSubtitleCards(item.text, fits(item), null, limit));
                }) };
                // The fitted box: each card of the current page as its whole lines (min..max) and their block in px.
                const shown = pageRef.current, own = fitMax && pages[shown] && next.cards[shown];
                next.fit = own ? { page: shown, cards: own.map(card => {
                    fits(pages[shown])(card.text);
                    const count = Math.min(fitMax, Math.max(fitMin, Math.ceil((clone.offsetHeight - 0.5) / lineHeight)));
                    return { lines: count, block: Math.round(count * lineHeight * 100) / 100 };
                }) } : null;
                layoutRef.current = next;
                setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
            } finally { clone.remove(); }
        }
        measureNow.current = run;
        // New text is measured before paint (only the changed page costs a text layout; the rest is cached).
        run();
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
        if (observer) observer.observe(element);
        window.addEventListener("resize", measure);
        const stage = element.closest('.fork-gal-stage');
        // A skin, skin mode or layout change on the stage (dispatched from its layout effect, after this one in the same commit)
        // re-measures at once, so the first painted frame already has the cards of the box it paints in.
        stage?.addEventListener('stage-layout', run);
        const unsubscribe = typeof tavernFonts !== "undefined" ? tavernFonts.subscribe(() => Promise.resolve().then(() => { if (!disposed) measure(); })) : null;
        const fonts = typeof document !== "undefined" && document.fonts;
        function fontLoaded() { cache.clear(); layoutRef.current = null; measure(); }
        if (fonts) fonts.addEventListener("loadingdone", fontLoaded);
        return () => { disposed = true; measureNow.current = null; forkForeground.cancelAnimationFrame(scheduled); clone.remove(); if (observer) observer.disconnect(); window.removeEventListener("resize", measure); stage?.removeEventListener('stage-layout', run); if (unsubscribe) unsubscribe(); if (fonts) fonts.removeEventListener("loadingdone", fontLoaded); };
    }, [film, texts, theme, element, textScales, active, limit]);
    // A page turn measures its new neighbourhood before paint (cached pages cost no text layout).
    React.useLayoutEffect(function () { if (measureNow.current) measureNow.current(); }, [page]);
    function select(nextPage, nextCard) {
        const target = all[nextPage] && all[nextPage][nextCard];
        const source = pages[nextPage];
        setPosition({ key: identity + ":" + nextPage, text: source && source.text, pending: source && source.pending, offset: target ? target.start : 0 });
    }
    // The current page's cards are a stand-in until its new text is measured (before paint): nothing counts it as read.
    const provisional = Boolean(current && current.cards[page] && pages[page] && current.pageTexts[page] !== pages[page].text);
    // fit: the shown card's lines and block for a box whose height follows them (null for a box without fit lines). Until a
    // turned-to page is measured (before paint) the box keeps the block it shows: dropping it for that render let the
    // measurement's forced style start the height's ease from the unfitted body - a one-line box sprang a line taller
    // and shrank back on every page turn.
    const shownFit = React.useRef(null);
    if (!current || !current.fit) shownFit.current = null;
    else if (current.fit.page === page && current.fit.cards[card]) shownFit.current = current.fit.cards[card];
    const fit = shownFit.current;
    return { textRef, cards, card, text: cards[card].text, counts: all.map(items => items.length), select, provisional, fit };
}

return {useSubtitles:useGalSubtitles, step:galSubtitleStep, voiceTime:galSubtitleVoiceTime, inputCards:GAL_INPUT_CARDS, cards:galSubtitleCards, heldCards:galHeldCards};
}
if (typeof module !== "undefined" && typeof window === "undefined") module.exports = {createStageSubtitles};
