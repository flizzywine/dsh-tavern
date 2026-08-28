// ============================================================================
// 动态世界书管理脚本 - 根据上下文智能启用/禁用世界书条目
//
// 功能：根据当前区域、境界、人物等上下文自动启用/禁用世界书条目，节省 token
// ============================================================================

import { COMPANION_ALIASES_BY_CANONICAL } from '../灯火阑珊-变量结构/companion-aliases';
import { resolveMapAnchor } from '../灯火阑珊/map-system';
import { inferLayerFromTrack } from '../灯火阑珊/region-utils';
import { Schema } from '../灯火阑珊/schema';
import { mountDynamicWorldbookPanel, unmountDynamicWorldbookPanel } from './panel';
import {
  getRuntimeSnapshot,
  registerRuntimeActions,
  updateRuntimeSnapshot,
  type DynamicWorldbookDecisionTrace,
  type DynamicWorldbookDiagnostics,
  type DynamicWorldbookEntryChange,
  type DynamicWorldbookPreviewInput,
} from './runtime';
import { readSettings, subscribeSettings, type DynamicWorldbookSettings } from './settings';

// ============================================================================
// 配置项
// ============================================================================

const CONFIG = {
  // 要管理的世界书名称（修改为你的世界书名）
  WORLDBOOK_NAME: 'current', // 'current' 表示当前角色卡的主世界书

  // 是否启用调试日志
  DEBUG: true, // 临时开启调试日志以排查问题

  // 上下文窗口（检查最近几条消息）
  CONTEXT_WINDOW: 2, // 只检查最近2条消息，更精准

  // 红颜人设窗口（检查最近几层楼是否出现过红颜名字）
  CHARACTER_CONTEXT_WINDOW: 10,

  // 固定使用默认最优策略：生成前开灯，回复后保留核心条目
  STRATEGY: 'balanced' as const,

  // MVU 初始化最大等待时间(毫秒)
  MVU_INIT_TIMEOUT: 3000,

  // 处理间隔时间(毫秒) - 避免频繁触发
  DEBOUNCE_DELAY: 500,

  // 与 Schema、MVU 守卫和前端共用同一份主名称 -> 别名映射，避免新角色漏配。
  CHARACTER_ALIASES: COMPANION_ALIASES_BY_CANONICAL,

  // 在 AI 回复后保持开启的条目类型（仅在 balanced 模式下生效）
  KEEP_ENABLED_AFTER_REPLY: [
    /^\[系统\]/,
    /^\[mvu_update\]/,
    /^\[mvu\]变量列表$/,
    /^\[红颜索引\]$/,
    /^\[地图\]/, // 保持当前地图开启
    /^\[境界\]/, // 保持当前境界开启
  ],
};

let currentSettings = readSettings();

function getRuntimeSettingsSnapshot(): DynamicWorldbookSettings {
  return {
    ...currentSettings,
  };
}

function applySettingsToConfig(settings: DynamicWorldbookSettings): void {
  currentSettings = settings;
  CONFIG.DEBUG = settings.debug;
  CONFIG.CONTEXT_WINDOW = settings.context_window;
  CONFIG.DEBOUNCE_DELAY = settings.debounce_delay;

  updateRuntimeSnapshot({
    settings: getRuntimeSettingsSnapshot(),
  });
}

function shouldAutoApply(): boolean {
  return currentSettings.enabled && currentSettings.auto_apply;
}

function shouldShowToasts(): boolean {
  return currentSettings.show_toasts;
}

applySettingsToConfig(currentSettings);
subscribeSettings(applySettingsToConfig);

// ============================================================================
// 地图智能匹配 - 映射表
// ============================================================================

/** 区域名/地点名 → 对应的地图条目名（[地图] 后面的部分） */
const REGION_TO_MAP: Record<string, string[]> = {
  // 五大主域 - 直接匹配
  神州: ['神州'],
  东苍: ['东苍'],
  西庚: ['西庚'],
  南炎: ['南炎'],
  北冥: ['北冥'],
  // 四海
  四海: ['四海'],
  潮音海: ['四海'],
  龙眠海: ['四海'],
  蓬莱幻海: ['四海'],
  北冥冰海: ['四海'],
  无尽洋: ['四海'],
  天泣洋: ['四海'],
  永夜海域: ['四海', '归墟'],
  归墟之海: ['四海', '归墟'],
  龙眠海峡: ['龙眠海峡', '四海'],
  苍茫古径: ['苍茫古径'],
  赤金走廊: ['赤金走廊'],
  雪线: ['雪线'],
  // 天层
  天渊: ['天渊'],
  九天罡风带: ['天渊'],
  星陨废墟: ['星陨废墟'],
  下霄: ['星陨废墟'],
  太古战场: ['太古战场'],
  九天遗迹: ['太古战场'],
  中霄: ['太古战场'],
  天道裂隙: ['天道裂隙'],
  上霄: ['天道裂隙'],
  // 下层禁地
  归墟: ['归墟'],
  碎金渊: ['碎金渊'],
  万剑冢: ['碎金渊'],
  黄泉古迹: ['黄泉古迹'],
  无尽炎渊: ['无尽炎渊'],
  雷暴海: ['雷暴海'],
  倒悬天墟: ['倒悬天墟'],
  五行逆反界: ['倒悬天墟'],
  // 东苍下层禁地 / 特殊区域
  神木枯冢: ['神木枯冢'],
  万古枯荣渊: ['神木枯冢'],
  枯荣渊: ['神木枯冢'],
  葬仙藤海: ['神木枯冢'],
  枯骨林: ['神木枯冢'],
  畸变藤海: ['神木枯冢'],
  岁月灰烬: ['神木枯冢'],
  枯荣本源: ['神木枯冢'],
  // 地点库中的具体地点 → 所属域的地图
  问道峰: ['神州'],
  藏书阁: ['神州'],
  酆都城: ['神州'],
  九曲天河: ['神州'],
  龙门瀑布: ['神州'],
  剑门关: ['神州'],
  建木森林: ['东苍'],
  青帝陵: ['东苍'],
  百花秘境: ['东苍'],
  万剑冢: ['碎金渊'],
  庚金矿脉: ['西庚'],
  白虎峡谷: ['西庚'],
  不灭火山: ['南炎'],
  地火窟: ['南炎'],
  涅槃台: ['南炎'],
  玄冰山: ['北冥'],
  归墟海眼: ['北冥', '归墟'],
  冥海: ['北冥'],
  // 常见缩写与变体（确保 AI 常见简写也能第一层匹配）
  黄泉: ['黄泉古迹'],
  炎渊: ['无尽炎渊'],
  冥河: ['黄泉古迹'],
  彼岸花海: ['黄泉古迹'],
  冥河滩涂: ['黄泉古迹'],
  九天: ['天渊'],
  罡风: ['天渊'],
  龙门瀑: ['神州'],
  建木林: ['东苍'],
  建木: ['东苍'],
  百花境: ['东苍'],
  庚金: ['西庚'],
  玄冰: ['北冥'],
  归墟眼: ['北冥', '归墟'],
};

/** 层级 → 默认地图（当无法精确匹配时的兜底） */
const LAYER_TO_DEFAULT_MAP: Record<string, string> = {
  天层: '天渊',
  地层: '神州',
  下层: '归墟',
};

/** 域(domain) → 对应的地图条目名（用于通过地点库反查所属地图） */
const DOMAIN_TO_MAP: Record<string, string[]> = {
  天层: ['天渊'],
  神州: ['神州'],
  东苍: ['东苍'],
  南炎: ['南炎'],
  西庚: ['西庚'],
  北冥: ['北冥'],
  // 注意：不映射 '下层'，因为下层有多个子区域（归墟/黄泉古迹/无尽炎渊/雷暴海），
  // 应通过 所属层级 精确匹配子区域，而非笼统映射到某一个
  四海: ['四海'],
  潮音海: ['四海'],
  龙眠海: ['四海'],
  蓬莱幻海: ['四海'],
  北冥冰海: ['四海'],
  无尽洋: ['四海'],
  天泣洋: ['四海'],
  永夜海域: ['四海', '归墟'],
  龙眠海峡: ['龙眠海峡', '四海'],
  雷暴海: ['雷暴海'],
  苍茫古径: ['苍茫古径'],
  赤金走廊: ['赤金走廊'],
  雪线: ['雪线'],
  天渊: ['天渊'],
  星陨废墟: ['星陨废墟'],
  太古战场: ['太古战场'],
  天道裂隙: ['天道裂隙'],
  归墟: ['归墟'],
  碎金渊: ['碎金渊'],
  黄泉古迹: ['黄泉古迹'],
  无尽炎渊: ['无尽炎渊'],
  神木枯冢: ['神木枯冢'],
  倒悬天墟: ['倒悬天墟'],
};

/** 上一次成功匹配的地图（惯性推断缓存，用于处理 AI 生成的未知地名） */
let lastSuccessfulMaps: Set<string> | null = null;
let mapStickyHeat: Record<string, number> = {};
let characterStickyHeat: Record<string, number> = {};

// ============================================================================
// 地图智能匹配 - 辅助函数
// ============================================================================

/** 常见的无意义后缀，AI 经常附加在区域名后面 */
const REGION_SUFFIXES = [
  '大陆',
  '星域',
  '区域',
  '领地',
  '境内',
  '外围',
  '深处',
  '入口',
  '边缘',
  '腹地',
  '中心',
  '核心',
  '内部',
  '附近',
  '周边',
  '一带',
  '地区',
  '之地',
  '所在',
  '方向',
  '地带',
  '范围',
  '以内',
  '以外',
  '上方',
  '下方',
  '之中',
  '之内',
  '之外',
  '地域',
  '界域',
  '空间',
  '世界',
  '地界',
];

/**
 * 归一化区域名：剥离括号、引号、常见后缀、空白等，返回清理后的名称
 *
 * 示例：
 * - "黄泉古迹（冥河滩涂）" → "黄泉古迹"
 * - "东苍大陆" → "东苍"
 * - "天渊星域" → "天渊"
 * - "  归墟·深渊  " → "归墟·深渊"
 * - "「问道峰」" → "问道峰"
 */
function normalizeRegionName(name: string): string {
  if (!name) return '';
  let result = name.trim();
  // 1. 剥离各种括号及其内容
  result = result.replace(/[（(][^）)]*[）)]/g, '');
  result = result.replace(/[「『【《][^」』】》]*[」』】》]/g, '');
  // 2. 剥离引号
  result = result.replace(/[""''「」]/g, '');
  // 3. 剥离常见无意义后缀（从长到短匹配，避免 "大" 误剥离）
  const sortedSuffixes = [...REGION_SUFFIXES].sort((a, b) => b.length - a.length);
  for (const suffix of sortedSuffixes) {
    if (result.endsWith(suffix) && result.length > suffix.length) {
      result = result.slice(0, -suffix.length);
      break; // 只剥一次，避免过度剥离
    }
  }
  return result.trim();
}

/**
 * 对输入名称进行多策略匹配，返回所有匹配到的地图名
 *
 * 匹配策略（按优先级）：
 * 1. 精确匹配（原始名 + 归一化名）
 * 2. 分段匹配（按分隔符拆分后，每段做精确 + 归一化匹配）
 * 3. 包含匹配（输入包含 key 或 key 包含输入）
 * 4. 分段后的包含匹配
 */
function fuzzyMatchRegionToMaps(input: string, debugPrefix?: string): string[] {
  if (!input) return [];
  const results = new Set<string>();
  const normalized = normalizeRegionName(input);

  // === 策略 1：精确匹配（原始 + 归一化） ===
  for (const candidate of new Set([input, normalized])) {
    if (candidate && REGION_TO_MAP[candidate]) {
      REGION_TO_MAP[candidate].forEach(m => results.add(m));
      if (CONFIG.DEBUG && debugPrefix) {
        console.log(`[动态世界书] ${debugPrefix}精确匹配: "${candidate}" → [${REGION_TO_MAP[candidate].join(',')}]`);
      }
    }
  }

  // === 策略 2：分段匹配 ===
  // 处理 "下层·黄泉古迹·彼岸花海" → ["下层", "黄泉古迹", "彼岸花海"]
  const segments = new Set<string>();
  for (const candidate of new Set([input, normalized])) {
    if (!candidate) continue;
    candidate.split(/[·、/\\—\-～~]/).forEach(s => {
      const trimmed = s.trim();
      if (trimmed) {
        segments.add(trimmed);
        const norm = normalizeRegionName(trimmed);
        if (norm && norm !== trimmed) segments.add(norm);
      }
    });
  }
  for (const seg of segments) {
    if (REGION_TO_MAP[seg]) {
      const before = results.size;
      REGION_TO_MAP[seg].forEach(m => results.add(m));
      if (CONFIG.DEBUG && debugPrefix && results.size > before) {
        console.log(`[动态世界书] ${debugPrefix}分段匹配: "${seg}" → [${REGION_TO_MAP[seg].join(',')}]`);
      }
    }
  }

  // 如果前两层已有结果，直接返回（精确度足够高）
  if (results.size > 0) return [...results];

  // === 策略 3：包含匹配（归一化后） ===
  // "黄泉古迹深处" 归一化为 "黄泉古迹" → 包含 key "黄泉古迹" ✅
  // "冥河滩涂" → key "冥河" 被包含 ✅
  for (const [regionKey, maps] of Object.entries(REGION_TO_MAP)) {
    if (regionKey.length < 2) continue; // 跳过太短的 key
    if (normalized.includes(regionKey) || regionKey.includes(normalized)) {
      maps.forEach(m => results.add(m));
      if (CONFIG.DEBUG && debugPrefix) {
        console.log(`[动态世界书] ${debugPrefix}包含匹配: "${normalized}" ↔ "${regionKey}" → [${maps.join(',')}]`);
      }
    }
  }

  if (results.size > 0) return [...results];

  // === 策略 4：分段后的包含匹配 ===
  for (const seg of segments) {
    if (seg.length < 2) continue;
    for (const [regionKey, maps] of Object.entries(REGION_TO_MAP)) {
      if (regionKey.length < 2) continue;
      if (seg.includes(regionKey) || regionKey.includes(seg)) {
        maps.forEach(m => results.add(m));
        if (CONFIG.DEBUG && debugPrefix) {
          console.log(`[动态世界书] ${debugPrefix}分段包含匹配: "${seg}" ↔ "${regionKey}" → [${maps.join(',')}]`);
        }
      }
    }
  }

  return [...results];
}

