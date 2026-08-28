// ============================================================================
// 踏月寻仙 - 系统 Schema（任务列表、声望系统、可参与机遇、当前处境）
// ============================================================================

import { z } from 'zod';
import { LOCATION_DOMAIN_VALUES } from '../map-system';
import { finiteNumber, NormalizedStringListSchema } from './common';

// 任务状态容错映射：兼容 AI 常见近义词，统一到三态
const 任务状态映射: Record<string, '进行中' | '已完成' | '已失败'> = {
  进行中: '进行中',
  进行: '进行中',
  处理中: '进行中',
  未完成: '进行中',
  待完成: '进行中',
  未开始: '进行中',
  已接取: '进行中',
  接取: '进行中',
  active: '进行中',

  已完成: '已完成',
  完成: '已完成',
  完成了: '已完成',
  已达成: '已完成',
  达成: '已完成',
  已结束: '已完成',
  结束: '已完成',
  done: '已完成',
  complete: '已完成',
  completed: '已完成',

  已失败: '已失败',
  失败: '已失败',
  失敗: '已失败',
  失败了: '已失败',
  中止: '已失败',
  终止: '已失败',
  放弃: '已失败',
  超时失败: '已失败',
  failed: '已失败',
  fail: '已失败',
};

// 任务类型容错映射：兼容 AI 常见写法，统一到任务系统支持的类型
const 任务类型映射: Record<string, '主线' | '支线' | '每日' | '临危受命' | '秘境探索'> = {
  主线: '主线',
  主任务: '主线',
  主线任务: '主线',
  main: '主线',

  支线: '支线',
  支线任务: '支线',
  side: '支线',
  sidequest: '支线',

  每日: '每日',
  日常: '每日',
  每日任务: '每日',
  daily: '每日',

  临危受命: '临危受命',
  紧急: '临危受命',
  紧急任务: '临危受命',
  urgent: '临危受命',

  秘境探索: '秘境探索',
  秘境: '秘境探索',
  探索: '秘境探索',
  秘境任务: '秘境探索',
  dungeon: '秘境探索',

  // “修炼任务”在当前 UI 语义上更接近支线，做保守归一
  修炼: '支线',
  修炼任务: '支线',
};

// 任务列表 Schema
export const QuestSchema = z.object({
  名称: z.string().prefault(''),
  类型: z
    .string()
    .transform(v => 任务类型映射[String(v).trim()] || '支线')
    .prefault('主线'),
  目标: z.string().prefault(''),
  状态: z
    .string()
    .transform(v => 任务状态映射[String(v).trim()] || '进行中')
    .prefault('进行中'),
  // 秘境专属字段（仅当类型为秘境探索时需要）
  秘境信息: z
    .object({
      域: z.enum(LOCATION_DOMAIN_VALUES).optional(),
      危: finiteNumber(0)
        .transform(v => _.clamp(v, 0, 100))
        .optional(),
      特: z.string().optional(),
      奖: NormalizedStringListSchema,
      限: z.string().optional(),
    })
    .optional(),
  创建时间: z
    .union([
      finiteNumber(Date.now()), // 兼容已有的时间戳
      z.string().transform(() => {
        // AI 输入修仙时间格式时，简化处理：直接用当前时间
        return Date.now();
      }),
    ])
    .prefault(() => Date.now()),
});

// 声望条目 Schema
export const ReputationEntrySchema = z.object({
  值: finiteNumber(0)
    .transform(v => _.clamp(v, -100, 100))
    .prefault(0),
  关系: z.string().prefault('陌生'),
  更新时间: finiteNumber(Date.now()).prefault(() => Date.now()),
});

