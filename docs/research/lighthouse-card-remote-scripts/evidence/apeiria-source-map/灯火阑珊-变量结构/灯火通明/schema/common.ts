// ============================================================================
// 踏月寻仙 - 共享 Schema（物品、神通、品阶映射）
// ============================================================================

import { z } from 'zod';
import {
  CULTIVATION_THRESHOLDS_BY_VERSION,
  REALM_LIFESPANS,
  REALM_NAMES,
  REALM_STAGES,
  REALM_THRESHOLDS,
} from './constants';
import { calculateBaseCombatPower } from './utils';

// 品阶容错映射
export const 品阶映射: Record<string, string> = {
  凡: '凡',
  凡阶: '凡',
  凡级: '凡',
  凡品: '凡',
  黄: '黄',
  黄阶: '黄',
  黄级: '黄',
  黄品: '黄',
  玄: '玄',
  玄阶: '玄',
  玄级: '玄',
  玄品: '玄',
  地: '地',
  地阶: '地',
  地级: '地',
  地品: '地',
  天: '天',
  天阶: '天',
  天级: '天',
  天品: '天',
  仙: '仙',
  仙阶: '仙',
  仙级: '仙',
  仙品: '仙',
  圣: '圣',
  圣阶: '圣',
  圣级: '圣',
  圣品: '圣',
  先天: '先天',
  先天阶: '先天',
  先天级: '先天',
};

// 熟练度容错映射
export const 熟练度映射: Record<string, string> = {
  入门: '入门',
  初级: '入门',
  初学: '入门',
  新手: '入门',
  熟练: '熟练',
  中级: '熟练',
  娴熟: '熟练',
  小成: '熟练',
  精通: '精通',
  高级: '精通',
  精湛: '精通',
  大成: '大成',
  大师: '大成',
  宗师: '大成',
  圆满: '圆满',
  完美: '圆满',
  极致: '圆满',
  化境: '化境',
  化神: '化境',
  返璞归真: '化境',
  出神入化: '化境',
};

function normalizeSkillProficiency(raw: unknown): string {
  const value = String(raw ?? '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  if (熟练度映射[value]) return 熟练度映射[value];
  if (value.includes('小成')) return '熟练';
  if (value.includes('中成')) return '精通';
  if (value.includes('大圆满')) return '圆满';
  return '入门';
}

// 物品 Schema
export const ItemSchema = z.object({
  名称: z.string().prefault(''),
  描述: z.string().prefault(''),
  品阶: z.string().prefault(''),
  数量: z.coerce
    .number()
    .transform(v => Math.max(0, v))
    .prefault(1),
});

const 灵石货币别名 = new Set(['灵石', '下品灵石']);

function normalizeSpiritStoneCurrencyName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '');
}

export function isSpiritStoneCurrencyItem(key: unknown, item?: { 名称?: unknown } | null): boolean {
  const candidates = [normalizeSpiritStoneCurrencyName(key), normalizeSpiritStoneCurrencyName(item?.名称)].filter(
    Boolean,
  );

  return candidates.some(candidate => 灵石货币别名.has(candidate));
}

export function extractSpiritStoneFromInventory<T extends { 名称?: unknown; 数量?: unknown }>(
  inventory: Record<string, T> | undefined,
): { inventory: Record<string, T>; spiritStone: number } {
  const nextInventory: Record<string, T> = {};
  let spiritStone = 0;

  for (const [key, item] of Object.entries(inventory ?? {})) {
    if (!item) continue;

    if (isSpiritStoneCurrencyItem(key, item)) {
      const amount = Number(item.数量);
      if (Number.isFinite(amount) && amount > 0) {
        spiritStone += amount;
      }
      continue;
    }

    nextInventory[key] = item;
  }

  return { inventory: nextInventory, spiritStone };
}

export function normalizeSpiritStoneState<T extends { 名称?: unknown; 数量?: unknown }>(
  spiritStone: unknown,
  ...inventories: Array<Record<string, T> | undefined>
): { spiritStone: number; inventories: Array<Record<string, T>> } {
  let nextSpiritStone = Number(spiritStone);
  if (!Number.isFinite(nextSpiritStone) || nextSpiritStone < 0) {
    nextSpiritStone = 0;
  }

  const normalizedInventories = inventories.map(inventory => {
    const normalized = extractSpiritStoneFromInventory(inventory);
    nextSpiritStone += normalized.spiritStone;
    return normalized.inventory;
  });

  return {
    spiritStone: nextSpiritStone,
    inventories: normalizedInventories,
  };
}

