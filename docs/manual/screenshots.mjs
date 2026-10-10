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
  script: { file: 'script.jpg', title: '剧本内容预览', alt: '剧本与素材库右侧预览雨夜来信原创三幕剧情大纲', caption: '导入后可以在剧本与素材库阅读工作版，并返回列表管理引用和人物卡绑定。图中是预写大纲，不代表已经完成模型推进。' },
  profile: { file: 'user-profile.jpg', title: '长期偏好入口', alt: '右侧长期偏好面板处于尚未建立状态，显示开始建立长期偏好按钮', caption: '长期偏好是按需使用的高级功能，从右侧面板进入。独立样例环境尚未建立长期偏好；它不是新建游戏的必填步骤。' },
}

// Each inventory feature has its own explicit screenshot assignment.
export const pageScreenshots = {
  ...featurePages,
  compatibility: ['card-picker', 'card-extensions'], play: ['play'], cards: ['workbench'], advanced: ['tavern-settings'],
}

// Refreshed from the live v1.9 demonstration session; omit unavailable captures.
screenshots["advanced-network"] = {"file": "advanced-network-20260917.png", "title": "本局联网搜索", "alt": "本局设置中的联网搜索开关及缓存提示", "caption": "在本局设置中切换，后续请求生效；图中保持关闭。", "width": 477, "height": 134, "source": {"date": "2026-09-17", "runtime": "DSH Tavern v1.9.0 · 2ac3164", "label": "灯塔小镇公开样例 · 实际应用局部截图"}}
screenshots["advanced-design"] = {"file": "advanced-design-20260917.png", "title": "人物设计入口", "alt": "设计人物按钮、空档案列表与人物姿势", "caption": "点击设计人物提交要求。图中尚无设计档案，下方是当前人物姿势。", "width": 487, "height": 196, "source": {"date": "2026-09-17", "runtime": "DSH Tavern v1.9.0 · 2ac3164", "label": "灯塔小镇公开样例 · 实际应用局部截图"}}
Object.assign(pageScreenshots, { advanced: [], e01: [], e02: [], e03: [], e04: [], d06: [], d07: [], m04: [], m05: [], h07: [], h08: [], d10: ['advanced-design'], m02: ['advanced-network'] })

screenshots["library-skills"] = {"file": "library-skills-20260917.jpg", "title": "Skill 库", "alt": "内置 Skill 的用途分组、简介与调整用途入口", "caption": "点击名称查看正文，展开调整用途或拖动分组。图中仅展示内置方法。", "width": 509, "height": 691, "source": {"date": "2026-09-17", "runtime": "DSH Tavern v1.9.0 · 2ac3164", "label": "实际应用局部截图 · 无私人资源内容"}}

screenshots["library-prompts"] = {"file": "library-prompts-20260917.jpg", "title": "系统提示词库", "alt": "系统提示词条目、导入导出与默认状态", "caption": "管理内置提示词；库中条目与外部预设分开，主动恢复默认会清除对应自定义修改。", "width": 509, "height": 732, "source": {"date": "2026-09-17", "runtime": "DSH Tavern v1.9.0 · 2ac3164", "label": "实际应用局部截图 · 无私人资源内容"}}

screenshots["local-settings"] = {"file": "local-settings-20260917.jpg", "title": "本局设置", "alt": "玩家称呼、当前预设与长期偏好选择", "caption": "仅影响当前游戏，修改自动保存；选择长期偏好从下一轮生效。", "width": 509, "height": 514, "source": {"date": "2026-09-17", "runtime": "DSH Tavern v1.9.0 · 2ac3164", "label": "实际应用局部截图 · 无私人资源内容"}}

screenshots["global-settings"] = {"file": "global-settings-20260917.jpg", "title": "全局酒馆设置", "alt": "DSH Tavern 设置中的正文分色与上下文压缩", "caption": "分色即时应用于当前浏览器；压缩模式需点击保存压缩设置。", "width": 794, "height": 795, "source": {"date": "2026-09-17", "runtime": "DSH Tavern v1.9.0 · 2ac3164", "label": "实际应用局部截图 · 无私人资源内容"}}
Object.assign(pageScreenshots, { cards: ['library-skills', 'library-prompts'], play: ['local-settings', 'global-settings'], m05: ['library-skills'], l05: ['library-prompts'], l06: ['library-prompts'], d07: ['global-settings'], e04: ['local-settings'], m01: [], h01: [], h05: [], i02: [], i03: [], i04: [], i05: [], i06: [], j01: [], j02: [], j03: [], j05: [], k01: [], k02: [], k03: [], k04: [], l01: [], l02: [], l03: [], l04: [] })

pageScreenshots['local-settings'] = ['local-settings', 'advanced-network']

screenshots["install-terminal"] = {"file": "install-terminal-current.png", "title": "打开 DSH 终端", "alt": "打开 DSH 终端，操作位置已标红圈", "caption": "进入 Desktop 设置，在窗口顶部点击红圈标出的打开 DSH 终端。", "width": 1617, "height": 973, "source": {"date": "README 已核对", "runtime": "DSH Desktop 2.0.5", "label": "用户提供的 Desktop 设置截图"}}

screenshots["install-profile"] = {"file": "install-profile-current.png", "title": "选择 tavern 配置", "alt": "选择 tavern 配置，操作位置已标红圈", "caption": "进入桌面设置，在 Profile 列表选择 tavern，旁边显示当前即为选中。", "width": 1567, "height": 1004, "source": {"date": "README 已核对", "runtime": "DSH Desktop 2.0.5", "label": "用户提供的 Desktop 设置截图"}}
pageScreenshots.a02 = ['install-terminal', 'install-profile']
