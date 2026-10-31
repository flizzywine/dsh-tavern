/** Candidate and regeneration interaction state, independent of React and the host composer. */
function createPlayInteractionFlow({ rpc, coordinationView, coordination, applyBodyResult, reportError, timers = globalThis }) {
    function store(normalize = value => value) {
        let value = null;
        const listeners = new Set();
        return Object.freeze({
            getSnapshot: () => value,
            subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
            set(next) { value = normalize(next, value); listeners.forEach(listener => listener(value)); return value; }
        });
    }
    const candidates = store((value, previous) => {
        if (!value) return value;
        const sameChoices = previous && previous.sessionId === value.sessionId && previous.messageId === value.messageId && previous.phase === value.phase && JSON.stringify(previous.choices) === JSON.stringify(value.choices);
        return Object.assign({}, value, { expanded: value.expanded ?? (sameChoices ? previous.expanded : value.phase === "error") });
    });
    const guide = store(), regeneration = store();
    const guidanceBySession = new Map(), pendingCandidates = new Map(), pendingBodies = new Map();
    function once(pending, key, work) {
        if (pending.has(key)) return pending.get(key);
        const promise = Promise.resolve().then(work).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
        pending.set(key, promise);
        return promise;
    }
		function readyCandidatePanel(sessionId, messageId, candidates) {
			const value = candidates && typeof candidates === "object" ? candidates : {};
			return {
				sessionId: sessionId,
				messageId: messageId,
				phase: "ready",
				choices: Array.isArray(value.choices) ? value.choices : [],
				traceSessionId: String(value.traceSessionId || ""),
				traceMode: value.traceMode === "continuable" ? "continuable" : "one-shot",
				error: ""
			};
		}
		function candidateRequestId() { return "candidate-request-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
		async function sendCandidateTask(sessionId, messageId, guidance) {
			const requestId = candidateRequestId();
			let lastError = null;
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const controller = new AbortController();
				const timer = timers.setTimeout(function () { controller.abort(); }, 2000);
				try {
					const result = await rpc("submitTask", { kind: "candidate", requestId: requestId, messageId: messageId, guidance: guidance || "" }, sessionId, { signal: controller.signal });
					const view = coordinationView(result, sessionId);
					coordination.setView(sessionId, view);
					return view.task;
				} catch (error) {
					lastError = error;
					const message = String(error && error.message || "");
					if (!(error && error.name === "AbortError") && !/failed to fetch|networkerror|signal timed out/i.test(message)) throw error;
				} finally { timers.clearTimeout(timer); }
				await new Promise(function (resolve) { timers.setTimeout(resolve, 250); });
			}
			coordination.invalidate(sessionId);
			throw lastError || new Error("持久任务提交失败");
		}

    function submitCandidateTask(sessionId, messageId, guidance) {
        return once(pendingCandidates, JSON.stringify([sessionId, messageId, guidance || ""]), () => sendCandidateTask(sessionId, messageId, guidance));
    }
    async function regenerateCandidates(panel, guidance) {
        if (!panel || guide.getSnapshot() !== panel || panel.phase === "loading") return;
        const loading = guide.set({ ...panel, phase: "loading", error: "" });
        const candidate = candidates.set({ sessionId: panel.sessionId, messageId: panel.messageId, phase: "loading", choices: [], error: "" });
        try {
            await submitCandidateTask(panel.sessionId, panel.messageId, String(guidance || "").trim());
            if (guide.getSnapshot() === loading) guide.set(null);
        } catch (error) {
            reportError("候选项重新生成", error);
            if (guide.getSnapshot() === loading) guide.set({ ...panel, phase: "input", error: String(error?.message || error) });
            if (candidates.getSnapshot() === candidate) candidates.set({ ...candidate, phase: "error", error: String(error?.message || error) });
        }
    }
    function cancelGuide(panel) {
        if (guide.getSnapshot() !== panel) return;
        guide.set(null);
        if (panel.previous) candidates.set(panel.previous);
    }
    async function regenerateBody(panel, guidance, { restyle = false } = {}) {
        if (!panel || regeneration.getSnapshot() !== panel || pendingBodies.has(panel.sessionId)) return;
        const text = String(guidance || "").trim();
        if (text) guidanceBySession.set(panel.sessionId, text); else guidanceBySession.delete(panel.sessionId);
        const loading = regeneration.set({ ...panel, phase: "loading", error: "", rewrite: text !== "", restyle });
        const candidate = candidates.getSnapshot();
        return once(pendingBodies, panel.sessionId, async () => {
            try {
                const result = await rpc("regenBody", Object.assign({ guidance: text }, restyle ? { restyle: true, styleGuidance: text } : {}), panel.sessionId);
                applyBodyResult(panel.sessionId, result.view, panel.tail);
                // A truncated attempt keeps the text it did write; say so instead of
                // letting the shortened body pass for a finished reply.
                if (result && result.view && result.view.regenerationWarning) reportError("重新生成提示", new Error(result.view.regenerationWarning));
                if (candidates.getSnapshot() === candidate) candidates.set(null);
                if (regeneration.getSnapshot() === loading) regeneration.set(null);
            } catch (error) {
                reportError("正文重新生成", error);
                if (regeneration.getSnapshot() === loading) regeneration.set({ ...panel, phase: "error", error: String(error?.message || error) });
            }
        });
    }
    return Object.freeze({ candidates, guide, regeneration, readyCandidatePanel, submitCandidateTask,
        regenerateCandidates, cancelGuide, regenerateBody, guidance: sessionId => guidanceBySession.get(sessionId) || "" });
}
export { createPlayInteractionFlow };
