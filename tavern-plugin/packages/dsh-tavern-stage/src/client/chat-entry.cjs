'use strict';
function createStageChatEntry({React, MutationObserver, markdown:TavernColoredMarkdown, enter:navigate, plain:galPlain, blocks:galBlocks, paragraphs:galParagraphs, parse:parseBubbles, schedule, cancel:cancelTimer}) {
let disposed = false;
const galEnter = (...args) => { if (!disposed) return navigate(...args); };
const cleanups = new Set(), timers = new Set();
function setTimeout(fn, delay) {
    if (disposed) return null;
    const timer = schedule(() => { const active = timers.delete(timer); if (active && !disposed) fn(); }, delay);
    timers.add(timer); return timer;
}
function clearTimeout(timer) { timers.delete(timer); cancelTimer(timer); }
function own(cleanup) {
    let active = true;
    const stop = () => { if (!active) return; active = false; cleanups.delete(stop); cleanup(); };
    if (disposed) stop(); else cleanups.add(stop);
    return stop;
}
// Presentation-only turn navigation. No history read here may start a director task.
function galParagraphCount(text) {
    return galParagraphs([{ segments: parseBubbles(String(text || ''), false) }]).length;
}
// Icon-only: the stage glyph is drawn by CSS (theme.css "chat stage entry"), so the button adds no text to the
// paragraph (copying prose never picks up a label); the tooltip and the accessible name carry the words.
function StageEnterHere(props) {
    return React.createElement('button', { type: 'button', className: 'fork-stage-enter-here', 'aria-label': '从这里进入舞台', title: '从这里进入舞台',
        onClick: event => { event.preventDefault(); event.stopPropagation(); galEnter(props.sessionId, { turn: props.turn, para: props.para }); } });
}
// The entry sits at the end of the bubble's last line: the row renders it (props.enter) inside its text block.
// no portal; each portal container installed React's full delegated listener set.
function StageParagraph(props) {
    const timer = React.useRef(null), root = React.useRef(null);
    const [pressed, setPressed] = React.useState(false);
    React.useLayoutEffect(function () {
        if (!root.current) return;
        root.current.querySelectorAll('p, .fork-bubble').forEach(node => {
            node.setAttribute('data-fork-stage-turn', props.turn); node.setAttribute('data-fork-stage-para', props.para);
        });
    }, [props.turn, props.para, props.children]);
    function cancel() { clearTimeout(timer.current); }
    React.useEffect(() => own(cancel), []);
    return React.createElement('div', { ref: root, className: 'fork-stage-paragraph' + (pressed ? ' is-long-pressed' : ''), 'data-fork-stage-turn': props.turn, 'data-fork-stage-para': props.para,
        onPointerDown: event => { if (event.pointerType !== 'mouse') timer.current = setTimeout(() => setPressed(true), 500); }, onPointerUp: cancel, onPointerCancel: cancel, onPointerMove: cancel },
        props.children);
}
// Keep MarkdownText intact (lists, fenced code, references and footnotes may span blank lines).
// Match rendered reading blocks to source paragraph starts, then end each block with a plain entry button.
// no per-block React portal. Every portal container installs React's full set of
// delegated listeners (~131 per block, ~240k on a long chat); the plain buttons share one click handler on the root.
function galParagraphTargets(blocks, texts, base = 0) {
    const normalize = text => galPlain(text).replace(/[^\p{L}\p{N}]/gu, '');
    const sources = blocks.map(normalize), offsets = [];
    let total = 0;
    sources.forEach(text => { offsets.push(total); total += text.length; });
    const source = sources.join('');
    let cursor = 0, previous = 0;
    return texts.map(text => {
        const value = normalize(text), found = value ? source.indexOf(value, cursor) : -1;
        if (found >= 0) {
            previous = offsets.reduce((at, start, i) => start <= found ? i : at, 0);
            cursor = found + value.length;
        } else {
            previous = offsets.reduce((at, start, i) => start <= cursor ? i : at, 0);
            cursor = (offsets[previous] || 0) + (sources[previous] || '').length;
        }
        return base + previous + 1;
    });
}
function stageEntryButton(doc) {
    // Same element StageEnterHere renders: icon-only, the glyph is CSS.
    const button = doc.createElement('button');
    button.type = 'button'; button.className = 'fork-stage-enter-here';
    button.setAttribute('aria-label', '从这里进入舞台'); button.title = '从这里进入舞台';
    return button;
}
function StageMarkdown(props) {
    const root = React.useRef(null), timer = React.useRef(null);
    React.useLayoutEffect(function () {
        const parent = root.current;
        if (!parent) return;
        let active = true;
        const marked = new Map();
        function restore(node, before) {
            for (const [key, value] of Object.entries(before.attributes)) {
                if (value === null) node.removeAttribute(key); else node.setAttribute(key, value);
            }
            node.classList.toggle('fork-stage-paragraph', before.paragraph);
            node.classList.toggle('is-long-pressed', before.pressed);
        }
        function collect() {
            if (disposed || !active) return;
            const blocks = galBlocks(props.text);
            const nodes = Array.from(parent.querySelectorAll('p, h1, h2, h3, h4, h5, h6, pre, li, table, blockquote')).filter(node =>
                !node.closest('button') && !node.querySelector('p, pre, li, table, blockquote'));
            // The entry buttons carry no text, so block text is read as is.
            const paras = galParagraphTargets(blocks, nodes.map(node => node.textContent), props.base);
            const targets = new Set(blocks.length ? nodes : []);
            parent.querySelectorAll('.fork-stage-enter-here').forEach(button => { if (!targets.has(button.parentNode)) button.remove(); });
            for (const [node, before] of marked) if (!targets.has(node)) { restore(node, before); marked.delete(node); }
            if (blocks.length) nodes.forEach((node, i) => {
                if (!marked.has(node)) marked.set(node, {
                    attributes:Object.fromEntries(['data-fork-stage-turn','data-fork-stage-para'].map(key => [key,node.getAttribute(key)])),
                    paragraph:node.classList.contains('fork-stage-paragraph'), pressed:node.classList.contains('is-long-pressed')
                });
                const para = paras[i];
                node.classList.add('fork-stage-paragraph'); node.setAttribute('data-fork-stage-turn', props.turn); node.setAttribute('data-fork-stage-para', para);
                const last = node.lastChild;
                if (last && last.nodeType === 1 && last.classList.contains('fork-stage-enter-here')) return;
                const button = node.querySelector(':scope > .fork-stage-enter-here') || stageEntryButton(node.ownerDocument);
                node.appendChild(button);
            });
        }
        collect();
        const observer = new MutationObserver(mutations => {
            const own = node => node.nodeType === 1 && node.matches('.fork-stage-enter-here');
            if (mutations.every(mutation => mutation.target.closest?.('.fork-stage-enter-here') || mutation.type === 'childList' && [...mutation.addedNodes, ...mutation.removedNodes].every(own))) return;
            collect();
        });
        observer.observe(parent, { childList: true, subtree: true, characterData: true });
        return own(() => {
            active = false; observer.disconnect();
            parent.querySelectorAll('.fork-stage-enter-here').forEach(button => button.remove());
            for (const [node, before] of marked) restore(node, before);
            marked.clear();
        });
    }, [props.text, props.turn, props.base]);
    function cancel() { clearTimeout(timer.current); }
    React.useEffect(() => own(cancel), []);
    // Capture phase: like the former portalled button, the click reaches no Markdown handler in between.
    function enter(event) {
        const button = event.target.closest('.fork-stage-enter-here'), block = button && button.parentNode;
        if (!block || !block.hasAttribute('data-fork-stage-para')) return;
        event.preventDefault(); event.stopPropagation();
        if (disposed) return;
        galEnter(props.sessionId, { turn: props.turn, para: Number(block.getAttribute('data-fork-stage-para')) });
    }
    return React.createElement('div', { ref: root, className: 'fork-stage-markdown', onClickCapture: enter,
        onPointerDown: event => { const node = event.target.closest('[data-fork-stage-para]'); if (node && event.pointerType !== 'mouse') timer.current = setTimeout(() => node.classList.add('is-long-pressed'), 500); },
        onPointerUp: cancel, onPointerMove: cancel, onPointerCancel: cancel },
        React.createElement(TavernColoredMarkdown, props.markdownProps));
}

return {EnterHere:StageEnterHere, Paragraph:StageParagraph, Markdown:StageMarkdown, count:galParagraphCount, targets:galParagraphTargets, dispose() {
    if (disposed) return; disposed = true;
    const errors = [];
    for (const stop of [...cleanups, ...[...timers].map(timer => () => clearTimeout(timer))]) { try {stop();} catch (error) {errors.push(error);} }
    if (errors.length) throw new AggregateError(errors, 'Stage chat entry cleanup failed');
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageChatEntry};
