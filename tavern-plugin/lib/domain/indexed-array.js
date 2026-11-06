// Shared by the host and generated iframe. Fixed seven-level radix index over
// JavaScript's 32-bit array indices: no linked overlays and no history-sized copy.
function createIndexedArrayApi(options = {}) {
    const states = new WeakMap();
    const valid = options.valid || (value => value !== undefined);
    const eligible = options.eligible || valid;
    const measure = options.measure || (() => 0);
    const maximum = options.maximum || (() => -Infinity);
    const visit = options.visit || (() => {});
    const width = depth => 2 ** (depth * 5);
    function aggregate(slots) {
        let count = 0, validCount = 0, eligible = 0, bytes = 320, max = -Infinity;
        for (const child of slots) if (child) { count += child.count; validCount += child.validCount; eligible += child.eligible; bytes += child.bytes; max = Math.max(max, child.max); }
        return { slots, count, validCount, eligible, bytes, max };
    }
    function put(node, depth, id, leaf, mutable) {
        visit();
        const slots = node ? (mutable ? node.slots : node.slots.slice()) : [];
        const digit = Math.floor(id / width(depth)) % 32;
        slots[digit] = depth === 0 ? leaf : put(slots[digit], depth - 1, id, leaf, mutable);
        return aggregate(slots);
    }
    function lookup(node, id) {
        for (let depth = 6; depth >= 0; depth--) {
            visit();
            node = node?.slots[Math.floor(id / width(depth)) % 32];
        }
        return node;
    }
    function trim(node, depth, limit) {
        if (!node || limit <= 0) return undefined;
        const span = width(depth);
        if (limit >= span * 32) return node;
        const slots = node.slots.slice(0, Math.ceil(limit / span));
        if (depth > 0 && limit % span) slots[slots.length - 1] = trim(slots[slots.length - 1], depth - 1, limit % span);
        return aggregate(slots);
    }
    function checkLength(length) {
        if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) throw new Error('Invalid indexed array length');
    }
    function view(root, length) {
        function index(key) { return typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length; }
        const array = new Proxy([], {
            get(target, key, receiver) {
                if (key === 'length') return length;
                return index(key) ? lookup(root, Number(key))?.value : Reflect.get(target, key, receiver);
            },
            has(target, key) { return index(key) ? Boolean(lookup(root, Number(key))) : Reflect.has(target, key); },
            ownKeys() {
                const keys = [];
                for (let id = 0; id < length; id++) if (lookup(root, id)) keys.push(String(id));
                return [...keys, 'length'];
            },
            getOwnPropertyDescriptor(target, key) {
                if (index(key)) {
                    const leaf = lookup(root, Number(key));
                    return leaf ? { value: leaf.value, enumerable: true, writable: false, configurable: true } : undefined;
                }
                const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
                return key === 'length' ? { ...descriptor, value: length } : descriptor;
            },
            set() { throw new Error('Indexed array is immutable'); },
            defineProperty() { throw new Error('Indexed array is immutable'); },
            deleteProperty() { throw new Error('Indexed array is immutable'); }
        });
        states.set(array, { root, length });
        return array;
    }
    function leaf(value) { return { value, count: 1, validCount: valid(value) ? 1 : 0, eligible: eligible(value) ? 1 : 0, bytes: 48 + measure(value), max: maximum(value) }; }
    function from(source) {
        if (states.has(source)) return source;
        checkLength(source.length);
        let root;
        for (let id = 0; id < source.length; id++) if (id in source) root = put(root, 6, id, leaf(source[id]), true);
        return view(root, source.length);
    }
    function update(source, entries, length = source.length) {
        checkLength(length);
        const state = states.get(source) || states.get(from(source));
        let root = length < state.length ? trim(state.root, 6, length) : state.root;
        for (const [id, value] of entries) {
            if (!Number.isInteger(id) || id < 0 || id >= length) throw new Error('Invalid indexed array position');
            root = put(root, 6, id, leaf(value), false);
        }
        return view(root, length);
    }
    function previous(source, exclusive) {
        const state = states.get(source);
        if (!state) throw new Error('Unindexed array');
        function search(node, depth, prefix, end) {
            visit();
            if (!node?.eligible) return -1;
            const span = width(depth), top = Math.min(31, Math.floor((end - prefix) / span));
            for (let digit = top; digit >= 0; digit--) {
                const child = node.slots[digit];
                if (!child?.eligible) continue;
                const start = prefix + digit * span;
                if (depth === 0) return start;
                const result = search(child, depth - 1, start, Math.min(end, start + span - 1));
                if (result >= 0) return result;
            }
            return -1;
        }
        return search(state.root, 6, 0, Math.min(exclusive, state.length) - 1);
    }
    function changed(before, after) {
        const left = states.get(before), right = states.get(after);
        if (!left || !right) return null;
        const result = [];
        function walk(a, b, depth, prefix) {
            visit();
            if (a === b) return;
            if (depth < 0) { if (prefix < right.length && a?.value !== b?.value) result.push(prefix); return; }
            for (let digit = 0; digit < 32; digit++) {
                const x = a?.slots[digit], y = b?.slots[digit];
                if (x !== y) walk(x, y, depth - 1, prefix + digit * width(depth));
            }
        }
        walk(left.root, right.root, 6, 0);
        return result;
    }
    function select(source, position) {
        const state=states.get(source);
        if(!state || !Number.isInteger(position) || position<0 || position>=(state.root?.eligible || 0))return -1;
        let node=state.root,id=0;
        for(let depth=6;depth>=0;depth--){
            visit();
            for(let digit=0;digit<32;digit++){
                const child=node.slots[digit],count=child?.eligible || 0;
                if(position<count){node=child;id+=digit*width(depth);break;}
                position-=count;
            }
        }
        return id;
    }
    function rank(source, exclusive) {
        const state=states.get(source);
        if(!state)throw new Error('Unindexed array');
        let node=state.root,total=0,end=Math.max(0,Math.min(exclusive,state.length));
        if(end===state.length)return node?.eligible || 0;
        for(let depth=6;depth>=0 && node;depth--){
            visit();
            const digit=Math.floor(end/width(depth))%32;
            for(let i=0;i<digit;i++)total+=node.slots[i]?.eligible || 0;
            node=node.slots[digit];
        }
        return total;
    }
    function info(source) {
        const state = states.get(source);
        return state && { length: state.length, complete: (state.root?.validCount || 0) === state.length, eligible: state.root?.eligible || 0,
            count: state.root?.count || 0, bytes: state.root?.bytes || 0 };
    }
    return { from, update, previous, rank, select, info, changed, maximum: source => states.get(source)?.root?.max ?? -Infinity };
}
export { createIndexedArrayApi };
