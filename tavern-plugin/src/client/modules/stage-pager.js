// 分页 (features/stage-pager.js): a page's line that does not fit the text box is shown as cards, each as much as the box
// holds, read one after the other before the page turns. Cards are display only: a page (its index, its voice, its one-shots,
// the backlog) stays one page.
//
// stagePagerCards(text, fits) -> [{ text, start, end }] (start / end in characters of `text`); fits(cardText) says whether a
// card's text fits the box (it grows monotonically with the text).
// An oversized bracketed passage is closed / reopened on each card; a pair that fits is kept whole. CJK line breaking
// (kinsoku): a card never opens with closing punctuation (。、！？…～ closing brackets / quotes, small kana) and never ends on an
// opening bracket, so 」！ ?! …… ”。 stay together. No card is near-empty: a card that is not the last holds at least a third of
// what the box fits, and a last card that would hold less than a third of a full card makes the text re-split evenly over the
// same number of cards (stageEvenCards).
function stagePagerCards(text, fits) {
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
	const best = (ok, low, high) => { let end = 0; for (let i = low; i <= high; i++) if (ok(i) && (!end || rank(i) >= rank(end))) end = i; return end; };
	const greedy = [];
	for (let start = 0; start < chars.length;) {
		const high = maxEnd(start);
		let end = high;
		if (high < chars.length) {
			const floor = start + 1, least = Math.max(floor, start + Math.ceil((high - start) / 3));
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
		greedy.push({ text: cardText(start, end), start, end });
		start = end;
	}
	if (!greedy.length) return [{ text: "", start: 0, end: 0 }];
	const length = card => card.end - card.start, last = greedy[greedy.length - 1], prior = greedy[greedy.length - 2];
	if (greedy.length < 2 || length(last) * 3 >= maxEnd(prior.start) - prior.start) return greedy;
	// A tiny last card: the same number of cards, as evenly filled as the breaks allow. Evening out never cuts into a bracketed
	// passage or breaks kinsoku more often than the greedy split did, and never cuts mid-phrase (no punctuation before the
	// break) a text the greedy split broke at punctuation only: a short last card after 「时候，」 beats even cards cut mid-word.
	const level = end => end >= chars.length ? 0 : pools.findIndex(ok => ok(end)) < 0 ? 3 : pools.findIndex(ok => ok(end));
	const even = stageEvenCards(chars.length, greedy.length, maxEnd, end => [0, 30, 60, 120][level(end)] + [0, 40, 2, 0][rank(end)]);
	const total = (cards, score) => cards.reduce((n, card) => n + (card.end < chars.length ? score(card.end) : 0), 0);
	const midPhrase = end => rank(end) === 1 ? 1 : 0;
	const worse = (a, b) => total(a, level) > total(b, level) || total(a, midPhrase) > 0 && !total(b, midPhrase);
	if (!even || worse(even, greedy)) return greedy;
	return even.map(({ start, end }) => ({ text: cardText(start, end), start, end }));
}
// The split of [0, to) into at most `count` cards that fit (maxEnd) with the least unused room, squared per card so the cards
// come out even, plus each break's penalty (a weaker break, a cut into a bracket). -> [{ start, end }] or null.
function stageEvenCards(to, count, maxEnd, penalty) {
	const memo = new Map(), full = maxEnd(0);
	const solve = (start, left) => {
		if (start >= to) return { cost: 0, ends: [] };
		if (!left) return null;
		const key = start * (count + 1) + left;
		if (memo.has(key)) return memo.get(key);
		// A card that reaches the end is measured against a full card (the first one's room), so a short last card costs.
		const reach = maxEnd(start), room = reach >= to ? Math.max(full, reach - start) : reach - start;
		let found = null;
		// As the greedy split: a card that is not the last holds at least a third of what fits.
		for (let end = Math.min(to, Math.max(start + 1, start + Math.ceil((reach - start) / 3))); end <= Math.min(reach, to); end++) {
			const rest = end >= to ? { cost: 0, ends: [] } : solve(end, left - 1);
			if (!rest) continue;
			const unused = (room - (end - start)) / room, cost = 100 * unused * unused + (end < to ? penalty(end) : 0) + rest.cost;
			if (!found || cost < found.cost) found = { cost, ends: [end, ...rest.ends] };
		}
		memo.set(key, found);
		return found;
	};
	const result = solve(0, count);
	if (!result) return null;
	let start = 0;
	return result.ends.map(end => { const card = { start, end }; start = end; return card; });
}

// A card of a page holds at most STAGE_PAGE_LINES lines, fewer when the text box has room for fewer (a phone's box):
// stageBoxRoom = the whole lines (lineHeight apart, fontSize glyphs) a text area of `content` px holds; the block's outer
// half-leading may hang into the padding, its glyphs stay inside.
const STAGE_PAGE_LINES = 3;
function stageBoxRoom(content, lineHeight, fontSize) {
	return Math.max(1, Math.floor((content + lineHeight - fontSize) / lineHeight + 1e-3));
}
// The card shown at a character offset into its page: the one that holds it, or the last (an offset past the end: the page's
// last card, where a step back from the next page or a skip lands).
function stageCardAt(cards, offset) {
	return Math.max(0, cards.findIndex(item => item.end > offset || item === cards[cards.length - 1]));
}
// The share of the page's voice heard by the end of card `card`: auto paging turns a voiced page's cards at it.
function stageCardVoiceShare(cards, card) {
	const total = cards.reduce((sum, item) => sum + item.end - item.start, 0);
	return total > 0 ? cards.slice(0, card + 1).reduce((sum, item) => sum + item.end - item.start, 0) / total : 1;
}
