// 自动排版（外观 → 正文排版）：模型经常把一整轮正文写成一整块——句子之间只有软换行，
// 甚至一个换行都没有；CommonMark 把软换行当空格，整块就挤成一大段，看着没有层次。
// 这里在渲染前把正文按句子重新分段：短段保持原样，超过句数上限的长段断开；
// 代码块、表格、列表、标题、引用、链接定义和台词行（@…）一律原样通过。
// 只改显示：存档里的正文、模型请求和导出内容都保持模型原文。
const TAVERN_PROSE_DEFAULTS = Object.freeze({ paragraphs: true, sentences: 2, indent: false });
const TAVERN_PROSE_SENTENCE_RANGE = Object.freeze([1, 4]);
// 短于这个字数的段落不再拆：一两句话的旁白挤不到一起，拆了反而碎。
const TAVERN_PROSE_MIN_CHARS = 40;
const TAVERN_PROSE_CACHE_LIMIT = 48;
const TAVERN_PROSE_FENCE = /^[ \t]*(`{3,}|~{3,})/;
const TAVERN_PROSE_TERMINAL = /[。！？!?…；;：:.”’"」』）)\]]$/;
const TAVERN_PROSE_ASCII_TAIL = /[A-Za-z0-9.,;:!?)\]"']$/;
const TAVERN_PROSE_ASCII_HEAD = /^[A-Za-z0-9(]/;

function normalizeTavernProseLayout(value) {
    const source = value && typeof value === "object" ? value : {};
    const raw = source.sentences;
    const count = Math.round(Number(raw));
    const sentences = raw === undefined || raw === null || raw === "" || !Number.isFinite(count)
        ? TAVERN_PROSE_DEFAULTS.sentences
        : Math.min(TAVERN_PROSE_SENTENCE_RANGE[1], Math.max(TAVERN_PROSE_SENTENCE_RANGE[0], count));
    return { paragraphs: source.paragraphs !== false, indent: source.indent === true, sentences: sentences };
}

// 当前生效的排版选项。外观页改了就换掉这个值，正文按新设置重画。
let tavernProseLayout = TAVERN_PROSE_DEFAULTS;
const tavernProseCache = new Map();

function setTavernProseLayout(value) {
    tavernProseLayout = normalizeTavernProseLayout(value);
    tavernProseCache.clear();
    return tavernProseLayout;
}

function tavernProseLayoutSettings() {
    return tavernProseLayout;
}

// 这些行是 Markdown 的块结构，按行原样保留，不参与分段。
function tavernProseIsRawLine(line) {
    const trimmed = line.trim();
    if (trimmed === "") return true;
    if (/^[ \t]{4}/.test(line)) return true;
    if (/^(?:#{1,6}\s|>|\||<[/!a-zA-Z]|@|!\[)/.test(trimmed)) return true;
    if (/^(?:[-*+]\s|\d+[.)]\s)/.test(trimmed)) return true;
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return true;
    if (/^\[[^\]]+\]:/.test(trimmed)) return true;
    return false;
}

function tavernProseEndsSentence(value) {
    return TAVERN_PROSE_TERMINAL.test(value.trim());
}

// 中文句子直接相接；两边都是英文/数字时补一个空格，免得把词粘在一起。
function tavernProseLink(head, tail) {
    return TAVERN_PROSE_ASCII_TAIL.test(head) && TAVERN_PROSE_ASCII_HEAD.test(tail) ? head + " " + tail : head + tail;
}

function tavernProseBalanced(value) {
    const count = function (re) { return (value.match(re) || []).length; };
    if (count(/\*\*/g) % 2) return false;
    if ((value.split("*").length - 1 - count(/\*\*/g) * 2) % 2) return false;
    if (count(/`/g) % 2) return false;
    if (count(/「/g) !== count(/」/g)) return false;
    if (count(/“/g) !== count(/”/g)) return false;
    if (count(/《/g) !== count(/》/g)) return false;
    if (count(/（/g) !== count(/）/g)) return false;
    return true;
}

