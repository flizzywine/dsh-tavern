// The text card mod's settings page: its 设置 section (强度) from the config schema, above its entry sections.
const TextcardConfigPage = props => React.createElement(ModConfigList, { ...props, modId: 'dsh.textcard' });
modClients.register('dsh.textcard', { settings: TextcardConfigPage });
