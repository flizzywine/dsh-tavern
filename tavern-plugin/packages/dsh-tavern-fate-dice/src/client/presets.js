/* ------------------------------------------------------------------ *
 * presets.js —— 常量、默认设置与纯函数工具
 * 由 build.mjs 拼接进 client.js 的模块工厂作用域内（共享 require / h / React）
 * 方案 A：只保留 4 种检定骰制、3 组表现选项与 6 项极简默认设置。
 * ------------------------------------------------------------------ */

const FD_PLUGIN_ID = 'dsh-tavern-fate-dice'
const FD_PANEL_ID = 'fate-dice'
const FD_STYLE_ID = 'dsh-fate-dice-styles'
const FD_STORAGE_KEYS = {
  settings: 'fate-dice:save-global-settings',
  characterProfile: 'fate-dice:character-profile'
}

/* 宿主 RPC 名称（宿主未实现时由 bridge 统一降级，绝不抛错） */
const FD_RPC = {
  status: 'fate-dice:status',
  readTurn: 'fate-dice:read-turn',
  readTurns: 'fate-dice:read-turns',
  rerollTurn: 'fate-dice:reroll-turn',
  gateResolve: 'fate-dice:gate-resolve',
  gatePeek: 'fate-dice:gate-peek',
  workbench: 'fate-dice:workbench',
  freeRoll: 'fate-dice:free-roll',
  saveSettings: 'fate-dice:save-global-settings',
  saveBinding: 'fate-dice:save-binding',
  /* AI 角色动态画像契约：宿主侧可选择性实现，未实现时由 bridge 降级为本地缓存 */
  refreshProfile: 'fate-dice:refresh-profile',
  saveProfileNote: 'fate-dice:save-profile-note'
}

const FD_RULES = [
  { id: '2d6', label: '2d6 叙事渐进', sides: 6, dice: 2, budget: '−2 ~ +3', budgetMin: -2, budgetMax: 3, recommendedNet: 1, hint: '默认档：成功率线性爬坡，适合长线文字 RP' },
  { id: 'd10', label: 'd10 轻量阶梯', sides: 10, dice: 1, budget: '−2 ~ +4', budgetMin: -2, budgetMax: 4, recommendedNet: 2, hint: '单骰阶梯更轻，节奏偏明快' },
  { id: 'd20', label: 'd20 经典跑团', sides: 20, dice: 1, budget: '−2 ~ +8', budgetMin: -2, budgetMax: 8, recommendedNet: 4, hint: '经典 DC 思维，适合规则化跑团' },
  { id: 'd100', label: 'd100 百分阈值', sides: 100, dice: 1, budget: '−10 ~ +30', budgetMin: -10, budgetMax: 30, recommendedNet: 10, hint: '百分阈值，适合硬核拟真与技能树' }
]

const FD_SENSITIVITY_OPTIONS = [
  { value: 'strict', label: '积极（多数主动尝试触发）' },
  { value: 'normal', label: '适中（动作/冲突触发）' },
  { value: 'rare', label: '谨慎（仅高风险关键节点）' }
]

const FD_TONE_OPTIONS = [
  { value: 'balanced', label: '平衡（+0）' },
  { value: 'heroic', label: '英雄（+1 宽容）' },
  { value: 'gritty', label: '严苛（-1 险境）' }
]

