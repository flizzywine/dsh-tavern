// ============================================================================
// 踏月寻仙 - 本尊 Schema
// ============================================================================

import { z } from 'zod';
import {
  CultivationStateSchema,
  InventorySchema,
  NormalizedStringListSchema,
  SkillListSchema,
  computeRealmInfo,
  describeRealmByLevel,
  finiteNumber,
  normalizeCultivationState,
  normalizeRealmLevel,
  normalizeSpiritStoneAmount,
  normalizeSpiritStoneState,
} from './common';
import { parseRealmToLevel } from './utils';

type BattlePhase = '平静' | '对峙' | '试探' | '交锋' | '决胜' | '脱战' | '余波';
type BattleMomentum = '敌方压制' | '敌方占先' | '相持' | '我方占先' | '我方压制';
type EnemyState = '全盛' | '受制' | '负伤' | '重创' | '失能' | '退走' | '被擒' | '败亡';

const 战斗阶段映射: Record<string, BattlePhase> = {
  平静: '平静',
  非战斗: '平静',
  和平: '平静',
  安全: '平静',
  对峙: '对峙',
  警戒: '对峙',
  僵持: '对峙',
  试探: '试探',
  交锋: '交锋',
  激战: '交锋',
  战斗: '交锋',
  交战: '交锋',
  厮杀: '交锋',
  决胜: '决胜',
  重伤: '决胜',
  濒死: '决胜',
  脱战: '脱战',
  余波: '余波',
};

const 战局态势映射: Record<string, BattleMomentum> = {
  敌方压制: '敌方压制',
  绝望: '敌方压制',
  敌方占先: '敌方占先',
  劣势: '敌方占先',
  相持: '相持',
  势均力敌: '相持',
  敌我相当: '相持',
  我方占先: '我方占先',
  优势: '我方占先',
  我方压制: '我方压制',
  碾压: '我方压制',
};

const 敌人状态映射: Record<string, EnemyState> = {
  全盛: '全盛',
  完好: '全盛',
  无伤: '全盛',
  健康: '全盛',
  受制: '受制',
  压制: '受制',
  轻伤: '负伤',
  小伤: '负伤',
  微伤: '负伤',
  负伤: '负伤',
  重伤: '重创',
  伤重: '重创',
  大伤: '重创',
  重创: '重创',
  濒死: '失能',
  将死: '失能',
  垂危: '失能',
  失能: '失能',
  退走: '退走',
  逃离: '退走',
  被擒: '被擒',
  俘虏: '被擒',
  败亡: '败亡',
  已死: '败亡',
  死亡: '败亡',
  击杀: '败亡',
  阵亡: '败亡',
};

const limitedStringList = (limit: number) => NormalizedStringListSchema.transform(values => values.slice(-limit));
const burdenDescription = (fallback: string) =>
  z
    .string()
    .transform(value => value.trim() || fallback)
    .catch(fallback)
    .prefault(fallback);

function migrateLegacyCombatStatus(value: unknown): unknown {
  if (!_.isPlainObject(value)) return {};
  const raw = { ...(value as Record<string, unknown>) };
  if ('战局' in raw || '负荷' in raw || '交锋轮次' in raw || '阶段' in raw) return raw;

  const active = raw.正在战斗 === true;
  const injury = String(raw.伤势等级 ?? '无伤');
  const usedCards = Array.isArray(raw.已用底牌) ? raw.已用底牌 : [];
  const spirit = _.clamp(Number(raw.灵力值 ?? 100) || 0, 0, 100);
  const phase = active
    ? 战斗阶段映射[String(raw.当前状态 ?? '交锋')] || '交锋'
    : injury !== '无伤' || spirit < 100 || usedCards.length > 0
      ? '余波'
      : '平静';

  return {
    正在战斗: active,
    阶段: phase,
    交锋轮次: raw.战斗回合 ?? 0,
    战局: {
      态势: '相持',
      已显手段: { 我方: usedCards, 敌方: [] },
    },
    负荷: {
      真元: spirit >= 70 ? '充盈' : spirit >= 40 ? '尚足' : spirit >= 10 ? '吃紧' : '枯竭',
      神识: '澄明',
      肉身:
        injury === '濒死' || injury === '将死' || injury === '垂危'
          ? '濒危'
          : injury === '重伤' || injury === '伤重' || injury === '大伤'
            ? '重创'
            : injury === '轻伤' || injury === '小伤' || injury === '微伤'
              ? '轻创'
              : '无恙',
    },
  };
}