/** 消息关键词 → 应额外启用的地图 */
const KEYWORD_TO_MAP: Record<string, string[]> = {
  // 北冥相关
  玄武: ['北冥'],
  鲛人: ['北冥'],
  冥船: ['北冥'],
  // 南炎相关
  朱雀: ['南炎'],
  离火宫: ['南炎'],
  炎魔: ['南炎'],
  铸剑山庄: ['南炎'],
  // 东苍相关
  青龙: ['东苍'],
  建木: ['东苍'],
  悬空城: ['东苍'],
  // 东苍特殊禁地相关
  神木枯冢: ['神木枯冢'],
  万古枯荣渊: ['神木枯冢'],
  枯荣渊: ['神木枯冢'],
  葬仙藤海: ['神木枯冢'],
  树魔: ['神木枯冢'],
  岁月剥夺: ['神木枯冢'],
  血肉畸变: ['神木枯冢'],
  岁月灰烬: ['神木枯冢'],
  枯荣本源: ['神木枯冢'],
  // 西庚相关
  白虎: ['西庚'],
  兵家: ['西庚'],
  慕容世家: ['西庚'],
  // 禁地相关
  归墟: ['归墟'],
  黄泉: ['黄泉古迹'],
  炎渊: ['无尽炎渊'],
  祝融: ['无尽炎渊'],
  雷暴: ['雷暴海'],
  // 天层相关
  天渊: ['天渊'],
  星辰碎片: ['天渊'],
  龙凤战场: ['天渊'],
  // 专题地图按明确语义启用，避免常驻占用上下文
  寰宇阵枢: ['九野通衢'],
  跨域传送: ['九野通衢'],
  七大异变: ['异变感应网'],
  连锁共振: ['异变感应网'],
  势力关系: ['宗门势力关系网'],
  宗门联盟: ['宗门势力关系网'],
};

/** 地图条目名别称 → 统一地图名（解决条目名与上下文叫法不一致的问题） */
const MAP_ENTRY_ALIAS_TO_CANONICAL: Record<string, string> = {
  万古枯荣渊: '神木枯冢',
  '碎金渊·万剑冢': '碎金渊',
  '星陨废墟（下霄）': '星陨废墟',
  '太古战场·九天遗迹（中霄）': '太古战场',
  '天道裂隙（上霄）': '天道裂隙',
  '倒悬天墟·五行逆反界': '倒悬天墟',
  '九野通衢·寰宇阵枢': '九野通衢',
};

// ============================================================================
// 规则定义 - 根据你的角色卡自定义这些规则
// ============================================================================

interface WorldbookRule {
  /** 条目名称匹配模式 */
  entryPattern: string | RegExp;
  /** 启用条件（context: 上下文, entryName: 条目名称） */
  shouldEnable: (context: Context, entryName?: string) => boolean;
  /** 优先级（数字越大越优先，默认 0） */
  priority?: number;
}

interface Context {
  /** 当前所在区域 */
  currentRegion: string;
  /** 所属层级（如 黄泉古迹、东苍、天层 等，比 当前区域 更宏观） */
  currentLayer: string;
  /** 环境描述 */
  environmentDesc: string;
  /** 最近消息内容 */
  recentMessages: string[];
  /** 红颜人设检测用的最近消息内容 */
  recentCharacterMessages: string[];
  /** MVU 变量数据 */
  mvuData: ReturnType<typeof Schema.parse> | null;
}

function getContextMapAnchor(ctx: Context): string {
  if (!ctx.mvuData) return '';

  const inferredDomain = inferLayerFromTrack(
    ctx.currentRegion,
    ctx.currentLayer,
    ctx.environmentDesc,
    ctx.mvuData.地点库,
    ctx.mvuData.世界地图,
    ctx.currentLayer,
  );

  return resolveMapAnchor({
    currentRegion: ctx.currentRegion,
    currentDomain: inferredDomain,
    environmentDesc: ctx.environmentDesc,
    anchors: ctx.mvuData.$地图锚点,
    locationLib: ctx.mvuData.地点库,
    worldMap: ctx.mvuData.世界地图,
  });
}

type SectDomain = {
  name: string;
  aliases: string[];
};

type SectFaction = {
  name: string;
  domain: string;
  aliases: string[];
};

type SectPromptState = {
  domainName: string;
  factionName: string;
};

const SECT_DOMAINS: SectDomain[] = [
  { name: '神州', aliases: ['神州', '中州', '皇城', '问道峰', '剑门关', '龙门瀑布'] },
  { name: '东苍', aliases: ['东苍', '建木', '青帝陵', '百花秘境', '龙眠海'] },
  { name: '南炎', aliases: ['南炎', '不灭火山', '地火窟', '涅槃台', '离火宫'] },
  { name: '西庚', aliases: ['西庚', '万剑古冢', '庚金矿脉', '白虎天堑', '潮音海'] },
  { name: '北冥', aliases: ['北冥', '玄冰山', '冥海', '鲛人', '玄武', '归墟之海'] },
  {
    name: '黄泉古迹',
    aliases: ['黄泉古迹', '黄泉', '冥河', '忘川', '奈何桥', '黄泉路', '望乡台', '轮回井', '冥河滩涂'],
  },
  { name: '归墟', aliases: ['归墟', '归墟海眼', '海眼', '渊核', '北冥海眼', '归墟之底'] },
  { name: '无尽炎渊', aliases: ['无尽炎渊', '炎渊', '地心火狱', '祝融', '黑焰层'] },
];

const SECT_FACTIONS: SectFaction[] = [
  { name: '大夏仙朝', domain: '神州', aliases: ['大夏', '仙朝', '皇城', '朝廷'] },
  { name: '忘机剑庐', domain: '神州', aliases: ['剑庐', '问剑', '剑门', '古剑'] },
  { name: '太虚蜃楼', domain: '神州', aliases: ['蜃楼', '天机', '推演', '命盘'] },
  { name: '万象森罗坊', domain: '神州', aliases: ['森罗坊', '坊市', '黑市', '交易'] },
  { name: '苍木龙吟阁', domain: '东苍', aliases: ['龙吟阁', '建木', '青帝陵'] },
  { name: '灵枢百草谷', domain: '东苍', aliases: ['百草谷', '药谷', '灵圃', '丹房'] },
  { name: '浮云朝露阁', domain: '东苍', aliases: ['朝露阁', '浮岛', '歌宴', '雅集'] },
  { name: '劫灰神祠', domain: '无尽炎渊', aliases: ['神祠', '劫灰', '祭火', '焚身'] },
  { name: '渊火灵族', domain: '无尽炎渊', aliases: ['火灵', '岩浆', '炎灵', '熔岩'] },
  { name: '大冶天工炉', domain: '南炎', aliases: ['天工炉', '熔炉', '器坊', '铸器'] },
  { name: '太白杀生冢', domain: '西庚', aliases: ['杀生冢', '万剑古冢', '白虎', '杀伐'] },
  { name: '折戟沉沙谷', domain: '西庚', aliases: ['沉沙谷', '战阵', '军阵', '兵戈'] },
  { name: '藏锋敛锷山庄', domain: '西庚', aliases: ['山庄', '矿脉', '庚金', '铸锋'] },
  { name: '坐忘冥海阁', domain: '北冥', aliases: ['冥海阁', '静海', '冰海'] },
  { name: '泣珠幻海庭', domain: '北冥', aliases: ['幻海庭', '鲛人', '泣珠', '旧梦'] },
  { name: '渡厄幽帆', domain: '北冥', aliases: ['幽帆', '渡口', '摆渡'] },
  { name: '彼岸提灯人', domain: '黄泉古迹', aliases: ['提灯人', '彼岸', '引魂', '黄泉路'] },
  { name: '无间轮回道', domain: '黄泉古迹', aliases: ['无间', '轮回', '业火', '救赎'] },
  { name: '忘川风月楼', domain: '黄泉古迹', aliases: ['风月楼', '忘川', '销金窟', '孟婆汤'] },
  { name: '镜花水月庵', domain: '黄泉古迹', aliases: ['镜花', '水月庵', '采补', '鼎炉'] },
  { name: '尸骨浮屠塔', domain: '归墟', aliases: ['浮屠塔', '尸骨', '炼尸', '换骨'] },
  { name: '蚀月血海宗', domain: '归墟', aliases: ['血海宗', '蚀月', '化血', '吞噬'] },
];

const DEFAULT_SECT_FACTION_BY_DOMAIN: Record<string, string> = {
  神州: '忘机剑庐',
  东苍: '苍木龙吟阁',
  南炎: '大冶天工炉',
  无尽炎渊: '劫灰神祠',
  西庚: '太白杀生冢',
  北冥: '渡厄幽帆',
  黄泉古迹: '彼岸提灯人',
  归墟: '尸骨浮屠塔',
};

function matchSectDomainByText(text: string): SectDomain | null {
  if (!text) return null;
  return SECT_DOMAINS.find(domain => [domain.name, ...domain.aliases].some(alias => text.includes(alias))) || null;
}

function matchSectFactionByText(text: string): SectFaction | null {
  if (!text) return null;
  return SECT_FACTIONS.find(faction => [faction.name, ...faction.aliases].some(alias => text.includes(alias))) || null;
}

function getSectMatchTexts(ctx: Context): string[] {
  const inferredLayer = inferLayerFromTrack(
    ctx.currentRegion,
    ctx.currentLayer,
    ctx.environmentDesc,
    ctx.mvuData?.地点库 as Record<string, { 域?: string }> | undefined,
    ctx.mvuData?.世界地图 as Record<string, { layer?: string }> | undefined,
  );
  const identityFaction = String(ctx.mvuData?.本尊?.身份?.宗门 || '').trim();
  const identityOrigin = String(ctx.mvuData?.本尊?.身份?.出身 || '').trim();
  const navigationInfo = String(ctx.mvuData?.本尊?.行踪?.导航信息 || '').trim();
  const currentSituation = String(ctx.mvuData?.当前处境 || '').trim();
  const locationLib = ctx.mvuData?.地点库 as
    | Record<
        string,
        {
          域?: string;
          类?: string;
          特?: string;
          资?: string[];
        }
      >
    | undefined;
  const worldMap = ctx.mvuData?.世界地图 as
    | Record<
        string,
        {
          layer?: string;
          desc?: string;
          connections?: string[];
        }
      >
    | undefined;

  const regionParts = String(ctx.currentRegion || '')
    .split(/[·•\-—_：:／/|]/)
    .map(part => part.trim())
    .filter(Boolean);

  const normalizedRegion = normalizeRegionName(ctx.currentRegion);
  const regionCandidates = Array.from(new Set([ctx.currentRegion, normalizedRegion, ...regionParts].filter(Boolean)));

  const locationTexts: string[] = [];
  const visitedPlaces = new Set<string>();
  const appendLocationContext = (placeName: string) => {
    if (!placeName || visitedPlaces.has(placeName)) return;
    visitedPlaces.add(placeName);

    const location = locationLib?.[placeName];
    if (location) {
      locationTexts.push(location.域 || '', location.类 || '', location.特 || '', ...(location.资 || []));
      if (location.域 && location.域 !== placeName) {
        appendLocationContext(location.域);
      }
    }

    const mapNode = worldMap?.[placeName];
    if (mapNode) {
      locationTexts.push(mapNode.layer || '', mapNode.desc || '', ...(mapNode.connections || []));
    }
  };

  regionCandidates.forEach(appendLocationContext);

  return [
    identityFaction,
    identityOrigin,
    currentSituation,
    navigationInfo,
    ctx.currentRegion,
    normalizedRegion,
    ctx.currentLayer,
    ctx.environmentDesc,
    inferredLayer,
    ...regionParts,
    ...locationTexts,
    ...ctx.recentMessages,
  ].filter(Boolean);
}

function getCurrentSectDomain(ctx: Context): SectDomain | null {
  const texts = getSectMatchTexts(ctx);
  for (const text of texts) {
    const domain = matchSectDomainByText(text);
    if (domain) return domain;
  }

  const faction = texts.map(matchSectFactionByText).find(Boolean) || null;
  if (faction) {
    return SECT_DOMAINS.find(domain => domain.name === faction.domain) || null;
  }

  return null;
}