const FD_ANIMATION_OPTIONS = [
  { value: 'atelier', label: '典藏 · 绅士赌桌（胡桃木与车削黄铜 · 默认）' },
  { value: 'pixel', label: '典藏 · 勇者地牢（16-Bit 黄金像素与芯片音）' },
  { value: 'etching', label: '典藏 · 达芬奇手稿（古羊皮纸铜版钢笔排线）' },
  { value: 'urushi', label: '典藏 · 京都黑漆（镜面大漆螺钿与金泥莳绘）' },
  { value: 'bauhaus', label: '典藏 · 包豪斯白瓷（哑光氧化锆与博朗信号橙）' },
  { value: 'murano', label: '典藏 · 深海星仪（威尼斯折射海琉璃与银星盘）' },
  { value: 'monogatari', label: '典藏 · 物语怪异（新房切卡 · 四主角外置实拍演出）' },
  { value: 'bounce', label: '幻想 · 星穹秘法（智能切换）' },
  { value: 'prism', label: '幻想 · 时停棱镜（碎星圣晶 · 子弹时间）' },
  { value: 'inferno', label: '幻想 · 焚天熔炉（玄武熔铁 · 烈焰光柱）' },
  { value: 'cyber', label: '幻想 · 赛博超频（霓虹矩阵 · 战术准星）' },
  { value: 'jianxin', label: '幻想 · 水墨剑心（太虚白玉 · 剑气朱印）' },
  { value: 'singularity', label: '幻想 · 虚空星噬（诡秘奇点 · 引力透镜）' },
  { value: 'compact', label: '2D 极简闪现（轻量徽标）' },
  { value: 'none', label: '关闭动画（直接显示结果）' }
]

const FD_PRE_SEND_SCOPE_OPTIONS = [
  { value: 'both', label: '失败与大失败都暂停（推荐）' },
  { value: 'fumble', label: '仅大失败时暂停' }
]

const FD_PRE_SEND_WAIT_OPTIONS = [
  { value: '10', label: '10 秒（手快党）' },
  { value: '18', label: '18 秒（默认）' },
  { value: '24', label: '24 秒（慢慢想）' }
]

const FD_REVEAL_TIMING_OPTIONS = [
  { value: 'immediate', label: '判定即播（发送后立即投骰）' },
  { value: 'stream-end', label: '随正文落定揭晓（防发前剧透）' }
]

const FD_MULTI_CHECK_MODE_OPTIONS = [
  { value: 'decompose', label: '仅发前条件拆解（纯发前 · 防偷看）' },
  { value: 'agent-tool', label: '发前拆解 + Agent 实时真骰工具（全场景）' },
  { value: 'hybrid-tape', label: '发前拆解 + 备用宿命序列（零延迟兼容）' }
]

const FD_MULTI_CHECK_MAX_OPTIONS = [
  { value: '2', label: '最多 2 次 / 回合（紧凑）' },
  { value: '3', label: '最多 3 次 / 回合（默认）' }
]

