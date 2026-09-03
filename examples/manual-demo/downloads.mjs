import { card, worldbook, preset, script } from './resources.mjs'

export const demoDownloads = {
  'lighthouse-card.json': JSON.stringify(card, null, 2) + '\n',
  'lighthouse-worldbook.json': JSON.stringify(worldbook, null, 2) + '\n',
  'warm-narrative.json': JSON.stringify(preset, null, 2) + '\n',
  'lighthouse-outline.md': script,
  'README.txt': `灯塔小镇 · 文档公开样例（CC0）

人物、故事、世界书、预设和大纲均为本项目文档原创虚构素材，
不来自私人资料或第三方人物卡，可自由使用、修改和分享。

人物卡：lighthouse-card.json，在人物卡库导入。
世界书：lighthouse-worldbook.json，在世界书库导入，可单独练习条目编辑。
预设：warm-narrative.json，在预设库导入，按需选用。
大纲：lighthouse-outline.md，在剧本库导入，按需绑定人物卡。

人物卡已内置 MVU 初始变量和更新规则，以及只读 HTML 状态栏。
不要直接用样例独立世界书替换卡内世界书，否则会替换这些状态规则。
若想同时使用地点条目，请先通过卡片工作台合并需要的内容并检查结果。

截图记录：2026-09-03，DSH 0.1.2-rc.1 / DSH Tavern 1.3.0。
使用独立 DSH Profile，不含私人配置、模型密钥、对话或人物卡。
截图包括预写开场、操作草稿，以及本地模拟服务驱动的实际界面与工具记录。
没有调用外部文字模型或付费生图服务；预写响应不代表模型质量。
插画中的 DEMO 为原创几何示意图；用户画像与回答均为虚构样例。
图注明确区分操作入口、未发送草稿和已执行的本地样例结果。
正常功能配图不显示报错；异常处理由正文说明。
截图保留实际应用布局；浏览器边缘的翻译悬浮按钮不属于 Tavern。

维护者：源数据位于 examples/manual-demo/resources.mjs。
运行 node docs/manual/build.mjs 会同步生成网页下载文件。
`,
}
