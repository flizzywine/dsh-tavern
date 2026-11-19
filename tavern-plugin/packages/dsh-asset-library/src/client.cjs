// the asset plugin owns its single right-panel registration.
exports.name = 'dsh-asset-library-client';
exports.inject = ['betterSidebar', 'assetPackWorkbench'];
exports.apply = function (ctx) {
    ctx.effect(() => ctx.get('betterSidebar').registerTab({
        id: 'dsh-asset-library:library', title: '\u821e\u53f0\u7d20\u6750', order: 9.5, single: true, keepMounted: false,
        // Host archive glyph; resolved when the sidebar draws it.
        icon: size => require('react').createElement(require('@deepseek-ai/dsh-client-ui-primitives').IconArchiveOutlineRegular, { size: size || 16, width: size || 16, height: size || 16 }),
        component: props => ctx.get('assetPackWorkbench').render(props)
    }));
    // Stage settings have their own section. The library joins the default 其他 group.
    ctx.inject(['tavernUi'], child => { child.get('tavernUi').registerStartGroup({ title: '\u821e\u53f0\u88c5\u7f6e', tabs: ['dsh-tavern:bubbles'] }); });
};
