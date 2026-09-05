// Actual application captures, using only examples/manual-demo (original CC0 data).
import { featureCaptures, featurePages } from './feature-captures.mjs'
export const screenshotSource = {
  date: '2026-09-03',
  runtime: 'DSH 0.1.2-rc.1 / DSH Tavern 1.3.0',
  label: '原创公开样例 · 灯塔小镇（CC0）',
  url: 'examples/manual-demo/README.txt',
}

export const screenshots = {
  ...featureCaptures,
  play: { file: 'play.jpg', title: '游玩界面', alt: '左侧游玩历史，中间雨夜来信开场正文与输入框，右侧灯塔镇 MVU 状态栏', caption: '左侧继续游戏，中间阅读正文和输入行动，右侧查看状态。这里展示的是人物卡预写开场与初始变量，不是模型生成的测试结果。' },
  opening: { file: 'opening.jpg', title: '选择开场', alt: '游戏准备窗口显示雨夜来信的第一条开场，可切换备选开场并点击以此开场', caption: '选择人物卡后，先预览开场。用左右箭头切换，再点击“以此开场”。' },
  workbench: { file: 'workbench.jpg', title: '卡片工作台', alt: '卡片模式左侧历史，中间未发送的样例修改要求，右侧人物卡库', caption: '把要保留的设定、想调整的内容说清楚，再与 Agent 讨论。输入框中的修改要求是演示草稿，尚未发送，也未修改人物卡。' },
  card: { file: 'card-editor.jpg', title: '人物卡字段', alt: '右侧人物卡详情展示名称、标签、角色描述、性格和保存字段按钮', caption: '在人物卡详情中直接查看和编辑字段。与通过对话修改一样，操作的是对应人物卡的工作版。' },
  worldbook: { file: 'worldbook.jpg', title: '世界书条目', alt: '世界书编辑器展开蓝色鸢尾花印章条目，显示主触发词、内容和保存世界书按钮', caption: '一个世界书条目可以包含标题、触发词与背景正文。图中“鸢尾、花店”用于描述该条目的触发条件，填写后需保存。' },
  preset: { file: 'preset.jpg', title: '外部预设提示词', alt: '预设编辑器展示外部条目的开关、角色与内容', caption: '外部预设可供检查、编辑和整理，但可能改变系统行为。日常文风调整优先修改人物卡或使用 Guide。' },
  script: { file: 'script.jpg', title: '剧本内容预览', alt: '剧本库右侧预览雨夜来信原创三幕剧情大纲', caption: '导入后可以在剧本库阅读工作版，并返回列表管理引用和人物卡绑定。图中是预写大纲，不代表已经完成模型推进。' },
  profile: { file: 'user-profile.jpg', title: '用户画像入口', alt: '右侧用户画像面板处于尚未建立状态，显示开始建立用户画像按钮', caption: '用户画像是按需使用的高级功能，从右侧面板进入。独立样例环境尚未建立画像；它不是新建游戏的必填步骤。' },
}

// Each inventory feature has its own explicit screenshot assignment.
export const pageScreenshots = {
  ...featurePages,
  compatibility: ['card-picker', 'card-extensions'], play: ['play'], cards: ['workbench'], advanced: ['tavern-settings'],
}
