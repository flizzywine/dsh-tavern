// DOM projection of the scene look. Each applier owns only the styles and attributes it writes.
function createStageLookUi({React}) {
    const frameVars = new Set(['--look-vig', '--look-vig-color', '--look-haze', '--look-haze-color', '--look-grain']);
    const appliers = new Set();
    let disposed = false;
    function create() {
        let dead = false, rootNode = null, paintNode = null, matrixNode = null;
        const writes = new Map();
        const fmt = value => Math.round(value * 1000) / 1000;
        const rgb = value => value.map(v => Math.round(v * 255)).join(' ');
        function write(node, name, value, style = false) {
            if (!node) return;
            let entries = writes.get(node);
            if (!entries) { entries = new Map(); writes.set(node, entries); }
            const key = (style ? 'style:' : 'attr:') + name;
            const get = () => style ? node.style.getPropertyValue(name) : node.getAttribute(name);
            const set = (next, priority = '') => {
                if (style) { if (next) node.style.setProperty(name, next, priority); else node.style.removeProperty(name); }
                else if (next === null) node.removeAttribute(name); else node.setAttribute(name, next);
            };
            let record = entries.get(key);
            if (!record) {
                record = {before:get(), priority:style ? node.style.getPropertyPriority(name) : '', value:undefined, get, set,
                    currentPriority:() => style ? node.style.getPropertyPriority(name) : ''};
                entries.set(key, record);
            }
            if (record.value === value) return;
            record.value = value; set(value);
        }
        function restore(node) {
            const entries = writes.get(node);
            if (!entries) return;
            writes.delete(node);
            for (const record of entries.values()) {
                if (record.get() === record.value && record.currentPriority() === '') record.set(record.before, record.priority);
            }
        }
        function clear() { for (const node of [...writes.keys()]) restore(node); }
        const api = {
            apply(root, frame) {
                if (dead || disposed) return;
                if (root !== rootNode) { clear(); rootNode = root; paintNode = matrixNode = null; }
                if (!root) return;
                appliers.add(api);
                const nextMatrix = root.querySelector('.fork-gal-look-defs feColorMatrix');
                if (matrixNode !== nextMatrix) { restore(matrixNode); matrixNode = nextMatrix; }
                const matrix = frame?.matrix ? frame.matrix.map(fmt).join(' ') : '';
                if (matrix) write(matrixNode, 'values', matrix);
                else restore(matrixNode);
                write(root, 'data-look-ui', matrix ? '' : null);
                const nextPaint = root.querySelector('.fork-gal-frame');
                if (paintNode !== nextPaint) { restore(paintNode); paintNode = nextPaint; }
                const vars = frame ? {
                    '--look-shake-x':fmt(frame.shake.x) + 'px', '--look-shake-y':fmt(frame.shake.y) + 'px',
                    '--look-vig':String(fmt(frame.vignette.alpha)), '--look-vig-color':rgb(frame.vignette.color),
                    '--look-haze':String(fmt(frame.haze.alpha)), '--look-haze-color':rgb(frame.haze.color), '--look-grain':String(fmt(frame.grain))
                } : {'--look-shake-x':'0px', '--look-shake-y':'0px', '--look-vig':'0', '--look-vig-color':'0 0 0', '--look-haze':'0', '--look-haze-color':'255 255 255', '--look-grain':'0'};
                for (const [name, value] of Object.entries(vars)) write(frameVars.has(name) ? paintNode : root, name, value, true);
                write(root, 'data-look-grain', frame && frame.grain > 0.01 ? '' : null);
            },
            dispose() { if (dead) return; dead = true; appliers.delete(api); clear(); rootNode = paintNode = matrixNode = null; }
        };
        return api;
    }
    function useApply(rootRef) {
        const slot = React.useRef(null);
        React.useLayoutEffect(() => {
            const api = create(); slot.current = api;
            return () => { if (slot.current === api) slot.current = null; api.dispose(); };
        }, []);
        return React.useCallback(frame => slot.current?.apply(rootRef.current, frame), [rootRef]);
    }
    return {create, useApply, dispose() {
        if (disposed) return; disposed = true;
        const errors = [];
        for (const api of [...appliers]) try { api.dispose(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Look UI cleanup failed');
    }};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageLookUi};