function getCurrentSectFaction(ctx: Context, domain: SectDomain | null): SectFaction | null {
  const texts = getSectMatchTexts(ctx);
  for (const text of texts) {
    const faction = matchSectFactionByText(text);
    if (faction) return faction;
  }
  if (!domain) return null;

  const defaultFactionName = DEFAULT_SECT_FACTION_BY_DOMAIN[domain.name];
  return SECT_FACTIONS.find(faction => faction.name === defaultFactionName) || null;
}

function deriveSectPromptState(ctx: Context): SectPromptState {
  const domain = getCurrentSectDomain(ctx);
  const faction = getCurrentSectFaction(ctx, domain);
  return {
    domainName: domain?.name || '',
    factionName: faction?.name || '',
  };
}

function syncSectPromptState(ctx: Context): SectPromptState {
  const sectState = deriveSectPromptState(ctx);
  const variableOption = { type: 'message' as const, message_id: -1 };
  const variables = getVariables(variableOption);
  const currentTopLevelDomain = String(_.get(variables, '__sect_prompt_state.domain', '') || '').trim();
  const currentTopLevelFaction = String(_.get(variables, '__sect_prompt_state.faction', '') || '').trim();
  const currentDomain = String(_.get(variables, 'stat_data.$宗门推断.当前域', '') || '').trim();
  const currentFaction = String(_.get(variables, 'stat_data.$宗门推断.当前主势力', '') || '').trim();

  if (
    currentDomain !== sectState.domainName ||
    currentFaction !== sectState.factionName ||
    currentTopLevelDomain !== sectState.domainName ||
    currentTopLevelFaction !== sectState.factionName
  ) {
    _.set(variables, '__sect_prompt_state.domain', sectState.domainName);
    _.set(variables, '__sect_prompt_state.faction', sectState.factionName);
    _.set(variables, 'stat_data.$宗门推断.当前域', sectState.domainName);
    _.set(variables, 'stat_data.$宗门推断.当前主势力', sectState.factionName);
    replaceVariables(variables, variableOption);

    if (CONFIG.DEBUG) {
      console.log(
        `[动态世界书] 🧭 宗门推断已同步: 域="${sectState.domainName || '无'}", 主势力="${sectState.factionName || '无'}"`,
      );
    }
  }

  return sectState;
}

function buildContextSnapshot(ctx: Context, sectState: SectPromptState) {
  return {
    currentRegion: ctx.currentRegion,
    currentLayer: ctx.currentLayer,
    environmentDesc: ctx.environmentDesc,
    recentMessages: ctx.recentMessages,
    domainName: sectState.domainName,
    factionName: sectState.factionName,
  };
}

type EntryDecisionResult = {
  matched: boolean;
  category: string;
  score: number;
  threshold: number;
  reasons: string[];
  source: 'score' | 'rule' | 'override';
  forced: '' | 'enable' | 'disable';
};

type ScoreBucket = Record<string, { score: number; reasons: string[] }>;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addBucketScore(bucket: ScoreBucket, name: string, score: number, reason: string): void {
  if (!name || score === 0) return;
  if (!bucket[name]) {
    bucket[name] = { score: 0, reasons: [] };
  }
  bucket[name].score += score;
  bucket[name].reasons.push(`${score >= 0 ? '+' : ''}${score} ${reason}`);
}

