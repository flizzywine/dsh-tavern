// 设置 navigation glyphs for the sections the settings shell has no icon for. The shell picks a row's icon from a closed
// list of its own section ids and draws a gear for every other one, so 手机访问, 酒馆启动器, 语音后端, DSH Tavern, 配图 and
// 酒馆插件 all looked alike. Until `settings.section` carries an icon, one stylesheet swaps the gear of the ids below for
// their glyph. The shell lists the slot's entries sorted by `order` (a stable sort), so the stylesheet derives the same
// list from the same entries and addresses each row by its position; ids not listed here keep the shell's icon.
const SETTINGS_NAV_ICONS = {
    // 手机访问: a phone.
    "pocket": "M5 1.75h6a1 1 0 0 1 1 1v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1zM7 12.25h2",
    // 酒馆启动器: power — it installs, starts and switches the tavern.
    "profile-bridge": "M8 1.75v5.5M4.6 3.75a5.25 5.25 0 1 0 6.8 0",
    // 语音后端: a waveform (the voice plugin's own tab glyph).
    "tts": "M2.5 6.5v3M5.25 4.5v7M8 2.5v11M10.75 5v6M13.5 6.5v3",
    // 本地模型: a chip — models that run on this computer.
    "dsh-local-voice": "M5 4h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM6.5 1.75V4M9.5 1.75V4M6.5 12v2.25M9.5 12v2.25M1.75 6.5H4M1.75 9.5H4M12 6.5h2.25M12 9.5h2.25",
    // DSH Tavern: a mug.
    "dsh-tavern": "M2.75 4.5h7.5v8a1.25 1.25 0 0 1-1.25 1.25h-5A1.25 1.25 0 0 1 2.75 12.5zM10.25 6.5h1.25a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-1.25M5.25 7.25v4M7.75 7.25v4M2.75 4.5a1.75 1.75 0 0 1 2.5-2.1 2 2 0 0 1 3.4-.15 1.75 1.75 0 0 1 1.6 2.25",
    // 配图: a picture.
    "dsh-tavern-image": "M3 2.75h10a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1zM2 11l3.5-3.5 3 3 2-2L14 12M10.5 4.75a1 1 0 1 0 0 2 1 1 0 1 0 0-2z",
    // 酒馆插件: a puzzle piece.
    "dsh-tavern-plugins": "M3.1 4.4h2.75a1.6 1.6 0 1 1 3.2 0h2.8v2.8a1.6 1.6 0 1 1 0 3.2v2.75h-2.8a1.6 1.6 0 1 0-3.2 0H3.1v-2.75a1.6 1.6 0 1 0 0-3.2z"
};
const SETTINGS_NAV_ROW = '[data-shortcut-modal="settings"] nav [class*="_navList"] > button';
function settingsNavIconCss(entries) {
    const ids = entries.map(entry => ({ id: entry.options.id || "", order: entry.options.order || 0 })).sort((a, b) => a.order - b.order).map(row => row.id);
    return ids.map((id, index) => {
        const path = SETTINGS_NAV_ICONS[id];
        if (!path) return "";
        const row = SETTINGS_NAV_ROW + ":nth-child(" + (index + 1) + ")";
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="' + path + '"/></svg>';
        const mask = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") center / 16px 16px no-repeat';
        return row + ' > :is(svg, [class*="_navIcon"]):first-child { display: none; }\n'
            + row + "::before { content: \"\"; flex: none; width: 16px; height: 16px; background: currentColor; -webkit-mask: " + mask + "; mask: " + mask + "; }\n";
    }).join("");
}
function installSettingsNavIcons(slots, doc) {
    const style = doc.createElement("style");
    style.dataset.plugin = "dsh-tavern-plugin";
    style.dataset.pluginCss = "dsh-tavern-plugin/settings-nav-icons.css";
    doc.head.appendChild(style);
    const sync = () => { style.textContent = settingsNavIconCss(slots.entries("settings.section")); };
    sync();
    const off = slots.subscribe("settings.section", sync);
    return () => { off(); style.remove(); };
}