const 修炼阶段映射: Record<string, '修炼中' | '瓶颈中' | '突破中' | '稳固中' | '压境中'> = {
  修炼中: '修炼中',
  闭关: '修炼中',
  打坐: '修炼中',
  调息: '修炼中',
  瓶颈中: '瓶颈中',
  瓶颈期: '瓶颈中',
  卡关: '瓶颈中',
  受阻: '瓶颈中',
  突破中: '突破中',
  冲关: '突破中',
  破境: '突破中',
  尝试突破: '突破中',
  稳固中: '稳固中',
  巩固中: '稳固中',
  根基未稳: '稳固中',
  压境中: '压境中',
  压制境界: '压境中',
  藏锋养境: '压境中',
};

const 突破结果映射: Record<string, '无' | '成功' | '失败'> = {
  无: '无',
  '': '无',
  未突破: '无',
  成功: '成功',
  破境成功: '成功',
  渡过: '成功',
  失败: '失败',
  破境失败: '失败',
  冲关失败: '失败',
};

export const CultivationStateSchema = z
  .object({
    阶段: z
      .string()
      .transform(v => 修炼阶段映射[String(v).trim()] || '修炼中')
      .prefault('修炼中'),
    瓶颈原因: z.coerce
      .string()
      .transform(v => String(v).trim())
      .prefault(''),
    突破目标: z.coerce
      .string()
      .transform(v => String(v).trim())
      .prefault(''),
    上次结果: z
      .string()
      .transform(v => 突破结果映射[String(v).trim()] || '无')
      .prefault('无'),
  })
  .prefault({
    阶段: '修炼中',
    瓶颈原因: '',
    突破目标: '',
    上次结果: '无',
  });

export function describeRealmByLevel(level: number): string {
  const normalizedLevel = _.clamp(Math.floor(Number(level) || 1), 1, REALM_THRESHOLDS.length);
  const majorIdx = Math.floor((normalizedLevel - 1) / 4);
  const minorIdx = (normalizedLevel - 1) % 4;
  return `${REALM_NAMES[majorIdx] ?? '练气'}${REALM_STAGES[minorIdx] ?? '初期'}`;
}

function resolveRealmThresholds(versionOrLegacyFlag: number | boolean = 3): readonly number[] {
  if (versionOrLegacyFlag === true) {
    return CULTIVATION_THRESHOLDS_BY_VERSION[1];
  }

  if (versionOrLegacyFlag === false) {
    return CULTIVATION_THRESHOLDS_BY_VERSION[3];
  }

  const normalizedVersion = Math.max(1, Math.floor(Number(versionOrLegacyFlag) || 3));
  return (
    CULTIVATION_THRESHOLDS_BY_VERSION[normalizedVersion as keyof typeof CULTIVATION_THRESHOLDS_BY_VERSION] ??
    REALM_THRESHOLDS
  );
}

export function getRealmThreshold(level: number, versionOrLegacyFlag: number | boolean = 3): number {
  const thresholds = resolveRealmThresholds(versionOrLegacyFlag);
  const normalizedLevel = _.clamp(Math.floor(Number(level) || 1), 1, thresholds.length);
  return thresholds[normalizedLevel - 1] ?? thresholds[0] ?? 100;
}

export function migrateCultivationProgress(
  level: number,
  cultivation: unknown,
  fromVersion: number | boolean = 1,
  toVersion: number | boolean = 3,
): number {
  const normalizedCultivation = Number(cultivation);
  if (!Number.isFinite(normalizedCultivation) || normalizedCultivation <= 0) {
    return 0;
  }

  const previousThreshold = getRealmThreshold(level, fromVersion);
  const nextThreshold = getRealmThreshold(level, toVersion);
  if (previousThreshold <= 0 || previousThreshold === nextThreshold) {
    return Math.round(normalizedCultivation);
  }

  const progressRatio = normalizedCultivation / previousThreshold;
  const migrated = Math.round(progressRatio * nextThreshold);
  return Math.max(0, migrated);
}

export function migrateLegacyCultivationProgress(level: number, cultivation: unknown): number {
  return migrateCultivationProgress(level, cultivation, 1, 3);
}