function getTopBucketEntries(
  bucket: ScoreBucket,
  limit = 12,
): Array<{ name: string; score: number; reasons: string[] }> {
  return Object.entries(bucket)
    .map(([name, value]) => ({
      name,
      score: value.score,
      reasons: value.reasons,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function decayStickyHeat(heat: Record<string, number>): void {
  for (const [name, value] of Object.entries(heat)) {
    const next = Math.max(0, value - 1);
    if (next <= 0) {
      delete heat[name];
      continue;
    }
    heat[name] = next;
  }
}

function primeStickyHeat(heat: Record<string, number>, names: string[], cycles: number): void {
  if (cycles <= 0) return;
  names.forEach(name => {
    if (!name) return;
    heat[name] = cycles;
  });
}

function getManualOverride(entryName: string): '' | 'enable' | 'disable' {
  if (currentSettings.forced_enable_entries.includes(entryName)) return 'enable';
  if (currentSettings.forced_disable_entries.includes(entryName)) return 'disable';
  return '';
}

function resolveCharacterEntryTarget(characterName: string): { mainCharacterName: string; isAliasEntry: boolean } {
  for (const [mainName, aliases] of Object.entries(CONFIG.CHARACTER_ALIASES)) {
    if (aliases.includes(characterName)) {
      return {
        mainCharacterName: mainName,
        isAliasEntry: true,
      };
    }
  }

  return {
    mainCharacterName: characterName,
    isAliasEntry: false,
  };
}

function countMentions(messages: string[], names: string[]) {
  let count = 0;
  const details: string[] = [];

  for (const name of names) {
    const matchedCount = messages.filter(message => messageMentionsName(message, name)).length;
    if (matchedCount > 0) {
      count += matchedCount;
      details.push(`${name}(${matchedCount}次)`);
    }
  }

  return {
    count,
    details,
  };
}

function messageMentionsName(message: string, name: string): boolean {
  const normalizedMessage = String(message || '');
  const normalizedName = String(name || '').trim();
  if (!normalizedMessage || !normalizedName) {
    return false;
  }

  if (normalizedMessage.includes(normalizedName)) {
    return true;
  }

  const regex = new RegExp(
    `(?:^|[^\\p{Script=Han}\\w])(${escapeRegex(normalizedName)})(?:[^\\p{Script=Han}\\w]|$)`,
    'u',
  );
  return regex.test(normalizedMessage);
}

function collectMapScoreBucket(ctx: Context): ScoreBucket {
  const bucket: ScoreBucket = {};
  const currentRegion = String(ctx.currentRegion || '').trim();
  const currentLayer = String(ctx.currentLayer || '').trim();
  const navigationInfo = String(ctx.mvuData?.本尊?.行踪?.导航信息 || '').trim();
  const cachedDomain = String(ctx.mvuData?.$宗门推断?.当前域 || '').trim();
  const inferredParent = inferLayerFromTrack(
    currentRegion,
    currentLayer,
    String(ctx.environmentDesc || ''),
    ctx.mvuData?.地点库 as Record<string, { 域?: string }> | undefined,
    ctx.mvuData?.世界地图 as Record<string, { layer?: string }> | undefined,
    currentLayer,
  );
  const mapAnchor = getContextMapAnchor(ctx);

  fuzzyMatchRegionToMaps(mapAnchor).forEach(name => {
    addBucketScore(bucket, name, 140, `地图锚点命中“${mapAnchor}”`);
  });

  fuzzyMatchRegionToMaps(currentRegion).forEach(name => {
    addBucketScore(bucket, name, 100, `当前区域命中“${currentRegion}”`);
  });
  fuzzyMatchRegionToMaps(currentLayer).forEach(name => {
    addBucketScore(bucket, name, 70, `父级层级命中“${currentLayer}”`);
  });
  fuzzyMatchRegionToMaps(inferredParent).forEach(name => {
    addBucketScore(bucket, name, 90, `父级推断命中“${inferredParent}”`);
  });
  fuzzyMatchRegionToMaps(navigationInfo).forEach(name => {
    addBucketScore(bucket, name, 85, `导航信息命中“${navigationInfo}”`);
  });
  fuzzyMatchRegionToMaps(cachedDomain).forEach(name => {
    addBucketScore(bucket, name, 80, `当前域缓存命中“${cachedDomain}”`);
  });

  for (const [keyword, maps] of Object.entries(KEYWORD_TO_MAP)) {
    const mentionCount = ctx.recentMessages.filter(message => message.includes(keyword)).length;
    if (mentionCount <= 0) continue;
    maps.forEach(name =>
      addBucketScore(
        bucket,
        name,
        Math.min(36, 12 + mentionCount * 8),
        `近期消息提及关键词“${keyword}” ${mentionCount} 次`,
      ),
    );
  }

  if (lastSuccessfulMaps && lastSuccessfulMaps.size > 0) {
    lastSuccessfulMaps.forEach(name => addBucketScore(bucket, name, 18, '沿用上次地图判断'));
  }

  for (const [name, heat] of Object.entries(mapStickyHeat)) {
    addBucketScore(bucket, name, heat * 12, `地图热度延续 ${heat} 轮`);
  }

  if (Object.keys(bucket).length === 0) {
    const fallbackLayer = normalizeRegionName(String(ctx.mvuData?.本尊?.行踪?.所属层级 || ''));
    if (LAYER_TO_DEFAULT_MAP[fallbackLayer]) {
      addBucketScore(bucket, LAYER_TO_DEFAULT_MAP[fallbackLayer], 15, `按层级兜底“${fallbackLayer}”`);
    } else {
      addBucketScore(bucket, '神州', 5, '无明显证据，使用默认地图兜底');
    }
  }

  return bucket;
}

function getMapDecision(ctx: Context, entryName: string): EntryDecisionResult | null {
  const match = entryName.match(/^\[地图\]\s*(.+)$/);
  if (!match) return null;

  const mapName = match[1].trim();
  const canonicalMapName = MAP_ENTRY_ALIAS_TO_CANONICAL[mapName] ?? mapName;
  if (canonicalMapName === '世界空间结构') return null;

  const bucket = collectMapScoreBucket(ctx);
  const current = bucket[canonicalMapName] ?? { score: 0, reasons: [] };
  const topCandidates = getTopBucketEntries(bucket, 3);
  const reasons =
    current.reasons.length > 0
      ? current.reasons
      : [
          topCandidates[0]
            ? `当前更高分的地图候选是“${topCandidates[0].name}”(${topCandidates[0].score} 分)`
            : '没有收集到支持该地图的有效证据',
        ];

  return {
    matched: current.score >= 60,
    category: '地图',
    score: current.score,
    threshold: 60,
    reasons,
    source: 'score',
    forced: '',
  };
}

const FAVOR_STAGE_LABELS = ['陌生期', '好感期', '心动期', '确认期', '深爱期'] as const;
type FavorStageName = (typeof FAVOR_STAGE_LABELS)[number];

const FAVOR_STAGE_ALIASES: Record<string, FavorStageName> = {
  疏离期: '陌生期',
  留意期: '好感期',
  情定期: '确认期',
};

function normalizeFavorStageLabel(stageLabel: string | undefined): FavorStageName | null {
  const normalized = String(stageLabel ?? '').trim();
  if (!normalized) return null;

  for (const stageName of FAVOR_STAGE_LABELS) {
    if (normalized.includes(stageName)) {
      return stageName;
    }
  }

  for (const [alias, stageName] of Object.entries(FAVOR_STAGE_ALIASES)) {
    if (normalized.includes(alias)) {
      return stageName;
    }
  }

  return null;
}

function parseCharacterStageEntry(
  entryName: string,
): { characterName: string; rawStageName: string; stageName: FavorStageName } | null {
  const match = entryName.match(/^\[角色\]\s*(.+?)\s*-\s*(.+)$/);
  if (!match) return null;

  const stageName = normalizeFavorStageLabel(match[2]);
  if (!stageName) return null;

  return {
    characterName: match[1].trim(),
    rawStageName: match[2].trim(),
    stageName,
  };
}

function getFavorStageRange(characterName: string, stageName: string): [number, number] | null {
  if (characterName === '虞汐颜') {
    const favorStages: Record<string, [number, number]> = {
      陌生期: [-999, -999],
      好感期: [-200, 80],
      心动期: [81, 120],
      确认期: [121, 160],
      深爱期: [161, 200],
    };
    return favorStages[stageName] ?? null;
  }

  if (characterName === '安迟迟') {
    const favorStages: Record<string, [number, number]> = {
      陌生期: [-200, 39],
      好感期: [40, 79],
      心动期: [80, 119],
      确认期: [120, 159],
      深爱期: [160, 200],
    };
    return favorStages[stageName] ?? null;
  }

  const favorStages: Record<string, [number, number]> = {
    陌生期: [-200, 40],
    好感期: [41, 80],
    心动期: [81, 120],
    确认期: [121, 160],
    深爱期: [161, 200],
  };

  return favorStages[stageName] ?? null;
}

function resolveFavorStageName(characterName: string, favor: number): string | null {
  let firstAvailableStage: string | null = null;
  let firstMin = Number.POSITIVE_INFINITY;
  let lastAvailableStage: string | null = null;
  let lastMax = Number.NEGATIVE_INFINITY;

  for (const stageName of FAVOR_STAGE_LABELS) {
    const range = getFavorStageRange(characterName, stageName);
    if (!range) continue;
    if (!firstAvailableStage || range[0] < firstMin) {
      firstAvailableStage = stageName;
      firstMin = range[0];
    }
    if (!lastAvailableStage || range[1] > lastMax) {
      lastAvailableStage = stageName;
      lastMax = range[1];
    }
    if (favor >= range[0] && favor <= range[1]) {
      return stageName;
    }
  }

  if (favor < firstMin) {
    return firstAvailableStage;
  }

  if (favor > lastMax) {
    return lastAvailableStage;
  }

  return null;
}

function getCharacterBaseDecision(ctx: Context, entryName: string): EntryDecisionResult | null {
  const match = entryName.match(/^\[角色\]\s*([^-]+)$/);
  if (!match) return null;

  const characterName = match[1].trim();
  const { mainCharacterName, isAliasEntry } = resolveCharacterEntryTarget(characterName);
  const hongyanData = ctx.mvuData?.红颜?.[mainCharacterName];
  const checkNames = isAliasEntry
    ? [characterName]
    : [characterName, ...(CONFIG.CHARACTER_ALIASES[characterName] ?? [])];
  const mentionStats = countMentions(ctx.recentCharacterMessages, checkNames);
  const reasons: string[] = [];
  let score = 0;

  if (!hongyanData) {
    if (mentionStats.count > 0) {
      const preheatScore = Math.min(75, 40 + mentionStats.count * 15);
      return {
        matched: preheatScore >= 50,
        category: '角色',
        score: preheatScore,
        threshold: 50,
        reasons: [
          `+${preheatScore} 红颜尚未入表，但近期消息提及 ${mentionStats.details.join('、')}，先为主人设预热开灯`,
        ],
        source: 'score',
        forced: '',
      };
    }

    return {
      matched: false,
      category: '角色',
      score: 0,
      threshold: 50,
      reasons: [`主角色“${mainCharacterName}”不在红颜列表中，且近期消息没有提及，暂不预热开启`],
      source: 'score',
      forced: '',
    };
  }

  score += 20;
  reasons.push(`+20 红颜列表中存在“${mainCharacterName}”`);

  const hasMessages = ctx.recentCharacterMessages.length > 0;
  if (!hasMessages) {
    score += 35;
    reasons.push('+35 开局阶段允许已存在红颜直接常亮');
  }

  if (mentionStats.count > 0) {
    const mentionScore = Math.min(60, 30 + mentionStats.count * 12);
    score += mentionScore;
    reasons.push(`+${mentionScore} 近期消息提及 ${mentionStats.details.join('、')}`);
  }

  const sticky = characterStickyHeat[mainCharacterName] ?? 0;
  if (sticky > 0) {
    const stickyScore = sticky * 15;
    score += stickyScore;
    reasons.push(`+${stickyScore} 角色热度延续 ${sticky} 轮`);
  }

  return {
    matched: score >= 50,
    category: '角色',
    score,
    threshold: 50,
    reasons,
    source: 'score',
    forced: '',
  };
}

function getCharacterStageDecision(ctx: Context, entryName: string): EntryDecisionResult | null {
  const parsed = parseCharacterStageEntry(entryName);
  if (!parsed) return null;

  const { characterName, stageName } = parsed;
  const baseEntryName = `[角色] ${characterName}`;
  const baseDecision = getCharacterBaseDecision(ctx, baseEntryName);
  const { mainCharacterName, isAliasEntry } = resolveCharacterEntryTarget(characterName);
  const hongyanData = ctx.mvuData?.红颜?.[mainCharacterName];

  if (baseDecision && !baseDecision.matched) {
    return {
      matched: false,
      category: '角色阶段',
      score: Math.min(baseDecision.score, 49),
      threshold: 70,
      reasons: [
        `主人设条目“${baseEntryName}”未达到开启阈值 (${baseDecision.score}/${baseDecision.threshold})，阶段条目禁止单独开启`,
        ...baseDecision.reasons.slice(0, 3),
      ],
      source: 'score',
      forced: '',
    };
  }

  if (!hongyanData) {
    if (stageName === '陌生期' && baseDecision?.matched) {
      return {
        matched: true,
        category: '角色阶段',
        score: Math.max(72, baseDecision.score + 18),
        threshold: 70,
        reasons: [
          `主人设条目“${baseEntryName}”已预热开启 (${baseDecision.score}/${baseDecision.threshold})`,
          '红颜尚未正式入表，阶段条目先默认映射到陌生期',
          ...baseDecision.reasons.slice(0, 2),
        ],
        source: 'score',
        forced: '',
      };
    }

    return {
      matched: false,
      category: '角色阶段',
      score: 0,
      threshold: 70,
      reasons: [`主角色“${mainCharacterName}”尚未进入红颜列表，当前无法映射到 ${stageName}`],
      source: 'score',
      forced: '',
    };
  }

  const reasons: string[] = [];
  let score = 15;
  reasons.push(`+15 红颜列表中存在“${mainCharacterName}”`);

  const favor = hongyanData.好感度 ?? 0;
  const resolvedStageName = resolveFavorStageName(mainCharacterName, favor);

  if (resolvedStageName && resolvedStageName !== stageName) {
    return {
      matched: false,
      category: '角色阶段',
      score: 15,
      threshold: 70,
      reasons: [
        `当前好感度 ${favor} 只映射到“${resolvedStageName}”，同一角色阶段互斥开启`,
        `本阶段“${stageName}”不应与“${resolvedStageName}”同时亮灯`,
      ],
      source: 'score',
      forced: '',
    };
  }

  const range = getFavorStageRange(mainCharacterName, stageName);
  if (range) {
    if (favor >= range[0] && favor <= range[1]) {
      score += 55;
      reasons.push(`+55 好感度 ${favor} 落在 ${stageName} 范围 [${range[0]}, ${range[1]}]`);
    } else {
      reasons.push(`+0 好感度 ${favor} 未落在 ${stageName} 范围 [${range[0]}, ${range[1]}]`);
    }
  }

  const hasMessages = ctx.recentCharacterMessages.length > 0;
  if (!hasMessages) {
    score += 20;
    reasons.push('+20 开局阶段允许当前阶段条目直接常亮');
  }

  const checkNames = isAliasEntry
    ? [characterName]
    : [characterName, ...(CONFIG.CHARACTER_ALIASES[characterName] ?? [])];
  const mentionStats = countMentions(ctx.recentCharacterMessages, checkNames);
  if (mentionStats.count > 0) {
    const mentionScore = Math.min(50, 25 + mentionStats.count * 10);
    score += mentionScore;
    reasons.push(`+${mentionScore} 近期消息提及 ${mentionStats.details.join('、')}`);
  }

  const sticky = characterStickyHeat[mainCharacterName] ?? 0;
  if (sticky > 0) {
    const stickyScore = sticky * 12;
    score += stickyScore;
    reasons.push(`+${stickyScore} 角色阶段热度延续 ${sticky} 轮`);
  }

  return {
    matched: score >= 70,
    category: '角色阶段',
    score,
    threshold: 70,
    reasons,
    source: 'score',
    forced: '',
  };
}

function getSpecializedDecision(ctx: Context, entryName: string): EntryDecisionResult | null {
  const override = getManualOverride(entryName);
  if (override) {
    return {
      matched: override === 'enable',
      category: '手动覆盖',
      score: override === 'enable' ? 999 : -1,
      threshold: 1,
      reasons: [override === 'enable' ? '已在扩展面板中手动强制开启' : '已在扩展面板中手动强制关闭'],
      source: 'override',
      forced: override,
    };
  }

  return (
    getMapDecision(ctx, entryName) ??
    getCharacterStageDecision(ctx, entryName) ??
    getCharacterBaseDecision(ctx, entryName)
  );
}

function buildDecisionTrace(entryName: string, decision: EntryDecisionResult): DynamicWorldbookDecisionTrace {
  return {
    name: entryName,
    category: decision.category,
    score: decision.score,
    threshold: decision.threshold,
    matched: decision.matched,
    source: decision.source,
    forced: decision.forced,
    reasons: decision.reasons.slice(0, 6),
  };
}

function getEntryCategoryLabel(entryName: string): string {
  return entryName.match(/^\[([^\]]+)\]/)?.[1] ?? '规则';
}

function refreshStickyHeatsFromEntries(entryNames: string[]): void {
  const activeMaps = new Set<string>();
  const activeCharacters = new Set<string>();

  entryNames.forEach(entryName => {
    const mapMatch = entryName.match(/^\[地图\]\s*(.+)$/);
    if (mapMatch) {
      const canonicalMapName = MAP_ENTRY_ALIAS_TO_CANONICAL[mapMatch[1].trim()] ?? mapMatch[1].trim();
      if (canonicalMapName !== '世界空间结构') {
        activeMaps.add(canonicalMapName);
      }
    }

    const baseCharacterMatch = entryName.match(/^\[角色\]\s*([^-]+)$/);
    if (baseCharacterMatch) {
      const target = resolveCharacterEntryTarget(baseCharacterMatch[1].trim());
      activeCharacters.add(target.mainCharacterName);
    }

    const stageCharacterMatch = parseCharacterStageEntry(entryName);
    if (stageCharacterMatch) {
      const target = resolveCharacterEntryTarget(stageCharacterMatch.characterName);
      activeCharacters.add(target.mainCharacterName);
    }
  });

  if (activeMaps.size > 0) {
    lastSuccessfulMaps = new Set(activeMaps);
  }

  primeStickyHeat(mapStickyHeat, [...activeMaps], currentSettings.map_sticky_cycles);
  primeStickyHeat(characterStickyHeat, [...activeCharacters], currentSettings.character_sticky_cycles);
}

const RULES: WorldbookRule[] = [
  // ============================================================================
  // 系统设定 - 始终启用（蓝灯）
  // ============================================================================
  {
    entryPattern: /^\[系统\]/,
    shouldEnable: () => true,
    priority: 100,
  },
  {
    entryPattern: /^\[mvu_update\]/,
    shouldEnable: () => true,
    priority: 100,
  },
  {
    entryPattern: /^\[mvu\]变量列表$/,
    shouldEnable: () => true,
    priority: 100,
  },

  // ============================================================================
  // 地图相关 - 世界空间结构始终启用
  // ============================================================================
  {
    entryPattern: '[地图] 世界空间结构',
    shouldEnable: () => true,
    priority: 100,
  },

  // ============================================================================
  // 宗门提示词 - 由脚本先推断域和主势力，再交给 ESJ 出文案
  // ============================================================================
  {
    entryPattern: /(?:宗门势力-低token底板|\[宗门\]\s*底板)/,
    shouldEnable: () => true,
    priority: 95,
  },
  {
    entryPattern: /(?:宗门势力-当前地域ESJ|\[宗门\]\s*当前地域)/,
    shouldEnable: ctx => {
      const domain = getCurrentSectDomain(ctx);
      if (CONFIG.DEBUG && domain) {
        console.log(
          `[动态世界书] ✅ 当前地域宗门: 命中域=${domain.name} (区域="${ctx.currentRegion}", 层级="${ctx.currentLayer}")`,
        );
      }
      return domain !== null;
    },
    priority: 94,
  },
  {
    entryPattern: /(?:宗门势力-当前主势力ESJ|\[宗门\]\s*当前主势力)/,
    shouldEnable: ctx => {
      const sectState = deriveSectPromptState(ctx);
      if (CONFIG.DEBUG && (sectState.domainName || sectState.factionName)) {
        console.log(
          `[动态世界书] ✅ 当前主势力宗门: 域="${sectState.domainName || '无'}", 主势力="${sectState.factionName || '无'}"`,
        );
      }
      return !!(sectState.domainName || sectState.factionName);
    },
    priority: 93,
  },

  // ============================================================================
  // 地图相关 - 智能多层匹配（精确区域 → 地点库域 → 层级兜底 → 关键词补充）
  // ============================================================================
  {
    entryPattern: /^\[地图\]\s*(.+)$/,
    shouldEnable: (ctx, entryName) => {
      if (!entryName) return false;
      const match = entryName.match(/^\[地图\]\s*(.+)$/);
      if (!match) return false;
      const mapName = match[1].trim();
      const canonicalMapName = MAP_ENTRY_ALIAS_TO_CANONICAL[mapName] ?? mapName;

      // 世界空间结构由上面的规则管理
      if (canonicalMapName === '世界空间结构') return true;

      const shouldEnableMaps = new Set<string>();

      // 显式/兼容推断的地图锚点优先，确保浮岛、秘境等地点落在正确母域。
      const mapAnchor = getContextMapAnchor(ctx);
      fuzzyMatchRegionToMaps(mapAnchor, '锚点→').forEach(m => shouldEnableMaps.add(m));

      // ====================================================================
      // 第1层：智能模糊匹配当前区域和所属层级
      // 内部自动处理：精确→归一化→分段→包含→前缀 多策略匹配
      // ====================================================================
      fuzzyMatchRegionToMaps(ctx.currentRegion, '区域→').forEach(m => shouldEnableMaps.add(m));
      fuzzyMatchRegionToMaps(ctx.currentLayer, '层级→').forEach(m => shouldEnableMaps.add(m));

      // ====================================================================
      // 第1.5层：通过地点库查找所属域（处理 AI 动态创建的地点）
      // ====================================================================
      if (shouldEnableMaps.size === 0 && ctx.currentRegion && ctx.mvuData?.地点库) {
        const normalized = normalizeRegionName(ctx.currentRegion);
        // 精确匹配 + 归一化匹配
        const locationData = ctx.mvuData.地点库[ctx.currentRegion] || ctx.mvuData.地点库[normalized];
        if (locationData?.域) {
          const domainMaps = DOMAIN_TO_MAP[locationData.域];
          if (domainMaps) {
            domainMaps.forEach(m => shouldEnableMaps.add(m));
            if (CONFIG.DEBUG) {
              console.log(`[动态世界书] 地点库域匹配: ${ctx.currentRegion} → 域=${locationData.域}`);
            }
          }
        }
        // 遍历地点库做包含匹配（处理 "冥河滩涂" 包含 "冥河" 等情况）
        if (shouldEnableMaps.size === 0 && normalized.length >= 2) {
          for (const [locName, locData] of Object.entries(ctx.mvuData.地点库)) {
            if (locName.length < 2) continue;
            if (normalized.includes(locName) || locName.includes(normalized)) {
              const domainMaps = DOMAIN_TO_MAP[locData.域];
              if (domainMaps) {
                domainMaps.forEach(m => shouldEnableMaps.add(m));
                if (CONFIG.DEBUG) {
                  console.log(`[动态世界书] 地点库包含匹配: "${normalized}" ↔ "${locName}" → 域=${locData.域}`);
                }
                break;
              }
            }
          }
        }
      }

      // 更新惯性缓存（仅在有确信匹配时更新，不受后续层级影响）
      if (shouldEnableMaps.size > 0) {
        lastSuccessfulMaps = new Set(shouldEnableMaps);
      }

      // ====================================================================
      // 第1.8层：惯性推断（沿用上一次成功匹配的地图，处理 AI 生成的完全未知地名）
      // ====================================================================
      if (shouldEnableMaps.size === 0 && lastSuccessfulMaps && lastSuccessfulMaps.size > 0) {
        lastSuccessfulMaps.forEach(m => shouldEnableMaps.add(m));
        if (CONFIG.DEBUG) {
          console.log(`[动态世界书] 惯性推断: 沿用上次匹配 [${[...lastSuccessfulMaps].join(',')}]`);
        }
      }

      // ====================================================================
      // 第2层：层级兜底（当所有匹配和惯性推断均无结果时，如冷启动场景）
      // ====================================================================
      if (shouldEnableMaps.size === 0 && ctx.mvuData?.本尊?.行踪?.所属层级) {
        const layer = normalizeRegionName(ctx.mvuData.本尊.行踪.所属层级);
        if (LAYER_TO_DEFAULT_MAP[layer]) {
          shouldEnableMaps.add(LAYER_TO_DEFAULT_MAP[layer]);
        }
      }

      // ====================================================================
      // 第3层：消息关键词补充（仅在前面所有层级都无匹配时才作为兜底）
      // ====================================================================
      if (shouldEnableMaps.size === 0) {
        for (const [keyword, maps] of Object.entries(KEYWORD_TO_MAP)) {
          if (ctx.recentMessages.some(msg => msg.includes(keyword))) {
            maps.forEach(m => shouldEnableMaps.add(m));
          }
        }
      }

      // 兜底：如果没有任何匹配，默认启用神州
      if (shouldEnableMaps.size === 0) {
        shouldEnableMaps.add('神州');
      }

      const isMatch = shouldEnableMaps.has(canonicalMapName);

      if (CONFIG.DEBUG && isMatch) {
        console.log(
          `[动态世界书] 地图匹配成功: ${mapName} (规范名=${canonicalMapName}, 当前区域=${ctx.currentRegion}, 层级=${ctx.currentLayer}, 启用集=[${[...shouldEnableMaps].join(',')}])`,
        );
      }

      return isMatch;
    },
    priority: 10,
  },

  // ============================================================================
  // 角色相关 - 精确匹配角色名和阶段（支持别名）
  // ============================================================================
  // 1. 带阶段的角色条目（如：[角色] 羽岚 - 陌生期）
  {
    entryPattern: /^\[角色\]\s*(.+?)\s*-\s*(.+)$/,
    shouldEnable: (ctx, entryName) => {
      if (!entryName) return false;
      const parsed = parseCharacterStageEntry(entryName);
      if (!parsed) return false;

      const { characterName, stageName, rawStageName } = parsed;
      const { mainCharacterName } = resolveCharacterEntryTarget(characterName);

      // 检查角色是否在红颜列表中
      const hongyanData = ctx.mvuData?.红颜?.[mainCharacterName];
      if (!hongyanData) {
        if (CONFIG.DEBUG) {
          console.log(`[动态世界书] 角色不在红颜列表中: ${characterName} -> ${mainCharacterName}`);
        }
        return false;
      }

      // 【修复】如果没有消息（开局），直接根据好感度阶段开启，不检查提及
      const hasMessages = ctx.recentCharacterMessages.length > 0;

      // 如果有消息，需要检查是否被提及
      if (hasMessages) {
        // 获取角色的所有可能名称（主名称 + 别名）
        const allNames = [characterName];
        if (mainCharacterName !== characterName) {
          allNames.push(mainCharacterName);
        }
        if (CONFIG.CHARACTER_ALIASES[mainCharacterName]) {
          allNames.push(...CONFIG.CHARACTER_ALIASES[mainCharacterName]);
        }

        // 检查是否提到任何一个名称
        let isMentioned = false;
        for (const name of allNames) {
          if (ctx.recentCharacterMessages.some(msg => messageMentionsName(msg, name))) {
            isMentioned = true;
            if (CONFIG.DEBUG) {
              console.log(`[动态世界书] 匹配到别名: ${name} -> ${characterName}`);
            }
            break;
          }
        }

        if (!isMentioned) {
          if (CONFIG.DEBUG) {
            console.log(`[动态世界书] 角色未在近期消息中提及: ${characterName} (含别名)`);
          }
          return false;
        }
      } else if (CONFIG.DEBUG) {
        console.log(`[动态世界书] 开局无消息，直接根据好感度阶段开启: ${characterName}`);
      }

      // 好感度阶段精确映射
      // 虞汐颜无陌生期，前段保持较长缓冲，避免过早切入心动/确认阶段
      const favor = hongyanData.好感度 ?? 0;
      const resolvedStageName = resolveFavorStageName(mainCharacterName, favor);
      const range = getFavorStageRange(mainCharacterName, stageName);
      const isInRange = resolvedStageName === stageName;

      if (CONFIG.DEBUG) {
        console.log(
          `[动态世界书] 角色阶段匹配: ${characterName} -> ${mainCharacterName} - ${rawStageName} => ${stageName}, 好感度=${favor}, 解析阶段=${resolvedStageName ?? '无'}, 范围=${range ? `[${range[0]}, ${range[1]}]` : '[未定义]'}, 匹配=${isInRange}`,
        );
      }

      return isInRange;
    },
    priority: 9,
  },

  // 2. 基础角色条目（如：[角色] 羽岚）- 支持别名匹配，开局时根据红颜列表开启
  {
    entryPattern: /^\[角色\]\s*([^-]+)$/,
    shouldEnable: (ctx, entryName) => {
      if (!entryName) return false;
      const match = entryName.match(/^\[角色\]\s*([^-]+)$/);
      if (!match) return false;
      const characterName = match[1].trim();

      // 【调试】检查上下文消息
      if (CONFIG.DEBUG) {
        console.log(`[动态世界书] 🔍 检查角色: ${characterName}`);
        console.log(
          `[动态世界书] 🔍 红颜检测消息 (${ctx.recentCharacterMessages.length}条):`,
          ctx.recentCharacterMessages,
        );
      }

      // 【关键修复】检查这是不是某个角色的别名条目
      // 如果是别名条目，找到它对应的主角色名
      let mainCharacterName = characterName;
      let isAliasEntry = false;

      for (const [mainName, aliases] of Object.entries(CONFIG.CHARACTER_ALIASES)) {
        if (aliases.includes(characterName)) {
          mainCharacterName = mainName;
          isAliasEntry = true;
          if (CONFIG.DEBUG) {
            console.log(`[动态世界书] 🔗 识别到别名条目: ${characterName} -> 主角色: ${mainName}`);
          }
          break;
        }
      }

      // 【关键修复】开局时直接根据红颜列表开启（使用主角色名检查）
      const hasMessages = ctx.recentCharacterMessages.length > 0;

      if (!hasMessages) {
        // 开局：检查主角色是否在红颜列表中
        const isInHongyan = ctx.mvuData?.红颜?.[mainCharacterName] !== undefined;

        if (CONFIG.DEBUG) {
          if (isInHongyan) {
            console.log(
              `[动态世界书] ✅ 开局-应该开启: ${characterName}${isAliasEntry ? ` (主角色: ${mainCharacterName})` : ''} (在红颜列表中)`,
            );
          } else {
            console.log(
              `[动态世界书] ❌ 开局-不应开启: ${characterName}${isAliasEntry ? ` (主角色: ${mainCharacterName})` : ''} (不在红颜列表中)`,
            );
          }
        }

        return isInHongyan;
      }

      // 有消息：检查提及次数
      // 如果这是别名条目，检查这个别名是否被提及
      // 如果这是主条目，检查主名称或任何别名是否被提及
      let checkNames: string[];

      if (isAliasEntry) {
        // 别名条目：只检查这个别名本身
        checkNames = [characterName];
      } else {
        // 主条目：检查主名称 + 所有别名
        checkNames = [characterName];
        if (CONFIG.CHARACTER_ALIASES[characterName]) {
          checkNames.push(...CONFIG.CHARACTER_ALIASES[characterName]);
        }
      }

      // 累计所有名称的提及次数
      let mentionCount = 0;
      const mentionDetails: string[] = [];

      for (const name of checkNames) {
        const count = ctx.recentCharacterMessages.filter(msg => messageMentionsName(msg, name)).length;

        if (count > 0) {
          mentionCount += count;
          mentionDetails.push(`${name}(${count}次)`);

          if (CONFIG.DEBUG) {
            console.log(`[动态世界书] 🔍 匹配到: ${name}, 次数=${count}`);
          }
        }
      }

      // 【严格】必须在最近消息中被明确提及至少1次才开启
      const shouldEnable = mentionCount >= 1;

      if (CONFIG.DEBUG) {
        const typeInfo = isAliasEntry ? ` [别名条目 -> ${mainCharacterName}]` : '';
        const aliasInfo =
          !isAliasEntry && CONFIG.CHARACTER_ALIASES[characterName]
            ? ` [别名: ${CONFIG.CHARACTER_ALIASES[characterName].join(', ')}]`
            : '';
        const detailInfo = mentionDetails.length > 0 ? ` 提及详情: ${mentionDetails.join(', ')}` : '';

        if (shouldEnable) {
          console.log(
            `[动态世界书] ✅ 应该开启: ${characterName}${typeInfo}${aliasInfo}, 累计提及=${mentionCount}次${detailInfo}`,
          );
        } else {
          console.log(
            `[动态世界书] ❌ 不应开启: ${characterName}${typeInfo}${aliasInfo}, 累计提及=${mentionCount}次 (需≥1次)`,
          );
        }
      }

      return shouldEnable;
    },
    priority: 8,
  },

  // ============================================================================
  // 境界相关 - 精确匹配当前境界等级
  // ============================================================================
  {
    entryPattern: /^\[境界\]\s*(.+)$/,
    shouldEnable: (ctx, entryName) => {
      if (!entryName) return false;
      const match = entryName.match(/^\[境界\]\s*(.+)$/);
      if (!match) return false;
      const realmName = match[1].trim();
      const level = ctx.mvuData?.本尊?.等级 ?? 1;

      // 境界等级映射（根据踏月寻仙设定，与 schema.ts 保持一致）
      const realmRanges: Record<string, [number, number]> = {
        练气: [1, 4],
        筑基: [5, 8],
        金丹: [9, 12],
        元婴: [13, 16],
        化神: [17, 20],
        炼虚: [21, 24], // 修正：schema 中是"炼虚"而非"合体"
        合体: [25, 28],
        大乘: [29, 32],
        渡劫: [33, 36],
      };

      const range = realmRanges[realmName];
      if (!range) {
        if (CONFIG.DEBUG) {
          console.log(`[动态世界书] 未知境界名称: ${realmName}`);
        }
        return false;
      }

      const isInRange = level >= range[0] && level <= range[1];

      if (CONFIG.DEBUG) {
        console.log(
          `[动态世界书] 境界匹配: ${realmName}, 等级=${level}, 范围=[${range[0]}, ${range[1]}], 匹配=${isInRange}`,
        );
      }

      return isInRange;
    },
    priority: 7,
  },

  // ============================================================================
  // 红颜索引 - 始终启用
  // ============================================================================
  {
    entryPattern: /^\[红颜索引\]$/,
    shouldEnable: () => true,
    priority: 100,
  },

  // ============================================================================
  // 物品/法宝/功法/势力/地点库 - 精确匹配条目
  // ============================================================================
  {
    entryPattern: /^\[(物品|法宝|功法|势力|地点|灵根|体质)\]\s*(.+)$/,
    shouldEnable: (ctx, entryName) => {
      if (!entryName) return false;
      const match = entryName.match(/^\[(物品|法宝|功法|势力|地点|灵根|体质)\]\s*(.+)$/);
      if (!match) return false;

      const category = match[1];
      const itemName = match[2].trim();

      // 精确匹配：物品名必须在消息中完整出现
      const escaped = itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const itemRegex = new RegExp(escaped, 'u');

      // 检查最近消息中是否提到
      const mentionCount = ctx.recentMessages.filter(msg => itemRegex.test(msg)).length;

      // 至少提到2次才启用（避免误触发）
      const shouldEnable = mentionCount >= 2;

      if (CONFIG.DEBUG && mentionCount > 0) {
        console.log(`[动态世界书] ${category}匹配: ${itemName}, 提及次数=${mentionCount}, 启用=${shouldEnable}`);
      }

      return shouldEnable;
    },
    priority: 5,
  },
];

type WorldbookEntrySnapshot = {
  enabled: boolean;
  name: string;
  strategyType: string;
};

function createEmptyContext(): Context {
  return {
    currentRegion: '',
    currentLayer: '',
    environmentDesc: '',
    recentMessages: [],
    recentCharacterMessages: [],
    mvuData: null,
  };
}

function getSortedRules(): WorldbookRule[] {
  return [...RULES].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function findMatchingRule(entryName: string, sortedRules = getSortedRules()): WorldbookRule | null {
  for (const rule of sortedRules) {
    const matches =
      typeof rule.entryPattern === 'string' ? entryName.includes(rule.entryPattern) : rule.entryPattern.test(entryName);

    if (matches) {
      return rule;
    }
  }

  return null;
}

function buildRuleDecision(ctx: Context, entryName: string, rule: WorldbookRule): EntryDecisionResult | null {
  try {
    const matched = rule.shouldEnable(ctx, entryName);
    return {
      matched,
      category: getEntryCategoryLabel(entryName),
      score: matched ? 18 : 0,
      threshold: 1,
      reasons: [matched ? '命中布尔规则，判定应常亮' : '未命中布尔规则，本轮不常亮'],
      source: 'rule',
      forced: '',
    };
  } catch (error) {
    console.error(`[动态世界书] 评估条目 "${entryName}" 时出错:`, error);
    return null;
  }
}

function resolveManagedDecision(
  ctx: Context,
  entryName: string,
  sortedRules = getSortedRules(),
): { decision: EntryDecisionResult; matchedRule: WorldbookRule | null } | null {
  let matchedRule: WorldbookRule | null = null;
  let decision = getSpecializedDecision(ctx, entryName);

  if (!decision) {
    matchedRule = findMatchingRule(entryName, sortedRules);
    if (matchedRule) {
      decision = buildRuleDecision(ctx, entryName, matchedRule);
    }
  }

  if (!decision) return null;

  return {
    decision,
    matchedRule,
  };
}

function resolveManagedWorldbookName(): string {
  let worldbookName = CONFIG.WORLDBOOK_NAME;
  if (worldbookName === 'current') {
    const charWorldbooks = getCharWorldbookNames('current');
    worldbookName = charWorldbooks.primary || '';
  }
  return worldbookName;
}

async function readWorldbookSnapshot(worldbookName: string): Promise<WorldbookEntrySnapshot[]> {
  let snapshot: WorldbookEntrySnapshot[] = [];

  await updateWorldbookWith(worldbookName, worldbook => {
    snapshot = worldbook.map(entry => ({
      enabled: Boolean(entry.enabled),
      name: String(entry.name || ''),
      strategyType: String(entry.strategy?.type || ''),
    }));
    return worldbook;
  });

  return snapshot;
}

function getKnownMappedMapNames(): Set<string> {
  const mapped = new Set<string>();

  Object.values(REGION_TO_MAP).forEach(names => names.forEach(name => mapped.add(name)));
  Object.values(DOMAIN_TO_MAP).forEach(names => names.forEach(name => mapped.add(name)));
  Object.values(KEYWORD_TO_MAP).forEach(names => names.forEach(name => mapped.add(name)));
  Object.values(LAYER_TO_DEFAULT_MAP).forEach(name => mapped.add(name));
  Object.keys(MAP_ENTRY_ALIAS_TO_CANONICAL).forEach(name => mapped.add(name));
  Object.values(MAP_ENTRY_ALIAS_TO_CANONICAL).forEach(name => mapped.add(name));

  return mapped;
}

function getCharacterEntryMainName(entryName: string): string | null {
  const stageMatch = parseCharacterStageEntry(entryName);
  if (stageMatch) {
    return resolveCharacterEntryTarget(stageMatch.characterName).mainCharacterName;
  }

  const baseMatch = entryName.match(/^\[角色\]\s*([^-]+)$/);
  if (baseMatch) {
    return resolveCharacterEntryTarget(baseMatch[1].trim()).mainCharacterName;
  }

  return null;
}

function isBaseCharacterEntry(entryName: string): boolean {
  return /^\[角色\]\s*([^-]+)$/.test(entryName);
}

function shouldKeepBaseCharacterEntryWarm(ctx: Context, entryName: string): boolean {
  if (!isBaseCharacterEntry(entryName)) {
    return false;
  }

  const mainCharacterName = getCharacterEntryMainName(entryName);
  if (!mainCharacterName) {
    return false;
  }

  return Boolean(ctx.mvuData?.红颜?.[mainCharacterName]);
}

function buildDiagnosticsReport(entries: WorldbookEntrySnapshot[], ctx: Context | null): DynamicWorldbookDiagnostics {
  const sortedRules = getSortedRules();
  const emptyContext = createEmptyContext();
  const knownMappedMaps = getKnownMappedMapNames();
  const existingEntryNames = new Set(entries.map(entry => entry.name).filter(Boolean));
  const managedEntries: string[] = [];
  const unmanagedEntries: string[] = [];
  const unmappedMapEntries: string[] = [];
  const unknownCharacterEntries: string[] = [];

  let mapEntries = 0;
  let characterEntries = 0;

  for (const entry of entries) {
    if (!entry.enabled || !entry.name) continue;

    const managedDecision = resolveManagedDecision(emptyContext, entry.name, sortedRules);
    if (managedDecision) {
      managedEntries.push(entry.name);
    } else {
      unmanagedEntries.push(entry.name);
    }

    const mapMatch = entry.name.match(/^\[地图\]\s*(.+)$/);
    if (mapMatch) {
      mapEntries++;
      const canonicalMapName = MAP_ENTRY_ALIAS_TO_CANONICAL[mapMatch[1].trim()] ?? mapMatch[1].trim();
      if (canonicalMapName !== '世界空间结构' && !knownMappedMaps.has(canonicalMapName)) {
        unmappedMapEntries.push(entry.name);
      }
    }

    const characterMainName = getCharacterEntryMainName(entry.name);
    if (characterMainName) {
      characterEntries++;
      const isKnownCharacter = Boolean(
        ctx?.mvuData?.红颜?.[characterMainName] || ctx?.mvuData?.红颜角色库?.[characterMainName],
      );
      if (ctx?.mvuData && !isKnownCharacter) {
        unknownCharacterEntries.push(entry.name);
      }
    }
  }

  const overrideConflicts = currentSettings.forced_enable_entries.filter(name =>
    currentSettings.forced_disable_entries.includes(name),
  );
  const orphanOverrideEntries = [
    ...currentSettings.forced_enable_entries,
    ...currentSettings.forced_disable_entries,
  ].filter(name => !existingEntryNames.has(name));

  return {
    checkedAt: Date.now(),
    totalEntries: entries.filter(entry => entry.enabled && entry.name).length,
    managedEntries: managedEntries.length,
    unmanagedEntries: unmanagedEntries.length,
    mapEntries,
    characterEntries,
    unmappedMapEntries: Array.from(new Set(unmappedMapEntries)).slice(0, 12),
    unknownCharacterEntries: Array.from(new Set(unknownCharacterEntries)).slice(0, 12),
    unmanagedSamples: unmanagedEntries.slice(0, 12),
    overrideConflicts: Array.from(new Set(overrideConflicts)).slice(0, 12),
    orphanOverrideEntries: Array.from(new Set(orphanOverrideEntries)).slice(0, 12),
  };
}

function buildPreviewContext(baseContext: Context | null, input: DynamicWorldbookPreviewInput): Context {
  const recentMessages = input.recentMessages.map(message => String(message).trim()).filter(Boolean);

  return {
    currentRegion: String(input.currentRegion || baseContext?.currentRegion || '未知').trim() || '未知',
    currentLayer: String(input.currentLayer || baseContext?.currentLayer || '').trim(),
    environmentDesc: String(input.environmentDesc || baseContext?.environmentDesc || '').trim(),
    recentMessages: recentMessages.slice(-Math.max(CONFIG.CONTEXT_WINDOW, 1)),
    recentCharacterMessages: recentMessages.slice(-Math.max(CONFIG.CHARACTER_CONTEXT_WINDOW, 1)),
    mvuData: baseContext?.mvuData ?? null,
  };
}

async function runPreviewAnalysis(input: DynamicWorldbookPreviewInput) {
  const baseContext = await getContext();
  const context = buildPreviewContext(baseContext, input);
  const worldbookName = resolveManagedWorldbookName();
  if (!worldbookName) {
    throw new Error('当前角色卡没有绑定主世界书');
  }

  const entries = await readWorldbookSnapshot(worldbookName);
  const sortedRules = getSortedRules();
  const decisionTraces = entries
    .filter(entry => entry.enabled && entry.name)
    .map(entry => {
      const result = resolveManagedDecision(context, entry.name, sortedRules);
      if (!result) return null;
      return buildDecisionTrace(entry.name, result.decision);
    })
    .filter((trace): trace is DynamicWorldbookDecisionTrace => Boolean(trace));

  return {
    worldbookName,
    context,
    topScoredEntries: [...decisionTraces]
      .filter(trace => trace.score > 0 || trace.forced !== '')
      .sort((a, b) => b.score - a.score)
      .slice(0, 16),
    matchedEntries: decisionTraces
      .filter(trace => trace.matched)
      .sort((a, b) => b.score - a.score)
      .map(trace => trace.name)
      .slice(0, 24),
  };
}

// ============================================================================
// 动态世界书核心逻辑
// ============================================================================

type UpdateMode = 'enable' | 'disable';

type UpdateRequest = {
  mode: UpdateMode;
  force: boolean;
  reason: string;
  allowWhenDisabled?: boolean;
  latestMessageHint?: string;
};

let isProcessing = false;
let lastProcessTime = 0;
let queuedUpdate: UpdateRequest | null = null;
let pendingUserInputHint = '';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeContextMessage(content: string): string {
  let result = content || '';

  // 移除不应作为剧情内容的各种标记和代码块
  result = result.replace(/\[动态世界书\][^\n]*/g, '');
  result = result.replace(/【[^】]*】/g, '');
  result = result.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/g, '');
  result = result.replace(/```mvu_update[\s\S]*?```/g, '');
  result = result.replace(/```[\s\S]*?```/g, '');

  return result.trim();
}

function mergeLatestMessageHint(
  recentMessages: string[],
  latestMessageHint?: string,
  windowSize = CONFIG.CONTEXT_WINDOW,
): string[] {
  const hint = sanitizeContextMessage(latestMessageHint || '');
  if (!hint) {
    return recentMessages;
  }

  const trimmedMessages = recentMessages.filter(Boolean);
  if (trimmedMessages.at(-1) === hint) {
    return trimmedMessages;
  }

  return [...trimmedMessages, hint].slice(-Math.max(windowSize, 1));
}

async function readMessageTextById(messageId: number, retries = 4, waitMs = 25): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const message = getChatMessages(messageId, { role: 'user' })[0];
    const text = sanitizeContextMessage(message?.message || '');
    if (text) {
      return text;
    }

    if (attempt < retries) {
      await delay(waitMs);
    }
  }

  return readLatestUserContextHint() || readDraftInputText();
}

function readDraftInputText(): string {
  const textarea = $('#send_textarea').get(0) as HTMLTextAreaElement | undefined;
  return sanitizeContextMessage(textarea?.value || '');
}

function isUserRoleMessage(message: any): boolean {
  return (
    message?.role === 'user' || message?.is_user === true || message?.is_user === 'true' || message?.mes === 'user'
  );
}

function readLatestUserContextHint(
  windowSize = Math.max(CONFIG.CHARACTER_CONTEXT_WINDOW, CONFIG.CONTEXT_WINDOW, 10),
): string {
  try {
    const lastMessageId = getLastMessageId();
    if (lastMessageId < 0) {
      return '';
    }

    const messages = getChatMessages(`0-${lastMessageId}`);
    if (!Array.isArray(messages) || messages.length === 0) {
      return '';
    }

    const recentMessages = messages.slice(-Math.max(windowSize, 1));
    for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
      const message = recentMessages[index];
      if (!isUserRoleMessage(message)) {
        continue;
      }

      const text = sanitizeContextMessage(message?.message || '');
      if (text) {
        return text;
      }
    }
  } catch (error) {
    if (CONFIG.DEBUG) {
      console.warn('[动态世界书] 读取最近一条用户消息失败', error);
    }
  }

  return '';
}

