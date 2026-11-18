// The stage theme stylesheet (themes.css split by lib/theme-parts.js at build): the base parts always, a family's parts
// (a built-in theme other than the default, a pack skin's marks) from the first time one of its marks is in the document.
// MutationObserver callbacks run before the next frame, so a mark never paints without its rules. The sheet keeps the
// source order; families are only added, never removed, while the stage is active.
function createStageThemeSheet({style, theme, document, MutationObserver}) {
    const pending = new Map(Object.entries(theme.marks)), loaded = new Set();
    const render = () => {style.textContent = theme.parts.filter(([family]) => !family || loaded.has(family)).map(([, css]) => css).join('\n');};
    const any = () => [...pending.values()].join(',');
    function scan(nodes) {
        let added = false;
        for (const [family, marks] of pending) {
            if (!nodes.some(node => node.matches?.(marks) || node.querySelector?.(marks))) continue;
            pending.delete(family); loaded.add(family); added = true;
        }
        if (added) render();
        if (!pending.size) observer.disconnect();
    }
    const attributeFilter = [...new Set(Object.values(theme.marks).flatMap(marks => [...marks.matchAll(/\[([\w-]+)/g)].map(match => match[1])))];
    const observer = new MutationObserver(records => {
        const marks = any(), nodes = [];
        for (const record of records) {
            if (record.type === 'attributes') {if (record.target.matches(marks)) nodes.push(record.target);}
            else for (const node of record.addedNodes) if (node.nodeType === 1 && (node.matches(marks) || node.querySelector(marks))) nodes.push(node);
        }
        if (nodes.length) scan(nodes);
    });
    render();
    if (pending.size) {
        observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter});
        scan([document.documentElement]);
    }
    return () => observer.disconnect();
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageThemeSheet};
