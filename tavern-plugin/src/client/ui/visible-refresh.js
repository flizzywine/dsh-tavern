		// Sidebar tabs stay mounted while hidden. A data change refreshes a visible
		// tab at once; a hidden tab only marks itself stale and refreshes when shown,
		// so one save does not fan out into every library's full catalog fetch.
		function useVisibleDataRefresh(visible, affects, refresh, key) {
			const shown = visible !== false;
			const state = React.useRef({ stale: true, shown: shown, refresh: refresh, affects: affects });
			state.current.shown = shown;
			state.current.refresh = refresh;
			state.current.affects = affects;
			React.useEffect(function () {
				function onData(event) {
					if (!state.current.affects(event)) return;
					if (state.current.shown) state.current.refresh();
					else state.current.stale = true;
				}
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, []);
			React.useEffect(function () { state.current.stale = true; }, [key]);
			React.useEffect(function () {
				if (!shown || !state.current.stale) return;
				state.current.stale = false;
				state.current.refresh();
			}, [shown, key]);
		}