function migrateLegacyEnemies(value: unknown): unknown {
  if (!Array.isArray(value)) return value ?? {};
  const enemies: Record<string, unknown> = {};

  value.forEach((entry, index) => {
    const raw = _.isPlainObject(entry) ? (entry as Record<string, unknown>) : {};
    const baseName = String(raw.名称 ?? `未知敌人${index + 1}`).trim() || `未知敌人${index + 1}`;
    let name = baseName;
    let suffix = 2;
    while (_.has(enemies, name)) {
      name = `${baseName}·${suffix}`;
      suffix += 1;
    }
    enemies[name] = raw;
  });

  return enemies;
}

function protectProtagonistFromLethalResult(value: unknown): unknown {
  if (!_.isPlainObject(value)) return value;
  const raw = { ...(value as Record<string, unknown>) };
  const result = String(raw.结果 ?? '无').trim();
  if (!['死亡', '败亡', '身死', '殒命', '魂飞魄散'].includes(result)) return raw;

  const achieved = String(raw.达成 ?? '');
  raw.结果 = /脱|逃|救|传送|遁/u.test(achieved) ? '脱身' : '负';
  const costs = Array.isArray(raw.代价) ? raw.代价.map(String).filter(Boolean) : [];
  raw.代价 = costs.length > 0 ? costs : ['死劫反噬未消'];
  return raw;
}

// 劫种映射
const 劫种映射: Record<string, string> = {
  无: '无',
  '': '无',
  无劫: '无',
  雷劫: '雷劫',
  天雷: '雷劫',
  雷: '雷劫',
  心劫: '心劫',
  心魔: '心劫',
  魔劫: '心劫',
  天劫: '天劫',
  大劫: '天劫',
  情劫: '情劫',
  情关: '情劫',
  因果劫: '因果劫',
  因果: '因果劫',
  红尘劫: '红尘劫',
  红尘: '红尘劫',
  轮回劫: '轮回劫',
  轮回: '轮回劫',
};

const 劫难等级映射: Record<string, string> = {
  无: '无',
  无劫: '无',
  小劫: '小劫',
  小: '小劫',
  初级: '小劫',
  中劫: '中劫',
  中: '中劫',
  中级: '中劫',
  大劫: '大劫',
  大: '大劫',
  高级: '大劫',
  天罚: '天罚',
  天: '天罚',
  极: '天罚',
  天道: '天罚',
};

const 渡劫结果映射: Record<string, string> = {
  无: '无',
  '': '无',
  未渡劫: '无',
  成功: '成功',
  通过: '成功',
  渡过: '成功',
  失败: '失败',
  未过: '失败',
  失: '失败',
};

const BattleSceneSchema = z
  .object({
    态势: z
      .string()
      .transform(v => 战局态势映射[String(v).trim()] || '相持')
      .prefault('相持'),
    我方目的: z
      .string()
      .transform(v => v.trim())
      .prefault(''),
    敌方目的: z
      .string()
      .transform(v => v.trim())
      .prefault(''),
    战场要素: limitedStringList(4),
    态势依据: limitedStringList(4),
    战机: limitedStringList(3),
    危机: limitedStringList(3),
    已显手段: z
      .object({
        我方: limitedStringList(6),
        敌方: limitedStringList(6),
      })
      .prefault({ 我方: [], 敌方: [] }),
    最近转折: z
      .string()
      .transform(v => v.trim())
      .prefault(''),
  })
  .prefault({
    态势: '相持',
    我方目的: '',
    敌方目的: '',
    战场要素: [],
    态势依据: [],
    战机: [],
    危机: [],
    已显手段: { 我方: [], 敌方: [] },
    最近转折: '',
  });

const BattleBurdenSchema = z
  .object({
    真元: burdenDescription('充盈'),
    神识: burdenDescription('澄明'),
    肉身: burdenDescription('无恙'),
  })
  .prefault({ 真元: '充盈', 神识: '澄明', 肉身: '无恙' });

const LastBattleResultSchema = z.preprocess(
  protectProtagonistFromLethalResult,
  z
    .object({
      结果: z.enum(['无', '胜', '负', '脱身', '议和', '中止']).catch('无').prefault('无'),
      对手: limitedStringList(8),
      达成: z
        .string()
        .transform(v => v.trim())
        .prefault(''),
      代价: limitedStringList(6),
      后患: limitedStringList(6),
    })
    .prefault({ 结果: '无', 对手: [], 达成: '', 代价: [], 后患: [] }),
);