async function waitForUpdatePipelineIdle(timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (isProcessing || queuedUpdate) {
    if (Date.now() - startedAt >= timeoutMs) {
      if (CONFIG.DEBUG) {
        console.warn('[动态世界书] 等待更新管线空闲超时，继续执行强制刷新');
      }
      return;
    }
    await delay(20);
  }
}

function queueNextUpdate(nextRequest: UpdateRequest) {
  if (!queuedUpdate) {
    queuedUpdate = nextRequest;
    return;
  }

  // 关键更新优先；如果当前排队的不是关键更新，则始终使用最新请求覆盖。
  if (nextRequest.force || !queuedUpdate.force) {
    queuedUpdate = nextRequest;
  }
}

/**
 * 安全地等待 MVU 初始化,带超时机制
 */
async function waitForMvu(): Promise<boolean> {
  try {
    // 创建超时 Promise
    const timeoutPromise = new Promise<boolean>(resolve => {
      setTimeout(() => resolve(false), CONFIG.MVU_INIT_TIMEOUT);
    });

    // 创建初始化 Promise
    const initPromise = (async () => {
      await waitGlobalInitialized('Mvu');
      return true;
    })();

    // 竞速,返回先完成的
    return await Promise.race([initPromise, timeoutPromise]);
  } catch (e) {
    console.warn('[动态世界书] MVU 初始化等待失败', e);
    return false;
  }
}

