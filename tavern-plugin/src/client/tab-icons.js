// give every Tavern sidebar tab a meaningful host icon
// (better-sidebar falls back to a generic cube otherwise).
const TAB_ICONS = {
    "dsh-tavern:status": "IconGaugeOutline16",
    "dsh-tavern:conversation-settings": "IconSettingsOutline16",
    "dsh-tavern:user-profile": "IconPersonalizationOutline16",
    "dsh-tavern:cards": "IconUserOutline16",
    "dsh-tavern:presets": "IconAgentPresetOutline16",
    "dsh-tavern:system-prompts": "IconCodeOutline16",
    "dsh-tavern:resources": "IconFolderOpenOutline16",
    "dsh-tavern:skills": "IconSkillOutline16",
    "dsh-tavern:card-scripts": "IconCodeOutline16"
};
// A tab glyph drawn here rather than borrowed from the host's set: the world book
// is an open book (the same path as the start page card in modules/sidebar-start.js),
// because the host only offers a database cylinder and the tab would read differently
// from the card, the top bar and the settings list that all open it.
const TAB_ICON_PATHS = {
    "dsh-tavern:worldbooks": 'M12 6.3C9.6 4.2 6 3.9 3.5 4.6v13c2.5-.7 6.1-.4 8.5 1.7 2.4-2.1 6-2.4 8.5-1.7v-13c-2.5-.7-6.1-.4-8.5 1.7zM12 6.3v13',
    "dsh-tavern:plot-compass": 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.8 5.2-2.2 5.4-5.4 2.2 2.2-5.4 5.4-2.2z'
};
function tabPathIcon(path, size) {
    const px = size || 16;
    return React.createElement("svg", { viewBox: "0 0 24 24", width: px, height: px, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        React.createElement("path", { d: path }));
}
function registerTab(service, descriptor) {
    // the 人物卡库 tab's 「导入人物卡」 also takes card ZIPs, plus 「从网址导入卡」 (card-zip-entry.js).
    if (descriptor && descriptor.id === "dsh-tavern:cards" && typeof descriptor.component === "function" && typeof CardLibraryWithZip === "function") {
        const host = descriptor.component;
        descriptor = Object.assign({}, descriptor, { component: function (props) { return React.createElement(CardLibraryWithZip, { host: host, hostProps: props }); } });
    }
    const ownPath = descriptor && !descriptor.icon && TAB_ICON_PATHS[descriptor.id];
    if (ownPath) return service.registerTab(Object.assign({}, descriptor, { icon: function (size) { return tabPathIcon(ownPath, size); } }));
    const name = descriptor && !descriptor.icon && TAB_ICONS[descriptor.id];
    const Icon = name && DshUi && DshUi[name];
    // better-sidebar takes `icon(size)`; a plain element only reaches the chip, and the
    // right sidebar's start page then falls back to a placeholder cube.
    return service.registerTab(Icon ? Object.assign({}, descriptor, { icon: function (size) { return React.createElement(Icon, { size: size || 16, width: size || 16, height: size || 16 }); } }) : descriptor);
}