export function normalizeCultivationState(
  rawState: unknown,
  options: {
    legacyAttemptBreakthrough?: boolean;
    level: number;
    cultivation: number;
  },
): z.output<typeof CultivationStateSchema> {
  const parsedState = CultivationStateSchema.parse(rawState ?? {});
  const threshold = getRealmThreshold(options.level);
  let phase = parsedState.阶段;

  if (options.legacyAttemptBreakthrough || phase === '突破中') {
    phase = '突破中';
  } else if (phase === '修炼中' && options.cultivation >= threshold) {
    phase = '瓶颈中';
  }

  const nextRealmTarget =
    options.level < REALM_THRESHOLDS.length ? describeRealmByLevel(options.level + 1) : parsedState.突破目标;
  const shouldHaveBreakthroughTarget = ['瓶颈中', '突破中', '压境中'].includes(phase);

  return {
    阶段: phase,
    瓶颈原因: shouldHaveBreakthroughTarget ? parsedState.瓶颈原因 : '',
    突破目标: shouldHaveBreakthroughTarget ? parsedState.突破目标 || nextRealmTarget : '',
    上次结果: parsedState.上次结果,
  };
}

export function getCultivationStatusLabel(
  state: Pick<z.output<typeof CultivationStateSchema>, '阶段'> | undefined,
  cultivation: number,
  threshold: number,
): string {
  const phase = state?.阶段 || '修炼中';
  if (phase === '突破中') return '突破中';
  if (phase === '稳固中') return '稳固中';
  if (phase === '压境中') return '压境中';
  if (phase === '瓶颈中' || cultivation >= threshold) return '瓶颈期';
  return '修炼中';
}

// 神通 Schema（本尊和红颜共用）
export const SkillSchema = z
  .object({
    名称: z.string().prefault(''),
    描述: z.string().prefault(''),
    类型: z.enum(['功法', '神通', '秘术']).prefault('神通'),
    品阶: z
      .string()
      .transform(v => 品阶映射[v] || '凡')
      .catch('凡'),
    熟练度: z
      .string()
      .transform(v => normalizeSkillProficiency(v))
      .catch('入门'),
    领悟时间: z.coerce.number().catch(() => Date.now()),
    威力等级: z.coerce.number().optional(),
  })
  .transform(skill => {
    // 仅当威力等级不存在或为0时才计算
    if (!skill.威力等级 || skill.威力等级 === 0) {
      const 品阶权重: Record<string, number> = { 凡: 1, 黄: 2, 玄: 3, 地: 4, 天: 5, 仙: 6, 圣: 7, 先天: 8 };
      const 熟练度权重: Record<string, number> = { 入门: 1, 熟练: 2, 精通: 3, 大成: 4, 圆满: 5, 化境: 6 };

      const 品阶值 = 品阶权重[skill.品阶] || 1;
      const 熟练值 = 熟练度权重[skill.熟练度] || 1;

      return {
        ...skill,
        威力等级: 品阶值 * 10 + 熟练值,
      };
    }
    return skill;
  });

// 背包类物品 Schema（自动过滤数量<=0的物品）
export const InventorySchema = z
  .record(z.string().describe('物品名'), ItemSchema)
  .prefault({})
  .transform(data => _.pickBy(data, ({ 数量 }) => 数量 > 0));

// 境界计算 transform（本尊和红颜共用）
export function computeRealmInfo(
  data: {
    等级: number;
    修为: number;
    已活岁月: number;
    尝试突破?: boolean;
    修炼状态?: Pick<z.output<typeof CultivationStateSchema>, '阶段'>;
    神通列表?: Record<string, { 威力等级?: number }>;
    体质?: string;
  },
  includesCombatPower: boolean = false,
) {
  const level = data.等级;
  const 突破阈值 = getRealmThreshold(level);
  const 寿元上限 = REALM_LIFESPANS[level - 1] ?? 100;
  const 境界描述 = describeRealmByLevel(level);
  const 寿元状态 = `${data.已活岁月}/${寿元上限}`;
  const 状态 = getCultivationStatusLabel(data.修炼状态, data.修为, 突破阈值);
  const progressRatio = 突破阈值 > 0 ? _.clamp(data.修为 / 突破阈值, 0, 1) : 0;
  const 进度 = `${(progressRatio * 100).toFixed(1)}%`;

  const base = { 突破阈值, 寿元上限, 境界描述, 寿元状态, 状态, 进度 };

  if (!includesCombatPower) return base;

  // 战力计算：境界基础（指数级） + 神通加成 + 体质加成
  const 境界战力 = calculateBaseCombatPower(level);
  const 神通列表 = Object.values(data.神通列表 || {});
  const 最高神通威力 = 神通列表.length > 0 ? Math.max(...神通列表.map(s => s.威力等级 || 0)) : 0;
  const 体质加成 = (() => {
    const 体质 = data.体质 || '';
    if (体质.includes('神')) return 500;
    if (体质.includes('圣')) return 200;
    if (体质.includes('道')) return 100;
    if (体质.includes('灵')) return 50;
    return 0;
  })();
  const 战力值 = 境界战力 + 最高神通威力 + 体质加成;

  return { ...base, 战力值 };
}