async function getContext(latestMessageHint?: string): Promise<Context | null> {
  // 安全地等待 MVU 初始化
  const mvuReady = await waitForMvu();
  if (!mvuReady) {
    if (CONFIG.DEBUG) {
      console.log('[动态世界书] MVU 未就绪,跳过本次更新');
    }
    return null;
  }

  // 获取最近的消息（安全地获取，避免消息数不足导致错误）
  let recentMessages: string[] = [];
  let recentCharacterMessages: string[] = [];
  try {
    const lastMessageId = getLastMessageId();
    if (lastMessageId >= 0) {
      const allMessages = getChatMessages(`0-${lastMessageId}`);
      if (allMessages && allMessages.length > 0) {
        const sanitizedMessages = allMessages
          .map(m => sanitizeContextMessage(m.message || ''))
          .filter(msg => msg.length > 0);

        recentMessages = sanitizedMessages.slice(-CONFIG.CONTEXT_WINDOW);
        recentCharacterMessages = sanitizedMessages.slice(-CONFIG.CHARACTER_CONTEXT_WINDOW);

        if (CONFIG.DEBUG) {
          console.log(`[动态世界书] 🔍 过滤后的消息内容:`, recentMessages);
          console.log(`[动态世界书] 💗 红颜检测消息 (${recentCharacterMessages.length}条):`, recentCharacterMessages);
        }
      }
    }
  } catch (e) {
    if (CONFIG.DEBUG) {
      console.warn('[动态世界书] 获取消息失败', e);
    }
    recentMessages = [];
    recentCharacterMessages = [];
  }

  recentMessages = mergeLatestMessageHint(recentMessages, latestMessageHint);
  recentCharacterMessages = mergeLatestMessageHint(
    recentCharacterMessages,
    latestMessageHint,
    CONFIG.CHARACTER_CONTEXT_WINDOW,
  );

  // 获取 MVU 数据
  let mvuData: ReturnType<typeof Schema.parse> | null = null;
  try {
    const lastMessageId = getLastMessageId();
    if (lastMessageId >= 0) {
      const variables = getVariables({ type: 'message', message_id: -1 });
      const statData = _.get(variables, 'stat_data', null);
      if (statData) {
        mvuData = Schema.parse(statData);
      }
    }

    if (!mvuData) {
      if (CONFIG.DEBUG) {
        console.log('[动态世界书] MVU 数据未就绪,跳过本次更新');
      }
      return null;
    }
  } catch (e) {
    console.warn('[动态世界书] 获取 MVU 数据失败', e);
    return null;
  }

  const currentRegion = mvuData?.本尊?.行踪?.当前区域 ?? '未知';
  const currentLayer = mvuData?.本尊?.行踪?.所属层级 ?? '';
  const environmentDesc = mvuData?.本尊?.行踪?.环境描述 ?? '';

  if (CONFIG.DEBUG) {
    console.log(
      `[动态世界书] 上下文: 区域="${currentRegion}", 层级="${currentLayer}", 消息数=${recentMessages.length}`,
    );
  }

  return {
    currentRegion,
    currentLayer,
    environmentDesc,
    recentMessages,
    recentCharacterMessages,
    mvuData,
  };
}

