// Actual application captures, using only examples/manual-demo (original CC0 data).
import { featureCaptures, featurePages } from './feature-captures.mjs'
export const screenshotSource = {
  date: '2026-10-10',
  runtime: 'DSH 0.1.5-rc.2 / DSH Tavern 2.5.0 · 49ff11b',
  label: '原创公开样例 · 灯塔小镇（CC0）',
  url: 'examples/manual-demo/README.txt',
}

const shot = (file, title, alt, caption) => ({ file, title, alt, caption, width: 1280, height: 720 })

export const screenshots = {
  ...featureCaptures,
  play: shot('play.jpg', '游玩界面', '左侧游玩历史，中间玩家行动与本地模拟正文，右侧酒馆状态中的灯塔镇 MVU 状态栏', '左侧继续游戏，中间阅读正文和输入行动，右侧查看状态。正文由本地模拟服务提供，状态栏是人物卡自带的只读面板，不代表模型质量。'),
  opening: shot('opening.jpg', '选择开场', '游戏准备窗口显示玩家称呼与雨夜来信的第一条开场，可左右切换备选开场并开始新游戏', '选择人物卡后先预览开场：用左右箭头切换备选开场，可顺便填写本局玩家称呼，再点击“开始新游戏”。'),
  workbench: shot('workbench.jpg', '卡片工作台', '卡片模式左侧工作台历史，中间“修改人物卡”任务填入的未发送修改要求，右侧人物卡库', '选择“修改人物卡”和目标卡后，在任务提示词后补充要保留和想调整的内容。输入框中的要求是演示草稿，尚未发送，也未修改人物卡。'),
  card: shot('card-editor.jpg', '人物卡字段', '右侧人物卡详情的基本信息：角色名称、标签与角色描述，底部保存字段按钮', '在人物卡详情中直接查看和编辑字段，修改后点“保存字段”。与通过对话修改一样，操作的是对应人物卡的工作版。'),
  worldbook: shot('worldbook.jpg', '世界书条目', '世界书编辑器展开蓝色鸢尾花印章条目，显示启用状态、非常驻标记与条目内容', '展开条目即可编辑内容与启用状态；触发词、排序等在下方“条目设置”中。修改后需点“保存世界书”。'),
  preset: shot('preset.jpg', '外部预设提示词', '预设编辑器前段条目“叙事基调”展开，显示名称、角色、内容与启用开关', '点击条目即可编辑名称、角色和内容，也可移动到前、中、后段。外部预设可能改变正文行为；日常文风调整优先修改人物卡或使用 Guide。'),
  script: shot('script.jpg', '剧本内容预览', '剧本与素材库右侧预览雨夜来信原创三幕剧情大纲', '导入后可以在剧本与素材库阅读工作版，并返回列表管理引用和人物卡绑定。图中是预写大纲，不代表已经完成模型推进。'),
  profile: shot('user-profile.jpg', '长期偏好入口', '右侧长期偏好面板：默认长期偏好为不启用，长期偏好库与开始建立长期偏好按钮', '长期偏好是按需使用的高级功能，从右侧“长期偏好”进入。独立样例环境尚未建立长期偏好；它不是新建游戏的必填步骤。'),
  'play-ledger': shot('play-ledger.jpg', '游玩台账', '酒馆状态中的游玩台账：当前地点、物品／角色／地点分页，角色页列出林澄与周姨', '点“更新游玩台账”后，后台整理上次之后的新剧情，分物品、角色、地点记录，可编辑或删除。图中台账由本地模拟服务提交，人物均为原创虚构样例。'),
  'rollback-undo': shot('rollback-undo.jpg', '撤销回退', '回退后打开“更多”菜单，显示“撤销回退（恢复第 2 轮）”与压缩上下文', '回退错了时，在“更多”菜单选择“撤销回退”即可恢复刚才回退掉的那一轮。图为实际回退一轮后的菜单，随后已撤销恢复。'),
  'play-gallery': shot('play-gallery.jpg', '画廊', '对话区画廊标签页：本局共 3 张插图，按轮次排列，带刷新与批量删除', '“画廊”标签页按轮次集中列出本局插图，悬停可删除单张，“批量删除”勾选后一起删。'+'图中 DEMO 是原创几何示意图，由本地模拟服务返回，未调用外部生图服务。'),
  'image-plan': shot('image-plan.jpg', '大图里的画面方案', '插图大图下方展开画面方案，显示画面、时刻、构图、画风与提示词，以及改提示词重画按钮', '打开大图并展开“画面方案”，可以看到这张图用的画风与提示词，也可以直接“改提示词重画”。图中画风由本地模拟服务按画风偏好提交；DEMO 是原创几何示意图。'),
  'library-skills': shot('library-skills-20261010.jpg', 'Skill 库', 'Skill 库中按用途分组的内置 Skill、简介与调整用途入口', '点击名称查看正文，展开“调整用途”或拖动分组；不需要的 Skill 可删除。图中仅展示内置方法。'),
  'library-prompts': shot('library-prompts-20261010.jpg', '系统提示词库', '系统提示词条目、导入导出 JSON、全部恢复默认与默认状态', '管理内置提示词；库中条目与外部预设分开，主动恢复默认会清除对应自定义修改。'),
  'local-settings': shot('local-settings-20261010.jpg', '本局设置', '右侧本局设置：玩家称呼、状态栏位置、当前预设与长期偏好选择', '仅影响当前游戏，修改自动保存；切换长期偏好从下一轮生效。'),
  'global-settings': shot('global-settings-20261010.jpg', '全局酒馆设置', '设置 → DSH Tavern 中的显示与交互、提示词模板与上下文压缩', '“隐藏上下文注入和思考过程”默认开启；候选项收起时机即时生效；压缩模式需点击“保存压缩设置”。'),
  'advanced-network': shot('advanced-network-20261010.jpg', '本局联网搜索', '本局设置中的后台结算开关、联网搜索开关与写作 Skill', '在本局设置中切换，后续请求生效；图中联网搜索保持关闭。'),
  'advanced-design': shot('advanced-design-20261010.jpg', '人物设计入口', '点击设计人物后弹出的设计意见输入框，下方人物设计档案为 0', '在酒馆状态点“设计人物”，填写设计意见（选填）后开始设计。图中意见尚未提交，本局还没有设计档案。'),
}

// Each inventory feature has its own explicit screenshot assignment.
export const pageScreenshots = {
  ...featurePages,
  compatibility: ['card-picker', 'card-extensions'], play: ['play', 'play-ledger', 'local-settings', 'global-settings'], cards: ['workbench', 'library-skills', 'library-prompts'], advanced: ['tavern-settings'],
  'local-settings': ['local-settings', 'advanced-network'],
}

screenshots["install-terminal"] = {"file": "install-terminal-current.png", "title": "打开 DSH 终端", "alt": "打开 DSH 终端，操作位置已标红圈", "caption": "进入 Desktop 设置，在窗口顶部点击红圈标出的打开 DSH 终端。", "width": 1617, "height": 973, "source": {"date": "README 已核对", "runtime": "DSH Desktop 2.0.5", "label": "用户提供的 Desktop 设置截图"}}

screenshots["install-profile"] = {"file": "install-profile-current.png", "title": "选择 tavern 配置", "alt": "选择 tavern 配置，操作位置已标红圈", "caption": "进入桌面设置，在 Profile 列表选择 tavern，旁边显示当前即为选中。", "width": 1567, "height": 1004, "source": {"date": "README 已核对", "runtime": "DSH Desktop 2.0.5", "label": "用户提供的 Desktop 设置截图"}}