// 战斗状态 Schema：旧字段只作为输入兼容，输出统一为道争态势制。
const CombatStatusSchema = z.preprocess(
  migrateLegacyCombatStatus,
  z
    .object({
      正在战斗: z.boolean().prefault(false),
      阶段: z
        .string()
        .transform(v => 战斗阶段映射[String(v).trim()] || '平静')
        .prefault('平静'),
      交锋轮次: finiteNumber(0)
        .transform(v => Math.max(0, Math.floor(v)))
        .prefault(0),
      战局: BattleSceneSchema,
      负荷: BattleBurdenSchema,
      最近战果: LastBattleResultSchema,
    })
    .prefault({
      正在战斗: false,
      阶段: '平静',
      交锋轮次: 0,
      战局: {},
      负荷: {},
      最近战果: {},
    }),
);

// 当前敌人 Schema：等级是事实源，境界描述只读派生。
const EnemySchema = z.preprocess(
  value => {
    const raw = _.isPlainObject(value) ? { ...(value as Record<string, unknown>) } : {};
    if (raw.等级 == null) raw.等级 = parseRealmToLevel(String(raw.境界 ?? ''));
    if (raw.威胁手段 == null && raw.特点 != null) raw.威胁手段 = [String(raw.特点)];
    raw.状态 = 敌人状态映射[String(raw.状态 ?? '全盛')] || '全盛';
    return raw;
  },
  z
    .object({
      等级: finiteNumber(1).transform(normalizeRealmLevel).prefault(1),
      状态: z.enum(['全盛', '受制', '负伤', '重创', '失能', '退走', '被擒', '败亡']).catch('全盛').prefault('全盛'),
      目的: z
        .string()
        .transform(v => v.trim())
        .prefault(''),
      威胁手段: limitedStringList(4),
      已暴露破绽: limitedStringList(3),
    })
    .transform(enemy => ({ ...enemy, 境界描述: describeRealmByLevel(enemy.等级) })),
);

const CurrentEnemiesSchema = z.preprocess(
  migrateLegacyEnemies,
  z
    .record(z.string().describe('敌人名'), EnemySchema)
    .prefault({})
    .transform(enemies =>
      _(enemies)
        .entries()
        .map(([rawName, enemy]) => [String(rawName).trim(), enemy] as const)
        .filter(([name]) => !!name)
        .fromPairs()
        .value(),
    ),
);

// 渡劫状态 Schema
const TribulationSchema = z
  .object({
    正在渡劫: z.boolean().prefault(false),
    劫种: z
      .string()
      .transform(v => 劫种映射[v] || '无')
      .prefault('无'),
    劫难等级: z
      .string()
      .transform(v => 劫难等级映射[v] || '无')
      .prefault('无'),
    当前阶段: finiteNumber(0)
      .transform(v => _.clamp(v, 0, 9))
      .prefault(0),
    总阶段数: finiteNumber(0)
      .transform(v => _.clamp(v, 0, 9))
      .prefault(0),
    劫力承受: finiteNumber(100)
      .transform(v => _.clamp(v, 0, 100))
      .prefault(100),
    已用护道: NormalizedStringListSchema,
    劫难描述: z.string().prefault(''),
    触发原因: z.string().prefault(''),
    上次渡劫结果: z
      .string()
      .transform(v => 渡劫结果映射[v] || '无')
      .prefault('无'),
    渡劫冷却: finiteNumber(0)
      .transform(v => Math.max(0, v))
      .prefault(0),
    失败惩罚记录: z.string().prefault(''),
  })
  .prefault({
    正在渡劫: false,
    劫种: '无',
    劫难等级: '无',
    当前阶段: 0,
    总阶段数: 0,
    劫力承受: 100,
    已用护道: [],
    劫难描述: '',
    触发原因: '',
    上次渡劫结果: '无',
    渡劫冷却: 0,
    失败惩罚记录: '',
  })
  .transform(data => {
    if (data.正在渡劫) {
      return {
        ...data,
        劫难等级: data.劫难等级 === '无' ? '小劫' : data.劫难等级,
        当前阶段: _.clamp(data.当前阶段, 0, 9),
        总阶段数: _.clamp(Math.max(data.总阶段数 || 3, data.当前阶段, 1), 1, 9),
      };
    }

    // 渡劫结束后仅保留结果与余波，清掉“活动态”字段，避免旧劫难长期卡在界面上。
    return {
      ...data,
      劫种: '无',
      劫难等级: '无',
      当前阶段: 0,
      总阶段数: 0,
      劫难描述: '',
      触发原因: '',
    };
  });

// 行踪 Schema
const LocationTrackSchema = z
  .object({
    当前区域: z.string().prefault('未知之地'),
    所属层级: z.string().prefault('地层'),
    环境描述: z.string().prefault(''),
    危险度: finiteNumber(10)
      .transform(v => _.clamp(v, 0, 100))
      .prefault(10),
    可用通道: NormalizedStringListSchema,
    导航信息: z.string().prefault(''),
  })
  .prefault({
    当前区域: '未知之地',
    所属层级: '地层',
    环境描述: '',
    危险度: 10,
    可用通道: [],
    导航信息: '',
  });