async function refreshRuntimeState(reason = 'PANEL_REFRESH_CONTEXT') {
  const context = await getContext();
  if (!context) {
    return updateRuntimeSnapshot({
      lastReason: reason,
      lastUpdatedAt: Date.now(),
      lastMessage: '上下文未就绪，暂时无法生成运行态快照',
      context: null,
    });
  }

  const sectPromptState = deriveSectPromptState(context);
  return updateRuntimeSnapshot({
    lastReason: reason,
    lastUpdatedAt: Date.now(),
    lastMessage: '已同步最新上下文快照',
    context: buildContextSnapshot(context, sectPromptState),
  });
}

/**
 * 更新世界书条目
 * @param mode 'enable' - 用户输入前启用相关条目; 'disable' - AI回复后禁用非核心条目
 */
async function updateWorldbookEntries(mode: UpdateMode = 'enable', options: Partial<UpdateRequest> = {}) {
  const request: UpdateRequest = {
    mode,
    force: options.force ?? false,
    reason: options.reason ?? 'unknown',
    allowWhenDisabled: options.allowWhenDisabled ?? false,
    latestMessageHint: options.latestMessageHint ?? '',
  };

  if (!currentSettings.enabled && !request.allowWhenDisabled) {
    const message = '动态世界书已停用，跳过自动刷新';
    if (CONFIG.DEBUG) {
      console.log(`[动态世界书] ${message}: ${request.reason}`);
    }
    return updateRuntimeSnapshot({
      lastReason: request.reason,
      lastMode: mode,
      lastUpdatedAt: Date.now(),
      lastMessage: message,
      processing: false,
      pendingReason: '',
      queuedReason: '',
      settings: getRuntimeSettingsSnapshot(),
    });
  }

  if (!shouldAutoApply() && !request.allowWhenDisabled) {
    const message = '自动应用已关闭，本次仅保持面板状态';
    if (CONFIG.DEBUG) {
      console.log(`[动态世界书] ${message}: ${request.reason}`);
    }
    return updateRuntimeSnapshot({
      lastReason: request.reason,
      lastMode: mode,
      lastUpdatedAt: Date.now(),
      lastMessage: message,
      processing: false,
      pendingReason: '',
      queuedReason: '',
      settings: getRuntimeSettingsSnapshot(),
    });
  }

  // 防抖处理 - 避免频繁触发；关键生成前刷新不受防抖限制
  const now = Date.now();
  if (!request.force && now - lastProcessTime < CONFIG.DEBOUNCE_DELAY) {
    if (CONFIG.DEBUG) {
      console.log(`[动态世界书] 触发过于频繁,跳过本次更新: ${request.reason}`);
    }
    return updateRuntimeSnapshot({
      lastReason: request.reason,
      lastMode: mode,
      lastUpdatedAt: Date.now(),
      lastMessage: `触发过于频繁，已跳过 ${request.reason}`,
      processing: false,
      pendingReason: '',
      queuedReason: queuedUpdate?.reason ?? '',
    });
  }

  if (isProcessing) {
    queueNextUpdate(request);
    if (CONFIG.DEBUG) {
      console.log(`[动态世界书] 正在处理中，已排队等待下一次更新: ${request.reason}`);
    }
    return updateRuntimeSnapshot({
      queuedReason: queuedUpdate?.reason ?? request.reason,
      lastMessage: `已有任务在执行，已将 ${request.reason} 排队`,
    });
  }

  lastProcessTime = now;
  isProcessing = true;
  updateRuntimeSnapshot({
    processing: true,
    pendingReason: request.reason,
    queuedReason: queuedUpdate?.reason ?? '',
    lastReason: request.reason,
    lastMode: mode,
    lastUpdatedAt: Date.now(),
    lastError: '',
    lastMessage: `开始执行 ${request.reason}`,
    settings: getRuntimeSettingsSnapshot(),
  });

  try {
    const context = await getContext(request.latestMessageHint);

    // 如果上下文获取失败(MVU未初始化),直接返回,不报错
    if (!context) {
      if (CONFIG.DEBUG) {
        console.log('[动态世界书] 上下文未就绪,跳过本次更新');
      }
      return updateRuntimeSnapshot({
        processing: false,
        pendingReason: '',
        lastReason: request.reason,
        lastMode: mode,
        lastUpdatedAt: Date.now(),
        lastMessage: '上下文未就绪，本次未执行世界书更新',
        context: null,
      });
    }

    const sectPromptState = syncSectPromptState(context);
    decayStickyHeat(mapStickyHeat);
    decayStickyHeat(characterStickyHeat);

    // 获取世界书名称
    const worldbookName = resolveManagedWorldbookName();
    if (!worldbookName) {
      console.warn('[动态世界书] 当前角色卡没有绑定主世界书');
      return updateRuntimeSnapshot({
        processing: false,
        pendingReason: '',
        lastReason: request.reason,
        lastMode: mode,
        lastUpdatedAt: Date.now(),
        lastMessage: '当前角色卡没有绑定主世界书',
        lastError: '当前角色卡没有绑定主世界书',
        context: buildContextSnapshot(context, sectPromptState),
      });
    }

    let enabledCount = 0;
    let disabledCount = 0;
    let totalProcessed = 0;
    let activeEntries: string[] = [];
    const changedEntries: DynamicWorldbookEntryChange[] = [];
    const decisionTraces: DynamicWorldbookDecisionTrace[] = [];

    // 按优先级排序规则
    const sortedRules = getSortedRules();

    // 使用 updateWorldbookWith 更新世界书
    await updateWorldbookWith(worldbookName, worldbook => {
      if (CONFIG.DEBUG) {
        console.log(`[动态世界书] 开始处理世界书 [${mode}模式]: ${worldbookName}, 共 ${worldbook.length} 个条目`);
        console.log(
          `[动态世界书] 当前上下文: 区域="${context.currentRegion}", 等级=${context.mvuData?.本尊?.等级 ?? '未知'}, 消息数=${context.recentMessages.length}`,
        );
        console.log(
          `[动态世界书] 当前宗门推断: 域="${sectPromptState.domainName || '无'}", 主势力="${sectPromptState.factionName || '无'}"`,
        );
      }

      for (const entry of worldbook) {
        // 【关键修改】不跳过未启用的条目，因为我们要管理所有条目
        // 但条目本身必须是 enabled: true 才能被酒馆加载
        if (!entry.enabled) {
          continue;
        }

        const entryName = entry.name || '';
        if (!entryName) {
          if (CONFIG.DEBUG) {
            console.warn('[动态世界书] 发现无名称条目，跳过');
          }
          continue;
        }

        const resolvedDecision = resolveManagedDecision(context, entryName, sortedRules);

        // 【关键修改】如果没有匹配的规则，说明这个条目不受动态管理
        // 对于不受管理的条目，保持其原有状态
        if (!resolvedDecision) {
          continue;
        }

        let decision = resolvedDecision.decision;

        const currentType = entry.strategy.type;

        // 根据模式决定操作
        if (mode === 'enable') {
          decisionTraces.push(buildDecisionTrace(entryName, decision));

          // 【关键修复】始终检查核心条目，避免误关闭
          const isAlwaysOn =
            /^\[系统\]/.test(entryName) ||
            /^\[mvu_update\]/.test(entryName) ||
            /^\[mvu\]变量列表$/.test(entryName) ||
            /^\[红颜索引\]$/.test(entryName);
          const shouldKeepWarmCharacterBlue =
            decision.category === '角色' && shouldKeepBaseCharacterEntryWarm(context, entryName);

          // 精准控制：符合条件的开启，不符合条件的关闭
          if (decision.matched && currentType !== 'constant') {
            // 绿灯 → 蓝灯
            entry.strategy.type = 'constant';
            enabledCount++;
            totalProcessed++;
            changedEntries.push({ name: entryName, from: currentType, to: 'constant', mode });
            if (CONFIG.DEBUG) {
              console.log(`[动态世界书] ✅ 开启(绿→蓝): ${entryName}`);
            }
          } else if (!decision.matched && currentType === 'constant' && !isAlwaysOn && !shouldKeepWarmCharacterBlue) {
            // 蓝灯 → 绿灯（但保留核心条目）
            entry.strategy.type = 'selective';
            disabledCount++;
            totalProcessed++;
            changedEntries.push({ name: entryName, from: currentType, to: 'selective', mode });
            if (CONFIG.DEBUG) {
              console.log(`[动态世界书] ⚠️ 关闭(蓝→绿): ${entryName}`);
            }
          } else if (!decision.matched && currentType === 'constant' && shouldKeepWarmCharacterBlue && CONFIG.DEBUG) {
            console.log(`[动态世界书] ♨️ 保温保留基础角色蓝灯: ${entryName}`);
          }
        } else if (currentType === 'constant') {
          decisionTraces.push(buildDecisionTrace(entryName, decision));
          // 禁用模式：根据策略决定是否保留
          let shouldKeepEnabled: boolean;

          // 根据策略决定是否保留
          if (decision.forced === 'enable') {
            shouldKeepEnabled = true;
          } else if (decision.forced === 'disable') {
            shouldKeepEnabled = false;
          } else {
            const shouldKeepMatchedCharacterStage = decision.category === '角色阶段' && decision.matched;
            shouldKeepEnabled =
              CONFIG.KEEP_ENABLED_AFTER_REPLY.some(pattern => pattern.test(entryName)) ||
              (decision.category === '角色' && shouldKeepBaseCharacterEntryWarm(context, entryName)) ||
              shouldKeepMatchedCharacterStage;
          }

          if (!shouldKeepEnabled) {
            entry.strategy.type = 'selective';
            disabledCount++;
            totalProcessed++;
            changedEntries.push({ name: entryName, from: currentType, to: 'selective', mode });
            if (CONFIG.DEBUG) {
              console.log(`[动态世界书] ⚠️ 改为绿灯: ${entryName}`);
            }
          }
        }
      }

      activeEntries = worldbook
        .filter(entry => entry.enabled && entry.strategy.type === 'constant' && entry.name)
        .map(entry => entry.name!);

      if (CONFIG.DEBUG) {
        console.log(
          `[动态世界书] 处理完成 [${mode}模式]，修改 ${totalProcessed} 个条目 (启用 ${enabledCount} 个, 禁用 ${disabledCount} 个)`,
        );
      }

      return worldbook;
    });

    refreshStickyHeatsFromEntries(activeEntries);
    const topScoredEntries = [...decisionTraces]
      .filter(trace => trace.score > 0 || trace.forced !== '')
      .sort((a, b) => b.score - a.score)
      .slice(0, 16);

    // 输出更新摘要
    if (enabledCount > 0 || disabledCount > 0) {
      const modeText = mode === 'enable' ? '准备AI回复' : 'AI回复完成';
      const message = `${modeText}: 启用 ${enabledCount} 个, 禁用 ${disabledCount} 个`;
      console.info(`[动态世界书] ${message}`);
      if (CONFIG.DEBUG && shouldShowToasts()) {
        toastr.info(message, '动态世界书');
      }
    } else if (CONFIG.DEBUG) {
      console.log(`[动态世界书] 本次无需更新条目状态 [${mode}模式]`);
    }

    return updateRuntimeSnapshot({
      processing: false,
      pendingReason: '',
      queuedReason: queuedUpdate?.reason ?? '',
      worldbookName,
      lastReason: request.reason,
      lastMode: mode,
      lastUpdatedAt: Date.now(),
      lastMessage: `已完成 ${request.reason}，共处理 ${totalProcessed} 个条目`,
      lastError: '',
      settings: getRuntimeSettingsSnapshot(),
      context: buildContextSnapshot(context, sectPromptState),
      summary: {
        enabledCount,
        disabledCount,
        totalProcessed,
        activeEntries,
        changedEntries,
        decisionTraces,
        topScoredEntries,
      },
    });
  } catch (e) {
    // 只在非初始化错误时报告
    if (!(e instanceof Error && e.message.includes('MVU')) && !(e instanceof Error && e.message.includes('初始化'))) {
      console.error('[动态世界书] 更新失败', e);
      if (CONFIG.DEBUG && shouldShowToasts()) {
        toastr.error(`更新失败: ${e instanceof Error ? e.message : '未知错误'}`, '动态世界书');
      }
    } else if (CONFIG.DEBUG) {
      console.log('[动态世界书] MVU 相关错误,可能是正在初始化,跳过');
    }
    return updateRuntimeSnapshot({
      processing: false,
      pendingReason: '',
      queuedReason: queuedUpdate?.reason ?? '',
      lastReason: request.reason,
      lastMode: mode,
      lastUpdatedAt: Date.now(),
      lastMessage: `执行 ${request.reason} 失败`,
      lastError: e instanceof Error ? e.message : '未知错误',
    });
  } finally {
    isProcessing = false;

    const nextRequest = queuedUpdate;
    queuedUpdate = null;
    updateRuntimeSnapshot({
      processing: false,
      pendingReason: '',
      queuedReason: nextRequest?.reason ?? '',
    });
    if (nextRequest) {
      if (CONFIG.DEBUG) {
        console.log(`[动态世界书] 执行排队中的更新: ${nextRequest.reason}`);
      }
      void updateWorldbookEntries(nextRequest.mode, nextRequest);
    }
  }
}

