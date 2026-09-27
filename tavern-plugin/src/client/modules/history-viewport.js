// Bound initial story rendering independently of host child-slot ownership.
// Only explicit input expands history; canonical records are never changed.
function createTavernHistoryViewport(initialLimit = 20, { visit = () => {} } = {}) {
    const index = createOrderedNumericIndex({ visit });
    const entries = new Map(), sessions = new Map(), listeners = new Map();
    let activeSession, selected = index.from([]), earlierKey;
    function state(key) {
        const item = entries.get(key);
        return item && item.sessionId === activeSession && index.get(selected, item.turn)
            ? (key === earlierKey ? 2 : 1) : 0;
    }
    function publish(sessionId, next) {
        const oldEarlier = earlierKey, previousSession = activeSession;
        const changes = previousSession === sessionId ? index.changed(selected, next)
            : [...selected.map(item => ({ before: item })), ...next.map(item => ({ after: item }))];
        activeSession = sessionId;
        selected = next;
        const rows = sessions.get(sessionId)?.rows;
        earlierKey = rows?.length && next.length && rows[0].turn < next[0].turn ? next[0].key : undefined;
        const changedKeys = new Set([oldEarlier, earlierKey]);
        for (const change of changes) {
            if (change.before) { changedKeys.add(change.before.key); change.before.release(); }
            if (change.after) changedKeys.add(change.after.key);
        }
        for (const key of changedKeys) if (key !== undefined) listeners.get(key)?.forEach(fn => fn());
    }
    function select(sessionId) {
        const session = sessions.get(sessionId);
        publish(sessionId, session ? index.suffix(session.rows, session.rows.length - (session.limit || initialLimit)) : index.from([]));
    }
    return {
        subscribe(key, fn) {
            let bucket = listeners.get(key);
            if (!bucket) listeners.set(key, bucket = new Set());
            bucket.add(fn);
            return () => { bucket.delete(fn); if (!bucket.size) listeners.delete(key); };
        },
        state,
        register(sessionId, turn, release) {
            const key = JSON.stringify([sessionId, turn]);
            let item = entries.get(key), session = sessions.get(sessionId);
            if (!session) sessions.set(sessionId, session = { rows: index.from([]) });
            const added = !item, newest = session.rows[session.rows.length - 1];
            if (added && session.limit && newest && turn > newest.turn) session.limit++;
            if (!item) {
                item = { key, sessionId, turn, release, mounts: 0 };
                entries.set(key, item);
                session.rows = index.update(session.rows, [[turn, item]]);
            }
            item.mounts++;
            if (added) select(sessionId);
            return () => {
                if (--item.mounts > 0) return;
                entries.delete(key);
                session.rows = index.update(session.rows, [[turn, undefined]]);
                if (!session.rows.length) sessions.delete(sessionId);
                if (activeSession === sessionId && index.get(selected, turn)) {
                    publish(sessionId, index.update(selected, [[turn, undefined]]));
                } else {
                    item.release();
                    if (activeSession === sessionId) publish(sessionId, selected);
                }
            };
        },
        more(sessionId) {
            const session = sessions.get(sessionId);
            if (!session) return;
            session.limit = (session.limit || initialLimit) + initialLimit;
            select(sessionId);
        },
        hasEarlier(sessionId, turn) { return earlierKey === JSON.stringify([sessionId, turn]); },
        key(sessionId, turn) { return JSON.stringify([sessionId, turn]); }
    };
}
const tavernHistoryViewport = createTavernHistoryViewport();

function TavernWindowedNode(props) {
    const ref = React.useRef(null);
    const expanding = React.useRef(false);
    const turn = Number(props.node.location?.turn?.turn || 0);
    const key = tavernHistoryViewport.key(props.sessionId, turn);
    const subscribe = React.useCallback(fn => tavernHistoryViewport.subscribe(key, fn), [key]);
    const getState = React.useCallback(() => tavernHistoryViewport.state(key), [key]);
    const viewportState = React.useSyncExternalStore(subscribe, getState);
    const active = viewportState !== 0;
    React.useLayoutEffect(() => tavernHistoryViewport.register(props.sessionId, turn, () => {
        tavernRetainedFrames.invalidateOwner(key);
    }), [key]);
    const earlier = props.node.kind !== "user" && viewportState === 2;
    function more() {
        if (expanding.current) return;
        expanding.current = true;
        const node = ref.current, top = node?.getBoundingClientRect().top;
        const scroller = node?.closest("[data-conversation-scroll]");
        tavernHistoryViewport.more(props.sessionId);
        // Keep the previously visible round anchored while older bodies mount.
        requestAnimationFrame(() => {
            if (node?.isConnected && scroller) scroller.scrollTop += node.getBoundingClientRect().top - top;
            expanding.current = false;
        });
    }
    React.useEffect(() => {
        if (!active || !earlier) return;
        const node = ref.current, scroller = node?.closest("[data-conversation-scroll]");
        if (!scroller) return;
        let previousTop = scroller.scrollTop, touchY = null;
        function nearStart() {
            return node.isConnected && node.getBoundingClientRect().top - scroller.getBoundingClientRect().top >= -120
                && node.getBoundingClientRect().top - scroller.getBoundingClientRect().top <= 180;
        }
        function scroll() {
            const top = scroller.scrollTop;
            if (top < previousTop && nearStart()) more();
            previousTop = top;
        }
        function wheel(event) { if (event.deltaY < 0 && nearStart()) more(); }
        function touchStart(event) { touchY = event.touches[0]?.clientY ?? null; }
        function touchMove(event) {
            const nextY = event.touches[0]?.clientY;
            if (touchY !== null && nextY > touchY && nearStart()) more();
            touchY = nextY ?? null;
        }
        scroller.addEventListener("scroll", scroll, { passive: true });
        scroller.addEventListener("wheel", wheel, { passive: true });
        scroller.addEventListener("touchstart", touchStart, { passive: true });
        scroller.addEventListener("touchmove", touchMove, { passive: true });
        return () => {
            scroller.removeEventListener("scroll", scroll);
            scroller.removeEventListener("wheel", wheel);
            scroller.removeEventListener("touchstart", touchStart);
            scroller.removeEventListener("touchmove", touchMove);
        };
    }, [active, earlier, key]);
    return React.createElement("div", { ref, "data-tavern-history-turn": turn, hidden: !active },
        active ? React.createElement(React.Fragment, null,
            earlier ? React.createElement("div", { className: "dsh-tavern-history-controls" },
                React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: more }, "加载更多（20 轮）")) : null,
            React.createElement(props.bodyComponent, { ...props, frameOwner: key })
        ) : null);
}