// 声望系统 Schema（带自动关系计算 transform）
export const ReputationSystemSchema = z
  .record(z.string().describe('势力名'), ReputationEntrySchema)
  .prefault({})
  .transform(factions => {
    const autoRelationLabels = new Set([
      '陌生',
      '盟友',
      '友善',
      '友好',
      '中立偏好',
      '中立',
      '中立偏恶',
      '敌对',
      '仇恨',
      '不死不休',
    ]);

    // 自动根据声望值计算关系描述
    return _(factions)
      .mapValues(faction => {
        const value = faction.值;
        let 自动关系: string;

        if (value >= 80) {
          自动关系 = '盟友';
        } else if (value >= 60) {
          自动关系 = '友善';
        } else if (value >= 30) {
          自动关系 = '友好';
        } else if (value >= 10) {
          自动关系 = '中立偏好';
        } else if (value >= -10) {
          自动关系 = '中立';
        } else if (value >= -30) {
          自动关系 = '中立偏恶';
        } else if (value >= -60) {
          自动关系 = '敌对';
        } else if (value >= -80) {
          自动关系 = '仇恨';
        } else {
          自动关系 = '不死不休';
        }

        // 标准称谓视为派生值并随声望重算；剧情自定义称谓（如“真传弟子”）继续保留。
        const 最终关系 = faction.关系 && !autoRelationLabels.has(faction.关系) ? faction.关系 : 自动关系;

        return {
          ...faction,
          关系: 最终关系,
        };
      })
      .value();
  });

// 可参与机遇 Schema
export type OpportunityType = '探索' | '交涉' | '战斗' | '修炼' | '整备' | '亲密';

const 机遇类型映射: Record<string, OpportunityType> = {
  探索: '探索',
  行动: '探索',
  冒险: '探索',
  机缘: '探索',
  机遇: '探索',
  奇遇: '探索',
  秘境: '探索',
  寻宝: '探索',
  交涉: '交涉',
  结交: '交涉',
  交谈: '交涉',
  社交: '交涉',
  互动: '交涉',
  邀约: '交涉',
  邂逅: '交涉',
  战斗: '战斗',
  争夺: '战斗',
  挑战: '战斗',
  修炼: '修炼',
  整备: '整备',
  交易: '整备',
  采购: '整备',
  易物: '整备',
  买卖: '整备',
  红颜: '亲密',
  双修: '亲密',
  亲密: '亲密',
  调情: '亲密',
  explore: '探索',
  exploration: '探索',
  adventure: '探索',
  negotiate: '交涉',
  negotiation: '交涉',
  social: '交涉',
  interaction: '交涉',
  battle: '战斗',
  combat: '战斗',
  fight: '战斗',
  cultivate: '修炼',
  cultivation: '修炼',
  training: '修炼',
  prepare: '整备',
  preparation: '整备',
  supply: '整备',
  trade: '整备',
  intimate: '亲密',
  intimacy: '亲密',
  romance: '亲密',
};

const 机遇类型推断规则: Array<{ type: OpportunityType; pattern: RegExp }> = [
  {
    type: '亲密',
    pattern:
      /红颜|佳人|道侣|双修|温情|独处|相拥|相守|调情|缠绵|共寝|同眠|亲吻|亲密|忘忧|听雨|清弦|晚棠|云裳|梦杳泠|羽岚|羽岚烟|岚烟|朔璃鸢|阿鸢|血手飞鸢|朔望舒|赤月女帝|幽影宗主|虞汐|虞颜|虞汐颜/,
  },
  {
    type: '修炼',
    pattern: /修炼|闭关|打坐|吐纳|调息|冲关|破境|突破|压境|稳固|悟道|渡劫|根基|炼化|参悟/,
  },
  {
    type: '整备',
    pattern: /整备|修复|炼器|疗伤|丹药|灵阵|阵纹|坊市|易物|交易|买卖|采购|拍卖|商会|补给|售卖|收购|置换/,
  },
  {
    type: '战斗',
    pattern: /战斗|争夺|夺取|抢夺|截杀|斗法|厮杀|围攻|追杀|迎战|强敌|魔修|冲突|守擂|比斗/,
  },
  {
    type: '交涉',
    pattern: /交涉|交谈|结交|拜访|邀约|会面|结识|拉拢|试探|求见|访友|赴宴|询问|劝说|谈判|论道|同游/,
  },
  {
    type: '探索',
    pattern: /探索|探查|调查|追查|搜寻|寻找|寻路|赶路|潜入|护送|营救|赴约|秘境|线索|遗迹|洞穴/,
  },
];

function normalizeOpportunityText(value: unknown): string {
  return String(value ?? '').trim();
}

function inferOpportunityType(rawType: string, payload: Record<string, string>): OpportunityType {
  const mappedType = 机遇类型映射[normalizeOpportunityText(rawType).toLowerCase()];
  if (mappedType) return mappedType;

  const text = Object.values(payload)
    .map(value => normalizeOpportunityText(value))
    .filter(Boolean)
    .join('｜');

  for (const rule of 机遇类型推断规则) {
    if (rule.pattern.test(text)) return rule.type;
  }

  return '探索';
}