async function runDiagnosticsState(reason = 'PANEL_RUN_DIAGNOSTICS') {
  try {
    const context = await getContext();
    const worldbookName = resolveManagedWorldbookName();

    if (!worldbookName) {
      return updateRuntimeSnapshot({
        lastReason: reason,
        lastUpdatedAt: Date.now(),
        lastMessage: '当前角色卡没有绑定主世界书，无法执行体检',
        lastError: '当前角色卡没有绑定主世界书',
        diagnostics: null,
      });
    }

    const entries = await readWorldbookSnapshot(worldbookName);
    const diagnostics = buildDiagnosticsReport(entries, context);
    const sectPromptState = context ? deriveSectPromptState(context) : { domainName: '', factionName: '' };

    return updateRuntimeSnapshot({
      worldbookName,
      lastReason: reason,
      lastUpdatedAt: Date.now(),
      lastMessage: `已完成世界书体检，扫描 ${diagnostics.totalEntries} 个启用条目`,
      lastError: '',
      settings: getRuntimeSettingsSnapshot(),
      context: context ? buildContextSnapshot(context, sectPromptState) : null,
      diagnostics,
    });
  } catch (error) {
    return updateRuntimeSnapshot({
      lastReason: reason,
      lastUpdatedAt: Date.now(),
      lastMessage: '世界书体检失败',
      lastError: error instanceof Error ? error.message : '未知错误',
    });
  }
}

async function runPreviewState(input: DynamicWorldbookPreviewInput, reason = 'PANEL_RUN_PREVIEW') {
  try {
    const preview = await runPreviewAnalysis(input);
    const sectPromptState = deriveSectPromptState(preview.context);

    return updateRuntimeSnapshot({
      worldbookName: preview.worldbookName,
      lastReason: reason,
      lastUpdatedAt: Date.now(),
      lastMessage: `已完成沙盒预演，命中 ${preview.matchedEntries.length} 个条目`,
      lastError: '',
      settings: getRuntimeSettingsSnapshot(),
      context: buildContextSnapshot(preview.context, sectPromptState),
      preview: {
        checkedAt: Date.now(),
        input: {
          currentRegion: preview.context.currentRegion,
          currentLayer: preview.context.currentLayer,
          environmentDesc: preview.context.environmentDesc,
          recentMessages: preview.context.recentMessages,
        },
        matchedEntries: preview.matchedEntries,
        topScoredEntries: preview.topScoredEntries,
      },
    });
  } catch (error) {
    return updateRuntimeSnapshot({
      lastReason: reason,
      lastUpdatedAt: Date.now(),
      lastMessage: '沙盒预演失败',
      lastError: error instanceof Error ? error.message : '未知错误',
    });
  }
}

registerRuntimeActions({
  manualRefresh: async mode => {
    await updateWorldbookEntries(mode, {
      force: true,
      reason: `PANEL_MANUAL_${mode.toUpperCase()}`,
      allowWhenDisabled: true,
    });
    return getRuntimeSnapshot();
  },
  refreshSnapshot: async () => {
    await refreshRuntimeState();
    return getRuntimeSnapshot();
  },
  runDiagnostics: async () => {
    await runDiagnosticsState();
    return getRuntimeSnapshot();
  },
  runPreview: async input => {
    await runPreviewState(input);
    return getRuntimeSnapshot();
  },
});

// ============================================================================
// 初始化
// ============================================================================

$(() => {
  mountDynamicWorldbookPanel();
  updateRuntimeSnapshot({
    bootStatus: 'initializing',
    lastMessage: '扩展面板已挂载，准备初始化动态世界书引擎',
    settings: getRuntimeSettingsSnapshot(),
  });

  errorCatched(async () => {
    console.info('[动态世界书] 脚本已加载');
    console.info('[动态世界书] 当前策略: 默认最优');

    // 安全地等待 MVU 初始化
    const mvuReady = await waitForMvu();
    if (mvuReady) {
      console.info('[动态世界书] MVU 框架已初始化');
      updateRuntimeSnapshot({
        bootStatus: 'ready',
        lastMessage: 'MVU 框架已初始化，正在执行初始开灯',
      });

      // 延迟初始检查,确保所有数据都已就绪
      await delay(1500);
      await updateWorldbookEntries('enable', { force: true, reason: 'INITIAL_BOOTSTRAP' });
      console.info('[动态世界书] 初始化检查完成');
    } else {
      console.warn('[动态世界书] MVU 初始化超时,将在后续事件中尝试');
      updateRuntimeSnapshot({
        bootStatus: 'waiting_mvu',
        lastMessage: 'MVU 初始化超时，等待后续事件补齐上下文',
      });
    }

    // ========================================================================
    // 核心逻辑：用户输入前启用，AI回复后禁用
    // ========================================================================

    // 监听用户发送消息 - 立刻吃到这一条 user input，并在生成前先完成开灯
    eventMakeFirst(tavern_events.MESSAGE_SENT, async (message_id: number) => {
      pendingUserInputHint = await readMessageTextById(message_id);
      if (CONFIG.DEBUG) {
        console.log('[动态世界书] 🟢 用户发送消息，启用相关世界书条目', {
          message_id,
          latestInput: pendingUserInputHint,
        });
      }
      await waitForUpdatePipelineIdle();
      await updateWorldbookEntries('enable', {
        force: true,
        reason: 'MESSAGE_SENT',
        latestMessageHint: pendingUserInputHint,
      });
    });

    // 监听真正进入生成拼装前的时机，作为最终兜底，确保本轮生成前已经完成开灯
    eventMakeFirst(tavern_events.GENERATE_BEFORE_COMBINE_PROMPTS, async () => {
      const latestMessageHint = pendingUserInputHint || readLatestUserContextHint() || readDraftInputText();
      if (CONFIG.DEBUG) {
        console.log('[动态世界书] 🚦 生成前最终检查，强制刷新需要启用的世界书条目', {
          latestInput: latestMessageHint,
        });
      }
      await waitForUpdatePipelineIdle();
      await updateWorldbookEntries('enable', {
        force: true,
        reason: 'GENERATE_BEFORE_COMBINE_PROMPTS',
        latestMessageHint,
      });
    });

    // 监听重roll（切换swipe）- 相当于重新生成，需要启用相关条目
    eventOn(tavern_events.MESSAGE_SWIPED, async (message_id: number) => {
      if (CONFIG.DEBUG) {
        console.log(`[动态世界书] 🔄 消息 #${message_id} 重roll，启用相关世界书条目`);
      }
      // 【修复】延迟等待消息内容完全更新后再处理
      // MESSAGE_SWIPED 事件会在消息切换时立即触发，但消息内容可能还没更新完成
      await delay(300);
      await updateWorldbookEntries('enable', { force: true, reason: 'MESSAGE_SWIPED' });
    });

    // 监听 AI 消息接收完成 - AI 回复后禁用非核心条目以节省 token
    eventOn(tavern_events.MESSAGE_RECEIVED, async () => {
      if (CONFIG.DEBUG) {
        console.log('[动态世界书] 🔴 AI 回复完成，禁用非核心世界书条目');
      }
      pendingUserInputHint = '';
      // 延迟一小段时间，确保消息完全接收
      await delay(200);
      await updateWorldbookEntries('disable', { reason: 'MESSAGE_RECEIVED' });
    });

    // 监听消息删除 - 删除后重新评估上下文，避免重发前沿用旧的开灯结果
    eventOn(tavern_events.MESSAGE_DELETED, async (message_id: number) => {
      if (CONFIG.DEBUG) {
        console.log(`[动态世界书] 🗑️ 消息 #${message_id} 被删除，重新评估世界书条目`);
      }
      pendingUserInputHint = '';
      await delay(100);
      await updateWorldbookEntries('enable', { reason: 'MESSAGE_DELETED' });
    });

    // 监听消息编辑 - 编辑后的上下文可能直接改变需要开启的条目
    eventOn(tavern_events.MESSAGE_EDITED, async (message_id: number) => {
      if (CONFIG.DEBUG) {
        console.log(`[动态世界书] ✏️ 消息 #${message_id} 被编辑，重新评估世界书条目`);
      }
      pendingUserInputHint = '';
      await delay(100);
      await updateWorldbookEntries('enable', { reason: 'MESSAGE_EDITED' });
    });

    // ========================================================================
    // 辅助逻辑：聊天切换、变量更新等场景
    // ========================================================================

    // 监听聊天切换事件（新开聊天或切换聊天时触发）
    eventOn(tavern_events.CHAT_CHANGED, async () => {
      if (CONFIG.DEBUG) {
        console.log('[动态世界书] 触发事件: CHAT_CHANGED');
      }
      pendingUserInputHint = '';
      // 延迟时间增加到2秒,确保聊天和MVU完全加载
      await delay(2000);
      await updateWorldbookEntries('enable', { reason: 'CHAT_CHANGED' });
    });

    // 监听新建聊天事件
    eventOn(tavern_events.CHAT_CREATED, async () => {
      if (CONFIG.DEBUG) {
        console.log('[动态世界书] 触发事件: CHAT_CREATED');
      }
      pendingUserInputHint = '';
      // 延迟时间增加到2秒,确保聊天和MVU完全初始化
      await delay(2000);
      await updateWorldbookEntries('enable', { reason: 'CHAT_CREATED' });
    });

    // 监听角色页面加载完成事件（切换角色时触发）
    eventOn(tavern_events.CHARACTER_PAGE_LOADED, async () => {
      if (CONFIG.DEBUG) {
        console.log('[动态世界书] 触发事件: CHARACTER_PAGE_LOADED');
      }
      pendingUserInputHint = '';
      // 延迟时间增加到2秒,确保角色和MVU完全加载
      await delay(2000);
      await updateWorldbookEntries('enable', { reason: 'CHARACTER_PAGE_LOADED' });
    });

    // 监听 MVU 变量更新 - 变量更新后重新评估需要启用的条目
    // 注意: 这个事件会频繁触发,因此使用防抖机制
    // 只有在 MVU 初始化成功时才注册此监听器
    if (mvuReady) {
      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, async () => {
        if (CONFIG.DEBUG) {
          console.log('[动态世界书] 触发事件: VARIABLE_UPDATE_ENDED');
        }
        // 延迟100ms,避免在变量更新期间触发
        await delay(100);
        await updateWorldbookEntries('enable', { reason: 'VARIABLE_UPDATE_ENDED' });
      });
    }

    const strategyText = '默认最优模式';

    console.info(`[动态世界书] 监听器已设置，策略：${strategyText}`);
    if (mvuReady && shouldShowToasts()) {
      toastr.success(`动态世界书已启用 - ${strategyText}`, '灯火阑珊');
    } else if (shouldShowToasts()) {
      toastr.info(`动态世界书已加载，等待MVU初始化...`, '灯火阑珊');
    }
  })();
});

$(window).on('pagehide', () => {
  unmountDynamicWorldbookPanel();
});
