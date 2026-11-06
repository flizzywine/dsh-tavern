function findTavernQuoteRanges(text) {
    // Match only complete same-line pairs, including the delimiters.
    const pattern = /"[^"\r\n]+"|“[^”\r\n]+”|«[^»\r\n]+»|「[^」\r\n]+」|『[^』\r\n]+』|＂[^＂\r\n]+＂/g;
    return Array.from(String(text).matchAll(pattern), match => [match.index, match.index + match[0].length]);
}

function installTavernTextColors(root, options, findQuotes) {
    const doc = root.ownerDocument, win = doc.defaultView;
    if (!win.CSS || !win.CSS.highlights || typeof win.Highlight !== 'function') return { refresh() {}, setEnabled() {}, setColors() {}, dispose() {} };
    // Highlight pseudo styles participate in document-wide style resolution.
    // Share a palette per document, not one global stylesheet per message.
    // Keep this registry inside the installer: it is also serialized into iframes.
    const registryKey = Symbol.for('dsh-tavern.text-color-palettes');
    const palettes = doc[registryKey] || (doc[registryKey] = new Map());
    const kinds = ['quote-light', 'quote-dark', 'em-light', 'em-dark'];
    const ranges = new Map(kinds.map(kind => [kind, new Set()]));
    let paletteGroup = null;
    let enabled = options.enabled !== false, disposed = false, timer = null;
    function releasePalette() {
        if (!paletteGroup) return;
        for (const [kind, owned] of ranges) for (const range of owned) paletteGroup.highlights.get(kind).delete(range);
        if (--paletteGroup.users === 0) {
            for (const kind of kinds) win.CSS.highlights.delete(paletteGroup.prefix + '-' + kind);
            paletteGroup.style.remove();
            palettes.delete(paletteGroup.key);
        }
        paletteGroup = null;
    }
    function setColors(overrides) {
        if (disposed) return;
        const colors = ['quote', 'em'].map(kind => {
            const value = overrides && overrides[kind];
            return typeof value === 'string' && win.CSS.supports('color', value) && !/[;{}]/.test(value)
                ? value : 'var(--dsw-alias-brand-primary, currentColor)';
        });
        const key = JSON.stringify(colors);
        if (paletteGroup && paletteGroup.key === key) return;
        releasePalette();
        paletteGroup = palettes.get(key);
        if (!paletteGroup) {
            const prefix = 'dsh-tavern-text-' + Math.random().toString(36).slice(2);
            const style = doc.createElement('style');
            style.setAttribute('data-dsh-tavern-text-colors', '');
            style.textContent = kinds.map(kind => '::highlight(' + prefix + '-' + kind + '){color:' + colors[kind.startsWith('quote') ? 0 : 1] + '}').join('\n');
            const highlights = new Map();
            for (const kind of kinds) {
                const highlight = new win.Highlight();
                highlight.priority = kind.startsWith('quote') ? 2 : 1;
                highlights.set(kind, highlight);
                win.CSS.highlights.set(prefix + '-' + kind, highlight);
            }
            paletteGroup = { key, prefix, style, highlights, users: 0 };
            palettes.set(key, paletteGroup);
            doc.head.appendChild(style);
        }
        paletteGroup.users++;
        for (const [kind, owned] of ranges) for (const range of owned) paletteGroup.highlights.get(kind).add(range);
    }
    function clearRanges() {
        for (const [kind, owned] of ranges) {
            for (const range of owned) paletteGroup.highlights.get(kind).delete(range);
            owned.clear();
        }
    }
    setColors(options.colors);
    const excluded = 'script,style,textarea,input,select,button,a,code,pre,kbd,samp,svg,math,[hidden],[contenteditable]:not([contenteditable="false"]),[role="button"],[role="textbox"]';
    const blocks = 'p,div,li,td,th,blockquote,section,article,h1,h2,h3,h4,h5,h6';
    // A refresh reads the same ancestors for many text nodes. Cache only for this
    // synchronous pass so later theme/card mutations always get fresh styles.
    let computedColors, explicitColors;
    function computedColor(element) {
        if (!computedColors.has(element)) computedColors.set(element, win.getComputedStyle(element).color);
        return computedColors.get(element);
    }
    function explicitColor(element) {
        if (explicitColors.has(element)) return explicitColors.get(element);
        const own = element.hasAttribute('color') || Boolean(element.style.color || element.style.webkitTextFillColor)
            || (element.matches('span,font,q,em,i,b,strong,u,mark') && element.parentElement
                && computedColor(element) !== computedColor(element.parentElement));
        const result = Boolean(own || (element !== root && element.parentElement && explicitColor(element.parentElement)));
        explicitColors.set(element, result);
        return result;
    }
    const paletteCache = new Map();
    let canvas;
    function palette(element) {
        const color = computedColor(element);
        if (paletteCache.has(color)) return paletteCache.get(color);
        let rgb = color.match(/[\d.]+/g) || [];
        if (!/^rgba?\(/.test(color)) {
            // Modern themes may use oklch/display-p3; read their sRGB equivalent.
            if (!canvas) { canvas = doc.createElement('canvas'); canvas.width = canvas.height = 1; }
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (context) { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); rgb = context.getImageData(0, 0, 1, 1).data; }
        }
        const result = Number(rgb[0]) * .2126 + Number(rgb[1]) * .7152 + Number(rgb[2]) * .0722 > 145 ? 'dark' : 'light';
        paletteCache.set(color, result);
        return result;
    }
    function add(kind, entry, start, end) {
        const range = doc.createRange();
        range.setStart(entry.node, start); range.setEnd(entry.node, end);
        // collect only. Changing a shared Highlight invalidates document style, so
        // touching it mid-walk (or between highlighters) made every later getComputedStyle
        // recalc the whole chat; opening a long chat hung the renderer.
        pending.push([kind + '-' + entry.palette, range]);
    }
    let pending = [];
    function apply(batch) {
        clearRanges();
        for (const [key, range] of batch) { ranges.get(key).add(range); paletteGroup.highlights.get(key).add(range); }
    }
    function refresh() { const batch = collect(); if (batch) apply(batch); else if (!disposed) clearRanges(); }
    function collect() {
        if (disposed || !enabled) return null;
        pending = [];
        computedColors = new WeakMap(); explicitColors = new WeakMap();
        const walker = doc.createTreeWalker(root, 4); // SHOW_TEXT; never edit React/card-owned DOM.
        let group = [], block = null, text = '';
        function flush() {
            for (const [start, end] of findQuotes(text)) for (const entry of group) {
                const from = Math.max(start, entry.offset), to = Math.min(end, entry.offset + entry.node.length);
                if (from < to) add('quote', entry, from - entry.offset, to - entry.offset);
            }
            group = []; text = '';
        }
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const element = node.parentElement;
            if (!element || element.closest(excluded) || explicitColor(element)) { flush(); block = null; continue; }
            const owner = element.closest(blocks) || root;
            // <br> is a rendered line break even without a newline text node.
            if (owner !== block || (node.previousSibling && node.previousSibling.nodeName === 'BR')) flush();
            block = owner;
            const entry = { node, offset: text.length, palette: palette(element) };
            group.push(entry); text += node.data;
            if (element.closest('q')) add('quote', entry, 0, node.length);
            else if (element.closest('em,i')) add('em', entry, 0, node.length);
        }
        flush();
        const batch = pending; pending = [];
        return batch;
    }
    // One timer per document: every scheduled highlighter reads styles first, then all apply.
    const queueKey = Symbol.for('dsh-tavern.text-color-queue');
    const self = { collect, apply };
    // only messages near the viewport are scanned. Reading computed colours of every
    // message of a long chat forced style for the whole transcript in one task (~310 ms opening 小圆, more with skipped
    // off-screen turns). A message out of range keeps its last highlights and is rescanned once it comes near (dirty).
    // Only inside the chat's scroller (data-conversation-scroll); elsewhere every message is scanned at once.
    const scroller = root.closest ? root.closest('[data-conversation-scroll]') : null;
    let near = true, dirty = false, nearObserver = null;
    if (scroller && typeof win.IntersectionObserver === 'function') {
        near = false;
        nearObserver = new win.IntersectionObserver(function (entries) {
            const next = entries[entries.length - 1].isIntersecting;
            if (next === near) return;
            near = next;
            if (near && dirty) { dirty = false; schedule(); }
        }, { root: scroller, rootMargin: '1200px 0px' });
        nearObserver.observe(root);
    }
    function unschedule() {
        const queue = doc[queueKey];
        if (timer === null || !queue) { timer = null; return; }
        queue.items.delete(self);
        if (!queue.items.size) { win.clearTimeout(queue.timer); delete doc[queueKey]; }
        timer = null;
    }
    function schedule() {
        if (disposed || !enabled || timer !== null) return;
        if (!near) { dirty = true; return; }
        let queue = doc[queueKey];
        if (!queue) {
            queue = doc[queueKey] = { items: new Map(), timer: null };
            queue.timer = win.setTimeout(function () {
                if (doc[queueKey] === queue) delete doc[queueKey];
                const items = [...queue.items.keys()];
                for (const item of items) item.markRun();
                const batches = items.map(item => item.collect());
                items.forEach((item, index) => { if (batches[index]) item.apply(batches[index]); });
            }, 32);
        }
        queue.items.set(self, true);
        timer = queue.timer;
    }
    self.markRun = function () { timer = null; };
    // Attribute rewrites to the same value (e.g. classList.remove of an absent class) cannot change colours;
    // skipping them keeps unrelated focus/page changes from rescanning every message.
    const observer = new win.MutationObserver(function (records) {
        if (records.some(record => record.type !== 'attributes' || record.oldValue !== record.target.getAttribute(record.attributeName))) schedule();
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class', 'color', 'hidden'] });
    // Upstream theme invalidation, shared across the fork's independent palettes.
    if (!palettes.theme) {
        const themeKey = () => win.getComputedStyle(doc.documentElement).colorScheme + '|' + win.getComputedStyle(doc.body || doc.documentElement).color;
        const theme = palettes.theme = { key: themeKey(), listeners: new Set(), observer: null };
        theme.observer = new win.MutationObserver(function () {
            const key = themeKey();
            if (key === theme.key) return;
            theme.key = key;
            theme.listeners.forEach(listener => listener());
        });
        const attributes = { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme', 'data-ds-theme-source'] };
        theme.observer.observe(doc.documentElement, attributes);
        if (doc.body) theme.observer.observe(doc.body, attributes);
    }
    palettes.theme.listeners.add(schedule);
    // Batch mounts before reading computed styles.
    schedule();
    return {
        // React text replacement collapses live Ranges. Repair them before paint,
        // consuming queued mutations so the same commit is not scanned twice.
        refresh() {
            if (disposed) return;
            unschedule();
            observer.takeRecords();
            if (!near && enabled) { dirty = true; return; }
            refresh();
        },
        setColors,
        setEnabled(value) {
            if (disposed) return;
            enabled = value !== false;
            unschedule();
            if (enabled) schedule();
            else clearRanges();
        },
        dispose() {
            if (disposed) return;
            unschedule(); disposed = true; observer.disconnect(); if (nearObserver) nearObserver.disconnect();
            palettes.theme.listeners.delete(schedule);
            if (!palettes.theme.listeners.size) { palettes.theme.observer.disconnect(); delete palettes.theme; }
            clearRanges(); releasePalette();
            if (!palettes.size) delete doc[registryKey];
        }
    };
}

// Display colors belong to the host theme; legacy per-browser overrides are ignored.
function tavernTextColorsEnabled() { return true; }
function tavernTextColorOverrides(host) {
    const doc = host.document;
    const probe = doc.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--dsw-alias-brand-primary, currentColor)';
    doc.body.appendChild(probe);
    const accent = host.getComputedStyle(probe).color;
    probe.remove();
    return { quote: accent, em: accent };
}
function TavernColoredMarkdown(props) {
    const stageHidden = React.useSyncExternalStore(
        typeof galActive === "undefined" ? () => () => {} : galActive.subscribe,
        () => Boolean(props.stageTranscript && typeof galActive !== "undefined" && galActive.get()));
    const suspend = props.streaming === true || props.suspendTextColors || stageHidden;
    const root = React.useRef(null), colors = React.useRef(null), mounted = React.useRef(false);
    React.useLayoutEffect(function () {
        if (suspend) return undefined;
        colors.current = installTavernTextColors(root.current, { enabled: true }, findTavernQuoteRanges);
        return () => { colors.current.dispose(); colors.current = null; mounted.current = false; };
    }, [suspend]);
    // the full-screen stage occludes chat, but live Highlight Ranges still cost
    // Chromium style/GC work. Release them while hidden; resume through the shared read/write batch.
    React.useLayoutEffect(function () {
        colors.current?.setEnabled(!suspend);
    }, [suspend]);
    React.useLayoutEffect(function () {
        // on mount the installer's batched timer does the first pass. A synchronous
        // pass per message made opening a long chat recalc document style once per message.
        if (!mounted.current) { mounted.current = true; return; }
        colors.current?.refresh();
    }, [props.text, props.streaming]);
    const { suspendTextColors, stageTranscript, ...markdownProps } = props;
    return React.createElement('div', { ref: root, className: 'dsh-tavern-colored-markdown' }, React.createElement(DshUi.MarkdownText, markdownProps));
}
