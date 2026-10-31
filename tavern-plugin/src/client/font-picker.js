// Stage-owned adapter supplies its popover and role resolver to the skin picker.
const skinFontPickers = new WeakMap();
function FontPicker(props) {
    const [provider, setProvider] = React.useState(() => window.dshSkinFonts);
    React.useEffect(() => {
        const changed = () => setProvider(window.dshSkinFonts);
        window.addEventListener('dsh-font-library-changed', changed);changed();
        return () => window.removeEventListener('dsh-font-library-changed', changed);
    }, []);
    if (!provider) return React.createElement('span', null, '系统字体');
    if (!skinFontPickers.has(provider)) skinFontPickers.set(provider, provider.createPicker({React, Icon, FloatingPanel, defaultApi:tavernFonts}));
    return React.createElement(skinFontPickers.get(provider), props);
}
