// The phone mod's core client parts (src/client/mod-clients.js): how 舞台设置 › 模组 shows it (description, icon), and its
// source (the page its message mark shows on the phone, beat.cjs; the thread ownership and runs the stage's source widgets
// read, stage-phone.cjs). Its settings page is mods/phone/client/settings.js, built into the settings factory scope.
// @include-mod phone/stage-phone.cjs
// @include-mod phone/client/beat.cjs
tavernModClients.register("dsh.phone", { label: "手机", description: '角色用手机收发消息时，舞台上显示成手机画面。', glyph: 'phone',
    source: { beat: phoneModBeat, protocol: { phoneModDirect, phoneModOwnership, run: phoneModRun } } });