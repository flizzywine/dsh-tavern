'use strict';
// shared read-only geometry. Consumers never measure in their animation tick.
function createStageRects({root, host = globalThis, document:doc = root.ownerDocument, schedule = fn => host.requestAnimationFrame(fn), cancel = id => host.cancelAnimationFrame(id)}) {
    const selectors = {box:'.fork-gal-box:not(.is-awaiting)',text:'.fork-gal-text',name:'.fork-gal-name',qm:'.fork-gal-controls',side:'.fork-gal-side',choices:'.fork-gal-choices'};
    const widgetSelector = '.fork-widget,.fork-widget-reader,.fork-gal-widget-chip';
    const listeners = new Set();
    let disposed = false, pending = null, snapshot = Object.freeze({revision:0,screen:Object.freeze({x:0,y:0,w:0,h:0}),widgets:Object.freeze([])}), elements = {};
    const observer = host.ResizeObserver ? new host.ResizeObserver(invalidate) : null;
    function bind() {
        observer?.disconnect(); observer?.observe(root);
        elements = Object.fromEntries(Object.entries(selectors).map(([key,selector]) => [key,root.querySelector(selector)]));
        elements.widgets = [...root.querySelectorAll(widgetSelector)];
        for (const element of [...Object.values(elements).filter(value => value && !Array.isArray(value)),...elements.widgets]) observer?.observe(element);
    }
    function measure() {
        pending = null;
        if (disposed) return;
        const outer = root.getBoundingClientRect(), width = root.clientWidth || root.offsetWidth, height = root.clientHeight || root.offsetHeight;
        if (!(outer.width > 0 && outer.height > 0)) return;
        const sx = width/outer.width, sy = height/outer.height;
        const relative = element => {
            if (!element || !element.isConnected || !element.getClientRects().length || element.closest?.('.is-hidden,[hidden]') || host.getComputedStyle?.(element).visibility === 'hidden' || element === elements.side && !element.classList.contains('is-on')) return null;
            const r = element.getBoundingClientRect();
            return {x:(r.left-outer.left)*sx,y:(r.top-outer.top)*sy,w:r.width*sx,h:r.height*sy};
        };
        const next = {revision:snapshot.revision+1,screen:{x:0,y:0,w:width,h:height},...Object.fromEntries(Object.entries(elements).filter(([key]) => key !== 'widgets').map(([key,element]) => [key,relative(element)])),widgets:elements.widgets.map(relative).filter(Boolean),nameText:elements.name?.querySelector('b')?.textContent.replace(/^[\u3010]|[\u3011]$/g,'') || ''};
        if (root.classList.contains('is-film')) {next.box = null; next.name = null;}
        const close = (a,b) => a === null || b === null || !a || !b ? a === b : ['x','y','w','h'].every(key => Math.abs(a[key]-b[key]) <= 1);
        if (snapshot.nameText === next.nameText && Object.keys(selectors).concat('screen').every(key => close(snapshot[key],next[key])) && snapshot.widgets.length === next.widgets.length && snapshot.widgets.every((r,i) => close(r,next.widgets[i]))) return;
        for (const item of Object.values(next)) if (item && typeof item === 'object') {if (Array.isArray(item)) item.forEach(Object.freeze); Object.freeze(item);}
        snapshot = Object.freeze(next); for (const fn of listeners) fn();
    }
    function invalidate() {if (!disposed && pending === null) pending = schedule(measure);}
    // The scene may rewrite paint-only look variables every frame while a vignette/haze/grain eases or pulses
    // (galUiApplier); they never move a box, so a style change that only touches them is not a layout change.
    const paintOnly = /--look-(?:vig|vig-color|haze|haze-color|grain)\s*:[^;]*;?\s*/g;
    const geometric = record => !(record.attributeName === 'style' && (record.oldValue || '').replace(paintOnly, '').trim() === (record.target.getAttribute('style') || '').replace(paintOnly, '').trim());
    const mutations = host.MutationObserver ? new host.MutationObserver(records => {
        let rebind = false, changed = false;
        for (const record of records) {
            if (record.type === 'attributes') changed ||= (record.target === root || Object.values(elements).includes(record.target) || elements.widgets.includes(record.target)) && geometric(record);
            else if(record.type === 'characterData') changed = true;
            else rebind ||= [...record.addedNodes,...record.removedNodes].some(node => node.nodeType === 1 && (Object.values(selectors).some(selector => node.matches?.(selector) || node.querySelector?.(selector)) || node.matches?.(widgetSelector) || node.querySelector?.(widgetSelector)));
        }
        if (rebind) bind(); if (changed || rebind) invalidate();
    }) : null;
    mutations?.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:['class','style','aria-hidden']});
    doc.fonts?.addEventListener('loadingdone',invalidate); host.addEventListener?.('resize',invalidate);
    root.addEventListener('stage-layout',invalidate);
    bind(); invalidate();
    return {getSnapshot:() => snapshot,subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},invalidate,
        dispose() {disposed = true; if (pending !== null) cancel(pending); pending = null; observer?.disconnect(); mutations?.disconnect(); doc.fonts?.removeEventListener('loadingdone',invalidate); host.removeEventListener?.('resize',invalidate); root.removeEventListener('stage-layout',invalidate); listeners.clear();}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined' && module.exports) module.exports = {createStageRects};
