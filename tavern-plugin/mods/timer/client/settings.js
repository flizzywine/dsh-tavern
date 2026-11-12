// The timer mod's settings page: the player options (its features) in the two layers; the look, placement and art are the
// active skin's, so they are not rows; a skin lock shows read-only (CfgField).
const TimerConfigPage = props => React.createElement(ModConfigList, { ...props, modId: 'dsh.timer' });
modClients.register('dsh.timer', { settings: TimerConfigPage });
