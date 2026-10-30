'use strict';

// canonical reading pages, independent of font, viewport and film cards.
const STAGE_PAGE_CHARS = 130;
function stagePagePlain(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s)\s*/gm, '')
        .replace(/(\*\*|__|~~|`)/g, '')
        .replace(/(^|[^*])\*(?!\s)([^*\n]+)\*/g, '$1$2')
        .replace(/^\s*[-*_]{3,}\s*$/gm, '')
        .trim();
}
const STAGE_SENTENCES = /[^\u3002\uff01\uff1f!?\u2026\n]+[\u3002\uff01\uff1f!?\u2026\u300d\u300f\uff09)\n]*|[^\u3002\uff01\uff1f!?\u2026\n]+$/g;
function stageBlockPages(block, pageVersion = 1) {
    const plain = stagePagePlain(block), pages = [];
    if (!plain) return pages;
    if (plain.length <= STAGE_PAGE_CHARS) return [plain];
    const sentences = plain.match(STAGE_SENTENCES) || [plain];
    let buffer = '';
    for (const sentence of sentences) {
        if (buffer && (buffer + sentence).length > STAGE_PAGE_CHARS) { pages.push(buffer); buffer = ''; }
        buffer += sentence;
    }
    if (buffer.trim()) pages.push(buffer);
    // Version is frozen on the written round; historical page anchors never move.
    if (pageVersion >= 2 && pages.length > 1 && pages.at(-1).trim().length < STAGE_PAGE_CHARS / 3) {
        const tail = pages.pop();
        pages[pages.length - 1] += tail;
    }
    return pages.map(page => page.trim());
}
// the last page of a paragraph that is still streaming may lose its
// unfinished last sentence to a new page (stageBlockPages splits before a sentence that no longer fits) unless that
// sentence opens the page. Returns that movable tail ('' when nothing can move), so the stage does not show it yet.
function stagePageMovableTail(text) {
    const sentences = String(text || '').match(STAGE_SENTENCES) || [];
    const last = sentences[sentences.length - 1];
    return sentences.length > 1 && !/[\u3002\uff01\uff1f!?\u2026\u300d\u300f\uff09)\n]$/.test(last) ? last : '';
}
// The tail of a streaming page the stage holds back on its last text box card: the movable sentence above, else (the
// unfinished sentence opens the page and cannot move to the next page) its unfinished last clause, which may still move
// to the next card - the card then breaks at the clause the box fits, as the same paragraph does from history
//.
function stagePageHeldTail(text) {
    const movable = stagePageMovableTail(text);
    if (movable) return movable;
    const sentences = String(text || '').match(STAGE_SENTENCES) || [], last = sentences[sentences.length - 1] || '';
    if (/[\u3002\uff01\uff1f!?\u2026\u300d\u300f\uff09)\n]$/.test(last)) return '';
    const clause = /[\uff0c\uff1b\uff1a\u3001,;:\s]([^\uff0c\uff1b\uff1a\u3001,;:\s]*)$/.exec(last);
    return clause ? clause[1] : '';
}
// Both raw display units and parsed UI units use this path. Dialogue is always one page;
// only narration is plain/paginated, so names, moods and bubble syntax cannot add pages.
function stagePageCards(unit, paginate = stageBlockPages) {
    if (unit.kind !== 'narration') return [{text: unit.text, offset: 0}];
    const block = unit.block ?? unit.text, plain = stagePagePlain(block);
    let offset = 0;
    return paginate(block, unit.pageVersion).map(text => {
        const start = Math.max(offset, plain.indexOf(text, offset));
        offset = start + text.length;
        return {text, offset: start};
    });
}
function stagePageIndex(displayUnits) {
    const pages = [], firstPageByPara = {};
    for (const [ordinal, unit] of displayUnits.entries()) {
        const para = ordinal + 1;
        for (const card of stagePageCards(unit)) {
            if (!Object.hasOwn(firstPageByPara, para)) firstPageByPara[para] = pages.length;
            pages.push({page: pages.length, para, offset: card.offset});
        }
    }
    return {version: 1, pages, firstPageByPara};
}
function stagePageAtAnchor(index, {para, offset}) {
    if (index?.version !== 1 || !Number.isSafeInteger(para) || !Number.isSafeInteger(offset) || offset < 0) return null;
    let page = null;
    for (const candidate of index.pages) {
        if (candidate.para === para && candidate.offset <= offset) page = candidate.page;
        if (candidate.para > para || candidate.para === para && candidate.offset > offset) break;
    }
    return page;
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {STAGE_PAGE_CHARS, stagePagePlain, stageBlockPages, stagePageMovableTail, stagePageHeldTail, stagePageCards, stagePageIndex, stagePageAtAnchor};
