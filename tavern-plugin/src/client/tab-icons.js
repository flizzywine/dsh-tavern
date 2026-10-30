// give every Tavern sidebar tab a meaningful host icon
// (better-sidebar falls back to a generic cube otherwise).
const TAB_ICONS = {
    "dsh-tavern:status": "IconGaugeOutline16",
    "dsh-tavern:conversation-settings": "IconSettingsOutline16",
    "dsh-tavern:user-profile": "IconPersonalizationOutline16",
    "dsh-tavern:cards": "IconUserOutline16",
    "dsh-tavern:presets": "IconAgentPresetOutline16",
    "dsh-tavern:system-prompts": "IconCodeOutline16",
    "dsh-tavern:worldbooks": "IconDatabaseOutline16",
    "dsh-tavern:resources": "IconFolderOpenOutline16",
    "dsh-tavern:skills": "IconSkillOutline16",
    "dsh-tavern:card-scripts": "IconCodeOutline16"
};
function registerTab(service, descriptor) {
    // the 人物卡库 tab's 「导入人物卡」 also takes card ZIPs, plus 「从网址导入卡」 (card-zip-entry.js).
    if (descriptor && descriptor.id === "dsh-tavern:cards" && typeof descriptor.component === "function" && typeof CardLibraryWithZip === "function") {
        const host = descriptor.component;
        descriptor = Object.assign({}, descriptor, { component: function (props) { return React.createElement(CardLibraryWithZip, { host: host, hostProps: props }); } });
    }
    const name = descriptor && !descriptor.icon && TAB_ICONS[descriptor.id];
    const Icon = name && DshUi && DshUi[name];
    // better-sidebar takes `icon(size)`; a plain element only reaches the chip, and the
    // right sidebar's start page then falls back to a placeholder cube.
    return service.registerTab(Icon ? Object.assign({}, descriptor, { icon: function (size) { return React.createElement(Icon, { size: size || 16, width: size || 16, height: size || 16 }); } }) : descriptor);
}