const FD_MULTI_CHECK_MODE_DETAILS = {
  decompose: {
    badge: '方案 1 · 纯发前',
    title: '仅发前条件拆解（Multi-Check）',
    summary: '常规单动作回合零额外延迟；仅在识别到玩家一条输入里同时包含多个独立风险动作时，发前拆解为 2~3 项子检定一次性真骰裁定，正文生成中不再追加新骰。',
    scene: '适合「一句输入里连做多件事」（例：一边稳住老板娘、一边偷拿账本、顺便听门外动静），且希望全部骰点在发送前就彻底落定的玩法。',
    flow: '决策模型门控判断本轮是否含多动作 → 命中后拆出每项的动作、能力域、难度与前置依赖（dependsOn） → 服务端逐一投出密码学真骰并按顺序注入约束。',
    pros: '主模型完全无法偷看或挑骰；支持连招前置失败短路；完美兼容「失败时暂停发送」、叙事阻尼器短板联动与防刷骰锁定；不挑主模型。',
    note: '仅覆盖玩家发前写出的多动作，不处理正文写到一半才临时冒出来的突发陷阱；多动作回合会增加 1 次轻量后台拆解耗时。'
  },
  'agent-tool': {
    badge: '方案 1 + 2 · 全场景',
    title: '发前拆解 + Agent 实时真骰工具（fate_dice_roll）',
    summary: '在「发前条件拆解」的基础上共存 Agent 实时真骰工具：玩家发前写出的多动作先拆解掷完，剩余配额留给主模型在正文展开时调用 fate_dice_roll 现掷突发判定。',
    scene: '适合既有多动作输入、又常出现「写到一半突发陷阱 / 伏兵 / 连环过招」的动态跑团与 Agent 玩法。',
    flow: '发前先完成主检定或多动作拆解（支持发前逆命与阻尼器联动） → 若本轮尚未达到上限，主模型生成正文时可按需调用 fate_dice_roll → 服务端结合角色画像与难度护栏当场掷真骰并返回五档裁定。',
    pros: '同时通吃「发前多动作」与「叙事中突发次生判定」；主模型调用前看不到未来点数，完全防偷看；最贴近真实跑团 DM 临场掷骰体验。',
    note: '实时工具需要当前主模型与对话渠道支持工具调用（Tool Use）；正文生成中途新增的骰点无法在发前暂停拦截，总次数共享本回合上限。'
  },
  'hybrid-tape': {
    badge: '方案 1 + 3 · 零延迟兼容',
    title: '发前拆解 + 备用宿命序列真骰带',
    summary: '在「发前条件拆解」的基础上共存备用宿命序列：玩家发前写出的多动作先拆解掷完，若本轮仍有剩余配额，顺延编号（②/③）附带密码学备用真骰列供突发风险取用。',
    scene: '适合主模型不支持工具调用、或不想引入工具调用往返，但仍希望同时覆盖「发前多动作 + 突发次生判定」的场景。',
    flow: '发前先完成主检定或多动作拆解 → 按剩余额度预掷备用骰列（如发前已拆 2 项则顺延给 ③）注入上下文 → 仅出现突发风险时顺位取用并在文末静默回传，结算时合并落盘进楼层胶囊。',
    pros: '生成中零额外工具往返延迟；兼容所有支持文本输出的模型；发前拆解项照常享受 3D 演出、发前逆命与阻尼器联动。',
    note: '备用骰面在发前已随上下文提供，极少数高阶模型可能产生轻微「提前看到备用点数再决定要不要追加检定」的倾向；备用骰在正文结算后入账胶囊。'
  }
}

const FD_MONOGATARI_ACTOR_OPTIONS = [
  { value: 'auto', label: '自动联动（四主角轮换）' },
  { value: 'hitagi', label: '戦場ヶ原ひたぎ（重石蟹 · 文具风暴）' },
  { value: 'shinobu', label: '忍野忍（怪異の王 · 妖刀心渡）' },
  { value: 'hanekawa', label: 'ブラック羽川（障り猫 · 銀爪疾斬）' },
  { value: 'mayoi', label: '八九寺真宵（迷い牛 · 路標迷宮）' },
  { value: 'dual', label: '双人同框：战场原 × 忍野忍' },
  { value: 'dual2', label: '双人同框：黑羽川 × 八九寺' }
]

const FD_MONOGATARI_INTRO_OPTIONS = [
  { value: 'full', label: '完整剧场（前置 6s 主角动画 · 点击可跳过）' },
  { value: 'fast', label: '快节奏切卡（仅全屏字卡与标尺 · 零等待）' }
]

const FD_DEFAULT_SETTINGS = {
  enabled: false,
  sensitivity: 'normal',
  alwaysRoll: false,
  toneBias: 'balanced',
  autoHidden: true,
  damperLinkage: true,
  allowHeuristicFallback: false,
  tapeFallbackEnabled: false,
  autoSuccessEnabled: true,
  contestEnabled: true,
  revealTiming: 'immediate',
  animation: 'atelier',
  monogatariActor: 'auto',
  monogatariIntroMode: 'full',
  monogatariMediaBase: '',
  preSendPause: false,
  preSendScope: 'both',
  preSendWait: 18,
  multiCheckEnabled: false,
  multiCheckMode: 'decompose',
  multiCheckMax: 3
}

function fdUid(prefix) {
  return `${prefix || 'id'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function fdClamp(value, min, max) {
  const num = Number(value)
  if (!Number.isFinite(num)) return min
  return Math.min(max, Math.max(min, Math.round(num)))
}

function fdRuleMeta(ruleId) {
  return FD_RULES.find(item => item.id === ruleId) || FD_RULES[0]
}
