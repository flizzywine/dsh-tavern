// 最小 Tavern 插件示例（浏览器侧）：每条消息下加「重画示例图」按钮，调用宿主侧的处理函数；
// 并把正文里的 hello###文字### 显示成一个小徽章。
// 这个文件由浏览器直接加载，不需要打包；改完后页面几秒内自动换成新代码。
// load 的 id 必须和 package.json 的 name 一致。
window.__ModuleLoader__.load({
  id: 'tavern-plugin-hello',
  factory: (require) => {
    const React = require('react')
    return {
      name: 'tavern-plugin-hello',
      inject: ['tavernUi'],
      apply(ctx) {
        if (!(ctx.tavernUi.apiVersion >= 2)) return
        ctx.tavernUi.registerMessageAction({
          id: 'redraw', label: '重画示例图',
          when: ({ settled }) => settled,
          run: ({ gameId, turn }) => ctx.tavernUi.callHost('tavern-plugin-hello/redraw', { gameId, turn }),
        })
        ctx.tavernUi.registerTextMarker({
          pattern: /hello###([^#]+)###/,
          render: ({ groups }) => React.createElement('span', {
            style: { padding: '0 6px', borderRadius: 6, background: 'rgba(19,134,152,.15)' },
          }, '👋 ' + groups[0]),
        })
      },
    }
  },
})