function splitTavernProseSentences(text) {
    const pieces = [];
    const ender = /[。！？!?…]+[”’"」』）)\]]*|[.](?=\s|$)/g;
    let start = 0, match;
    while ((match = ender.exec(text)) !== null) {
        const end = match.index + match[0].length;
        const piece = text.slice(start, end).trim();
        if (piece) pieces.push(piece);
        start = end;
    }
    const tail = text.slice(start).trim();
    if (tail) pieces.push(tail);
    // 句号切在 Markdown 强调、引号或括号中间时，把它们并回上一句，别切出半截标记。
    const merged = [];
    pieces.forEach(function (piece) {
        const last = merged.length - 1;
        if (last >= 0 && !tavernProseBalanced(merged[last])) merged[last] = merged[last] + piece;
        else merged.push(piece);
    });
    return merged;
}

function splitTavernProseChunks(pieces, size) {
    const chunks = [];
    for (let index = 0; index < pieces.length; index += size) {
        let chunk = pieces[index];
        for (let next = index + 1; next < Math.min(index + size, pieces.length); next += 1) chunk = tavernProseLink(chunk, pieces[next]);
        chunks.push(chunk);
    }
    return chunks;
}

// 一段连续的散文：先把软换行按句子归并成段落，再把过长的段落按句数上限拆开。
function layoutTavernProseRun(text, sentences) {
    const paragraphs = [];
    let current = "";
    text.split("\n").forEach(function (line) {
        const piece = line.replace(/[ \t]+$/, "").trim();
        if (piece === "") return;
        if (current === "") { current = piece; return; }
        if (tavernProseEndsSentence(current)) { paragraphs.push(current); current = piece; return; }
        current = tavernProseLink(current, piece);
    });
    if (current !== "") paragraphs.push(current);
    return paragraphs.map(function (paragraph) {
        if (paragraph.length <= TAVERN_PROSE_MIN_CHARS) return paragraph;
        const pieces = splitTavernProseSentences(paragraph);
        if (pieces.length <= sentences) return paragraph;
        return splitTavernProseChunks(pieces, sentences).join("\n\n");
    }).filter(Boolean).join("\n\n");
}

function layoutTavernProseText(text, options) {
    const value = typeof text === "string" ? text : String(text === undefined || text === null ? "" : text);
    const settings = options ? normalizeTavernProseLayout(options) : tavernProseLayout;
    if (settings.paragraphs !== true || value.trim() === "") return value;
    const key = settings.sentences + "\u0000" + value;
    const cached = tavernProseCache.get(key);
    if (cached !== undefined) return cached;
    const out = [];
    let run = [], fence = "";
    function flush() {
        if (!run.length) return;
        out.push(layoutTavernProseRun(run.join("\n"), settings.sentences));
        run = [];
    }
    value.split("\n").forEach(function (line) {
        if (fence) {
            out.push(line);
            const close = TAVERN_PROSE_FENCE.exec(line);
            if (close && close[1][0] === fence[0] && close[1].length >= fence.length && line.trim() === close[1]) fence = "";
            return;
        }
        const open = TAVERN_PROSE_FENCE.exec(line);
        if (open) { flush(); fence = open[1]; out.push(line); return; }
        if (tavernProseIsRawLine(line)) { flush(); out.push(line); return; }
        run.push(line);
    });
    flush();
    const laid = out.join("\n");
    if (tavernProseCache.size >= TAVERN_PROSE_CACHE_LIMIT) tavernProseCache.delete(tavernProseCache.keys().next().value);
    tavernProseCache.set(key, laid);
    return laid;
}

// 外观页改完排版，已经画出来的正文要按新设置重画（MarkdownText 只认文本）。
function useTavernProseLayoutRevision() {
    const [revision, setRevision] = React.useState(0);
    React.useEffect(function () {
        function onChange() { setRevision(function (value) { return value + 1; }); }
        window.addEventListener("dsh-tavern-prose-layout", onChange);
        return function () { window.removeEventListener("dsh-tavern-prose-layout", onChange); };
    }, []);
    return revision;
}
