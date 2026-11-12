// The redaction mod's core client parts (src/client/mod-clients.js): how 舞台设置 › 模组 shows it. Its settings page is
// the one generated from its config schema; its marks are drawn on the stage (client/stage.cjs), not on the chat floor.
tavernModClients.register("dsh.redaction", { label: "数据删除", description: '导演把正文里的机密词涂黑或换成乱码，点三下揭开；存档里仍是原文。', glyph: 'redact',
    fieldHelp: { kind: '导演没有另选时用的样式：黑条，或乱码。', guidance: '写给导演看的一段话：这张卡里哪些内容该遮。正文模型看不到它。' } });