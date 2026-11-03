# 示例案例

- [阿芙拉 · 金麦穗酒馆](avra/README.md)：人物卡导入与修改、素材创作、剧本和展示正则，附完整产品演示流程。
- [灯塔小镇](manual-demo/README.md)：使用文档的演示素材与截图工具，包含本地模拟模型服务。
- [最小插件](tavern-plugin-hello/)：使用[插件接口](https://github.com/flizzywine/dsh-tavern/wiki/%E6%8F%92%E4%BB%B6%E5%BC%80%E5%8F%91%EF%BC%9A%E6%8E%A5%E5%8F%A3%E6%80%BB%E8%A7%88)的完整插件文件夹。宿主侧（`index.mjs`）每轮在正文段落后挂图，浏览器侧（`client.js`）把正文标记显示成徽章。整个文件夹复制到 Tavern 数据目录的 `plugins/` 下即可加载。
- [大肥鱼 · DSH 人物卡](dafeiyu-card/)：Galgame 分支的示例卡做成的 `.dshcard`（经原作者同意作为演示卡），卡里自带插件，导入即可玩到 Galgame 式舞台（场景、服装、背景音乐由后台结算顺带导演）。卡文件太大，只在本地保留，不随程序分发。
- [航空 MVU](airline-mvu/NOTES.md)：状态栏转 MVU 的适配实验与验证记录；使用范围见案例说明。

各案例的素材、脚本和说明保存在各自目录。文档站的下载资源由 `node docs/manual/build.mjs` 从灯塔小镇案例生成到 `docs/examples/`。
