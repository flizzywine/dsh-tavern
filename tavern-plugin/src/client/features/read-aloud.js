        function tavernSpeechPlainText(source) {
            const text = String(source || "")
                .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
                .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
            const doc = new DOMParser().parseFromString(text, "text/html");
            doc.querySelectorAll("script,style,template,iframe").forEach(node => node.remove());
            doc.querySelectorAll("br,p,div,li,h1,h2,h3,h4,h5,h6,blockquote").forEach(node => node.append(" "));
            return (doc.body.textContent || "").replace(/[*_~`#>|]/g, "").replace(/\s+/g, " ").trim();
        }
        function tavernBodySpeechChunks(text) {
            const chars = Array.from(text), chunks = [];
            while (chars.length) {
                let end = Math.min(1000, chars.length);
                if (end < chars.length) {
                    for (let i = end - 1; i >= end / 2; i--) {
                        if (/[。！？.!?；;\s]/u.test(chars[i])) { end = i + 1; break; }
                    }
                }
                chunks.push(chars.splice(0, end).join(""));
            }
            return chunks;
        }
        function tavernReplyBody(node) {
            return (node?.blocks || []).filter(block => block.kind === "text").map(block => String(block.text || "")).join("\n");
        }
        const tavernReadAloud = (function () {
            const sessions = new Map(), listeners = new Set();
            let reading = null;
            function emit() { listeners.forEach(fn => fn()); }
            function stop(sessionId) {
                if (!reading || sessionId && reading.sessionId !== sessionId) return;
                const lease = reading; reading = null;
                tavernSpeech.stop(lease.owner);
                emit();
            }
            function session(sessionId) {
                let state = sessions.get(sessionId);
                if (!state) sessions.set(sessionId, state = { count: 0, signal: null, armed: false, before: null, latest: null, generation: 0 });
                return state;
            }
            async function read(sessionId, state, messageId, source) {
                const generation = ++state.generation;
                const data = await rpc("readAloudState", {}, sessionId).catch(() => null);
                if (generation !== state.generation || sessions.get(sessionId) !== state || !data?.auto || data.stepAside) return;
                if (!ttsClientAvailable() || typeof galActive !== "undefined" && galActive.get() === sessionId) return;
                const text = tavernBodySpeechParts(source).map(part => part.text).join(" ");
                if (!text) return;
                stop();
                const owner = {};
                reading = { sessionId, messageId, owner };
                emit();
                tavernSpeech.speak({ sessionId, speaker: "", parts: [{ text, narration: false }], body: true, line: "readAloudLine", owner }).finally(function () {
                    if (reading?.owner === owner) { reading = null; emit(); }
                });
            }
            // signal: [streaming or a new player input, the latest reply's message id, its body while idle].
            function observe(sessionId, signal) {
                const state = session(sessionId);
                if (state.signal === signal) return;
                state.signal = signal;
                const [busy, messageId, source] = JSON.parse(signal);
                if (busy) {
                    if (!state.armed) { state.armed = true; state.before = state.latest; }
                    state.generation++;
                    stop(sessionId);
                    return;
                }
                state.latest = messageId;
                // The finished reply may land a snapshot after the stream ends: stay armed until a new reply is there.
                if (!state.armed || !messageId || messageId === state.before) return;
                state.armed = false;
                if (source) void read(sessionId, state, messageId, source);
            }
            function attach(sessionId) {
                const state = session(sessionId);
                state.count++;
                return function () {
                    state.count--;
                    setTimeout(function () {
                        if (state.count > 0 || sessions.get(sessionId) !== state) return;
                        sessions.delete(sessionId); state.generation++;
                        stop(sessionId);
                    }, 0);
                };
            }
            return { observe, attach, stop,
                reading: (sessionId, messageId) => Boolean(reading && reading.sessionId === sessionId && reading.messageId === messageId),
                subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
        })();
        function tavernReadAloudSignal(snapshot) {
            const nodes = snapshot?.legacy?.nodes || [];
            const busy = Boolean(snapshot?.legacy?.partial) || nodes[nodes.length - 1]?.kind === "user";
            const messageId = latestTavernAssistantMessageId(snapshot);
            const node = !busy && messageId ? nodes.find(item => item.kind === "assistant" && item.messageId === messageId) : null;
            return JSON.stringify([busy, messageId, node ? tavernReplyBody(node) : ""]);
        }
        function TavernReadAloudAction(props) {
            const available = usePackRevision(ttsClientAvailable);
            const [state, setState] = React.useState(null);
            const active = React.useSyncExternalStore(galActive.subscribe, galActive.get);
            const source = props.useChat(snapshot => tavernReplyBody((snapshot?.legacy?.nodes || []).find(item => item.kind === "assistant" && item.messageId === props.messageId)));
            const signal = props.useChat(tavernReadAloudSignal);
            React.useEffect(() => tavernReadAloud.attach(props.sessionId), [props.sessionId]);
            React.useEffect(() => tavernReadAloud.observe(props.sessionId, signal), [props.sessionId, signal]);
            React.useEffect(() => { if (active === props.sessionId) tavernReadAloud.stop(props.sessionId); }, [active, props.sessionId]);
            React.useEffect(() => {
                let live = true;
                const refresh = () => rpc("readAloudState", {}, props.sessionId).then(value => { if (live) setState(value); }, () => { if (live) setState(null); });
                void refresh();
                const off = forkTtsScope?.get("ttsClient")?.subscribe(event => { if (event.type === "readingChanged") void refresh(); });
                return () => { live = false; off?.(); };
            }, [props.sessionId, available]);
            const playing = React.useSyncExternalStore(tavernReadAloud.subscribe, () => tavernReadAloud.reading(props.sessionId, props.messageId));
            if (!available || !source || !state) return null;
            if (state.stepAside) return React.createElement(TavernBodySpeechAction, props);
            if (active === props.sessionId) return null;
            const text = parseBubbles(source, false).map(part => tavernSpeechPlainText(part.text)).join(" ");
            return React.createElement(TavernSpeakButton, {
                key:JSON.stringify([props.sessionId,props.messageId,source]),sessionId:props.sessionId,body:true,text,line:"readAloudLine",label:"朗读",playing,
                onStop:() => tavernReadAloud.stop(props.sessionId),
                beforeRead:async () => {
                    const value = await rpc("readAloudState", {}, props.sessionId).catch(() => null);
                    setState(value);
                    return !!value && !value.stepAside && galActive.get() !== props.sessionId;
                }
            });
        }