// The timer mod's core client parts (src/client/mod-clients.js): how 舞台设置 › 模组 shows it, and the asset kind it brings. Its
// settings page is the one generated from its config schema (ModConfigList).
tavernModClients.register("dsh.timer", { label: "计时器", description: '舞台上的倒计时：剧情限时，或等你回应的时限，时间到时自动替你回应；打开菜单、履历时暂停，刷新也不会扣时。', glyph: 'timers',
    assetKind: ['timers', '计时器'] });