function buildLegacyOpportunityHint(timeLimit: string, risk: string): string {
  const parts = [
    /^(?:无|无时限|不限)$/u.test(timeLimit) ? '' : timeLimit,
    /^(?:无|无风险)$/u.test(risk) ? '' : risk,
  ].filter(Boolean);
  return _.uniq(parts).join(' · ');
}

function getOpportunityPatchIndex(value: unknown): number | null | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || '行动' in value || 'action' in value) {
    return undefined;
  }

  const wrapper = value as Record<string, unknown>;
  if (!['replace', 'insert'].includes(String(wrapper.op ?? '')) || !Object.hasOwn(wrapper, 'value')) {
    return undefined;
  }

  const normalizedPath = String(wrapper.path ?? '')
    .trim()
    .replace(/^\/+/u, '')
    .replace(/^stat_data[./]/u, '')
    .replaceAll('/', '.');
  if (normalizedPath === '$可参与机遇' || normalizedPath === '可参与机遇') return null;

  const indexMatch = /^\$?可参与机遇\.(\d+)$/u.exec(normalizedPath);
  return indexMatch ? Number(indexMatch[1]) : undefined;
}

function unwrapOpportunityPatchLayer(value: unknown): { changed: boolean; value: unknown } {
  const directIndex = getOpportunityPatchIndex(value);
  if (directIndex === null) {
    return { changed: true, value: (value as Record<string, unknown>).value };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { changed: false, value };
  }

  if (value.length === 1 && getOpportunityPatchIndex(value[0]) === null) {
    return { changed: true, value: (value[0] as Record<string, unknown>).value };
  }

  const indexedEntries = value.map(item => ({
    index: getOpportunityPatchIndex(item),
    value: (item as Record<string, unknown>)?.value,
  }));
  if (indexedEntries.some(entry => typeof entry.index !== 'number')) {
    return { changed: false, value };
  }

  return {
    changed: true,
    value: _(indexedEntries).sortBy('index').map('value').value(),
  };
}

function collectEmbeddedOpportunityItems(value: unknown, depth = 0): unknown[] {
  if (depth > 6) return [];
  if (Array.isArray(value)) {
    return value.flatMap(item => collectEmbeddedOpportunityItems(item, depth + 1));
  }
  if (!value || typeof value !== 'object') return [];

  const item = value as Record<string, unknown>;
  if (
    Object.hasOwn(item, '行动') ||
    Object.hasOwn(item, 'action') ||
    Object.hasOwn(item, '名称') ||
    Object.hasOwn(item, '描述')
  ) {
    return [item];
  }
  if (Object.hasOwn(item, 'value') && (Object.hasOwn(item, 'op') || Object.hasOwn(item, 'path'))) {
    return collectEmbeddedOpportunityItems(item.value, depth + 1);
  }
  return [];
}

/**
 * 兼容模型偶发生成的双重嵌套：
 * replace /$可参与机遇（兼容旧路径 /可参与机遇）的 value 内又放入整组或逐下标 patch 操作。
 */
export function unwrapOpportunityPatchPayload(value: unknown): unknown {
  let current = value;
  if (typeof current === 'string' && current.trimStart().startsWith('[')) {
    try {
      current = JSON.parse(current);
    } catch {
      return value;
    }
  }

  for (let depth = 0; depth < 4; depth += 1) {
    const layer = unwrapOpportunityPatchLayer(current);
    if (!layer.changed) break;
    current = layer.value;
  }

  const recoveredItems = collectEmbeddedOpportunityItems(current);
  return recoveredItems.length > 0 ? recoveredItems : current;
}

const CompactOpportunitySchema = z.object({
  行动: z.coerce.string().transform(normalizeOpportunityText),
  类型: z.coerce.string().transform(normalizeOpportunityText).prefault('探索'),
  提示: z.coerce.string().transform(normalizeOpportunityText).optional(),
});

const EnglishOpportunitySchema = z.object({
  action: z.coerce.string().transform(normalizeOpportunityText),
  type: z.coerce.string().transform(normalizeOpportunityText).prefault('探索'),
  hint: z.coerce.string().transform(normalizeOpportunityText).optional(),
});

