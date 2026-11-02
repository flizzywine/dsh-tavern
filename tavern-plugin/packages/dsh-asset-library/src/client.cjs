// the asset plugin owns its single right-panel registration.
exports.name = 'dsh-asset-library-client';
exports.inject = ['betterSidebar', 'assetPackWorkbench'];
exports.apply = function (ctx) {
    ctx.effect(() => ctx.get('betterSidebar').registerTab({
        id: 'dsh-asset-library:library', title: '\u821e\u53f0\u7d20\u6750', order: 9.5, single: true,
        // Host archive glyph; resolved when the sidebar draws it.
        icon: size => require('react').createElement(require('@deepseek-ai/dsh-client-ui-primitives').IconArchiveOutlineRegular, { size: size || 16, width: size || 16, height: size || 16 }),
        component: props => ctx.get('assetPackWorkbench').render(props)
    }));
    // The stage's two pages (舞台设置 · 舞台素材) form the 舞台装置 section of the sidebar start page.
    ctx.inject(['tavernUi'], child => { child.get('tavernUi').registerStartGroup({ title: '\u821e\u53f0\u88c5\u7f6e', tabs: ['dsh-tavern:bubbles', 'dsh-asset-library:library'] }); });
};
