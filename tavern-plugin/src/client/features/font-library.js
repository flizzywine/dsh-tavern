// The font library (lib/font-library.js, RPC listFonts; docs/design/cast-presentation.md「字体库」): its families, listed once
// when a stage first asks (an empty list until then, and again after a failed read). A family joins the page only when a
// stage uses it: ensure(id) writes its @font-face rules (font-display: swap), and the browser fetches only the weights the
// text actually shows.
const tavernFontLibrary = (() => {
	const listeners = new Set(), registered = new Set();
	let fonts = Object.freeze([]), loading = null, style = null;
	return {
		fonts: () => fonts,
		load() {
			if (!loading) loading = rpc("listFonts").then(result => { fonts = Object.freeze(result.fonts); listeners.forEach(fn => fn()); },
				error => { loading = null; console.warn("Font library unavailable", error); });
			return loading;
		},
		ensure(id) {
			const font = fonts.find(item => item.id === id);
			if (!font || registered.has(id)) return;
			registered.add(id);
			if (!style) { style = document.createElement("style"); style.dataset.tavernFontLibrary = ""; document.head.appendChild(style); }
			style.append(font.files.map(file => "@font-face{font-family:" + JSON.stringify(font.family) + ";src:url(" + JSON.stringify(file.url) + ") format(" + JSON.stringify(file.format) + ");font-weight:" + file.weight +
				";font-style:" + file.style + ";font-display:swap}").join("\n") + "\n");
		},
		subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
	};
})();
function useTavernFontLibrary() {
	React.useEffect(() => { tavernFontLibrary.load(); }, []);
	return React.useSyncExternalStore(tavernFontLibrary.subscribe, tavernFontLibrary.fonts);
}