// 身份 Schema
const IdentitySchema = z
  .object({
    姓名: z.string().prefault('无名氏'),
    宗门: z.string().prefault('散修'),
    出身: z.string().prefault('凡人'),
  })
  .prefault({
    姓名: '无名氏',
    宗门: '散修',
    出身: '凡人',
  });

// 本尊 Schema
export const ProtagonistSchema = z
  .object({
    等级: finiteNumber(1).transform(normalizeRealmLevel).prefault(1),
    修为: finiteNumber(0)
      .transform(v => Math.max(0, v))
      .prefault(0),
    灵根: z.string().prefault('五行杂灵根'),
    体质: z.string().prefault('凡体'),
    功法: z.string().prefault('无'),
    本命兵器: z.string().prefault('无'),
    神通列表: SkillListSchema,
    灵石: z
      .preprocess(
        normalizeSpiritStoneAmount,
        finiteNumber(0).transform(v => Math.max(0, v)),
      )
      .prefault(0),
    已活岁月: finiteNumber(0)
      .transform(v => Math.max(0, v))
      .prefault(0),
    尝试突破: z.boolean().prefault(false),
    修炼状态: CultivationStateSchema,
    行踪: LocationTrackSchema,
    身份: IdentitySchema,
    // 下划线前缀：正文 AI 可读取，但 MVU 不接受 AI 对它的更新命令；仅由玩家界面写入。
    _档案: z
      .string()
      .transform(value => value.replace(/\r\n?/gu, '\n').trim())
      .prefault(''),
    背包: InventorySchema,
    法宝: InventorySchema,
    杂物袋: InventorySchema,
    战斗状态: CombatStatusSchema,
    当前敌人: CurrentEnemiesSchema,
    渡劫状态: TribulationSchema,
  })
  .prefault({
    等级: 1,
    修为: 0,
    灵根: '五行杂灵根',
    体质: '凡体',
    功法: '无',
    本命兵器: '无',
    神通列表: {},
    灵石: 0,
    已活岁月: 0,
    尝试突破: false,
    修炼状态: {
      阶段: '修炼中',
      瓶颈原因: '',
      突破目标: '',
      上次结果: '无',
      境界变动: {
        类型: '无',
        目标等级: 0,
        依据: '',
      },
    },
    行踪: {
      当前区域: '未知之地',
      所属层级: '地层',
      环境描述: '',
      危险度: 10,
      可用通道: [],
      导航信息: '',
    },
    身份: {
      姓名: '无名氏',
      宗门: '散修',
      出身: '凡人',
    },
    _档案: '',
    背包: {},
    法宝: {},
    杂物袋: {},
    战斗状态: {
      正在战斗: false,
      阶段: '平静',
      交锋轮次: 0,
      战局: {
        态势: '相持',
        我方目的: '',
        敌方目的: '',
        战场要素: [],
        态势依据: [],
        战机: [],
        危机: [],
        已显手段: { 我方: [], 敌方: [] },
        最近转折: '',
      },
      负荷: { 真元: '充盈', 神识: '澄明', 肉身: '无恙' },
      最近战果: { 结果: '无', 对手: [], 达成: '', 代价: [], 后患: [] },
    },
    当前敌人: {},
    渡劫状态: {
      正在渡劫: false,
      劫种: '无',
      劫难等级: '无',
      当前阶段: 0,
      总阶段数: 0,
      劫力承受: 100,
      已用护道: [],
      劫难描述: '',
      触发原因: '',
      上次渡劫结果: '无',
      渡劫冷却: 0,
      失败惩罚记录: '',
    },
  })
  .transform(data => {
    const spiritStoneNormalization = normalizeSpiritStoneState(data.灵石, data.背包, data.杂物袋);
    const [normalizedBackpack, normalizedMiscBag] = spiritStoneNormalization.inventories;
    data.灵石 = spiritStoneNormalization.spiritStone;
    data.背包 = normalizedBackpack ?? {};
    data.杂物袋 = normalizedMiscBag ?? {};
    data.修炼状态 = normalizeCultivationState(data.修炼状态, {
      legacyAttemptBreakthrough: data.尝试突破,
      level: data.等级,
      cultivation: data.修为,
    });
    data.尝试突破 = data.修炼状态.阶段 === '突破中';

    const realmInfo = computeRealmInfo(data);
    return { ...data, ...realmInfo };
  });
