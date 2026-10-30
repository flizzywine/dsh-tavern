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
        function collect() {
            const blocks = galBlocks(props.text);
            const nodes = Array.from(parent.querySelectorAll('p, h1, h2, h3, h4, h5, h6, pre, li, table, blockquote')).filter(node =>
                !node.closest('button') && !node.querySelector('p, pre, li, table, blockquote'));
            // The entry buttons carry no text, so block text is read as is.
            const paras = galParagraphTargets(blocks, nodes.map(node => node.textContent), props.base);
            const targets = new Set(blocks.length ? nodes : []);
            parent.querySelectorAll('.fork-stage-enter-here').forEach(button => { if (!targets.has(button.parentNode)) button.remove(); });
            if (blocks.length) nodes.forEach((node, i) => {
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
        return () => observer.disconnect();
    }, [props.text, props.turn, props.base]);
    function cancel() { clearTimeout(timer.current); }
    React.useEffect(() => cancel, []);
    // Capture phase: like the former portalled button, the click reaches no Markdown handler in between.
    function enter(event) {
        const button = event.target.closest('.fork-stage-enter-here'), block = button && button.parentNode;
        if (!block || !block.hasAttribute('data-fork-stage-para')) return;
        event.preventDefault(); event.stopPropagation();
        galEnter(props.sessionId, { turn: props.turn, para: Number(block.getAttribute('data-fork-stage-para')) });
    }
    return React.createElement('div', { ref: root, className: 'fork-stage-markdown', onClickCapture: enter,
        onPointerDown: event => { const node = event.target.closest('[data-fork-stage-para]'); if (node && event.pointerType !== 'mouse') timer.current = setTimeout(() => node.classList.add('is-long-pressed'), 500); },
        onPointerUp: cancel, onPointerMove: cancel, onPointerCancel: cancel },
        React.createElement(TavernColoredMarkdown, props.markdownProps));
}
