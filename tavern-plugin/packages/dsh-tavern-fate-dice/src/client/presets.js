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
  preSendPause: false,
  preSendScope: 'both',
  preSendWait: 18
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