const LegacyOpportunitySchema = z.object({
  名称: z.coerce.string().transform(normalizeOpportunityText).prefault(''),
  来源: z.coerce.string().transform(normalizeOpportunityText).prefault(''),
  类型: z.coerce.string().transform(normalizeOpportunityText).prefault('探索'),
  描述: z.coerce.string().transform(normalizeOpportunityText).prefault(''),
  回报预期: z.coerce.string().transform(normalizeOpportunityText).prefault(''),
  风险评估: z.coerce.string().transform(normalizeOpportunityText).prefault(''),
  时限: z.coerce.string().transform(normalizeOpportunityText).optional(),
  关联事件: z.coerce.string().transform(normalizeOpportunityText).optional(),
  优先级: finiteNumber(0).optional(),
});

export const OpportunitySchema = z
  .union([CompactOpportunitySchema, EnglishOpportunitySchema, LegacyOpportunitySchema])
  .transform(item => {
    if ('行动' in item) {
      const hint = normalizeOpportunityText(item.提示);
      return {
        行动: item.行动,
        类型: inferOpportunityType(item.类型, { 行动: item.行动, 提示: hint }),
        ...(hint ? { 提示: hint } : {}),
      };
    }

    if ('action' in item) {
      const hint = normalizeOpportunityText(item.hint);
      return {
        行动: item.action,
        类型: inferOpportunityType(item.type, { action: item.action, hint }),
        ...(hint ? { 提示: hint } : {}),
      };
    }

    const action = item.描述 || item.名称;
    const hint = buildLegacyOpportunityHint(item.时限 ?? '', item.风险评估);
    return {
      行动: action,
      类型: inferOpportunityType(item.类型, {
        名称: item.名称,
        来源: item.来源,
        描述: item.描述,
        回报预期: item.回报预期,
        风险评估: item.风险评估,
        时限: item.时限 ?? '',
        关联事件: item.关联事件 ?? '',
      }),
      ...(hint ? { 提示: hint } : {}),
    };
  });

// 系统设置 Schema
export const SystemSettingsSchema = z
  .object({
    启用行动提示: z.boolean().prefault(true),
    修炼系统版本: finiteNumber(3)
      .transform(value => Math.max(1, Math.floor(value)))
      .prefault(3),
    变量结构版本: finiteNumber(4)
      .transform(value => Math.max(1, Math.floor(value)))
      .prefault(4),
    _临时状态手动覆盖签名: z.string().prefault(''),
  })
  .prefault({});

// 行动系统设置 Schema
export const ActionSystemSettingsSchema = z
  .object({
    启用行动提示: z.boolean().prefault(true),
  })
  .prefault({});

// 难度系统 Schema（v2 最小接入版）
const 天道感应映射: Record<string, '顺遂' | '受挫' | '平稳'> = {
  顺遂: '顺遂',
  受挫: '受挫',
  平稳: '平稳',
  顺利: '顺遂',
  受阻: '受挫',
  正常: '平稳',
};

export const DifficultySystemSchema = z
  .object({
    天道感应: z
      .string()
      .transform(v => 天道感应映射[String(v).trim()] || '平稳')
      .prefault('平稳'),
    环境高压警告: z.string().prefault('天道运转如常，万物循理。'),
    _难度系统内部数据: z
      .object({
        版本号: finiteNumber(1)
          .transform(value => Math.max(1, Math.floor(value)))
          .prefault(1),
        平衡保护: z
          .object({
            连续受挫计数: finiteNumber(0).prefault(0),
            触发阈值: finiteNumber(3).prefault(3),
            生效剩余回合: finiteNumber(0).prefault(0),
            冷却剩余回合: finiteNumber(0).prefault(0),
          })
          .prefault({}),
        动态策略: z
          .object({
            单回合改变量上限: finiteNumber(0.15).prefault(0.15),
            自然回落速度: finiteNumber(0.03).prefault(0.03),
            增长冷却回合: finiteNumber(2).prefault(2),
          })
          .prefault({}),
        难度结算快照: z
          .object({
            回合基线系数: finiteNumber(1).prefault(1),
            本回合最终系数: finiteNumber(1).prefault(1),
            分层来源: z
              .object({
                世界叙事层: finiteNumber(1).prefault(1),
                玩家偏好层: finiteNumber(1).prefault(1),
                短期状态层: finiteNumber(1).prefault(1),
              })
              .prefault({}),
          })
          .prefault({}),
      })
      .prefault({}),
  })
  .prefault({});
