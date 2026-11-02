		// Play events: what the player does on this page (a choice picked, a page read, a voice
		// replayed, an error shown), for plugins through tavernUi.onPlayEvent (docs/plugin-api.md).
		// Counts and indices only: no story text crosses this interface. Listeners run after the
		// action and can never fail it.
		const tavernPlayEvents = (function () {
			const listeners = new Set();
			const seen = new Set();
			function turnOf(gameId) {
				const view = gameId && liveTavernView.getSnapshot(gameId)?.view;
				return Math.max(0, Number(view && view.latestAssistantTurn) || 0);
			}
			function emit(type, gameId, fields) {
				if (!listeners.size) return;
				const id = String(gameId || "");
				const event = Object.freeze(Object.assign({ type: type, gameId: id, turn: turnOf(id), at: Date.now() }, fields));
				for (const listener of Array.from(listeners)) listener(event);
			}
			return {
				emit: emit,
				// Once per key for this page, for things a re-render shows again (a failed turn's error row).
				emitOnce: function (key, type, gameId, fields) {
					if (!listeners.size || seen.has(key)) return;
					if (seen.size >= 2000) seen.clear();
					seen.add(key);
					emit(type, gameId, fields);
				},
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				// Characters changed between two texts (the edit, not its length): common prefix and suffix are left out.
				editChars: function (before, after) {
					let start = 0, end = 0;
					while (start < before.length && start < after.length && before[start] === after[start]) start++;
					while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
					return before.length + after.length - 2 * (start + end);
				}
			};
		})();
