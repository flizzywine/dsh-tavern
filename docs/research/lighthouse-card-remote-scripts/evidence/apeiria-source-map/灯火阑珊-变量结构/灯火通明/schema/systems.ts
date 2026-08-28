// ============================================================================
// 踏月寻仙 - 系统 Schema（任务列表、声望系统、可参与机遇、当前处境）
// ============================================================================

import { z } from 'zod';

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
      域: z.enum(['天层', '神州', '东苍', '南炎', '西庚', '北冥', '下层', '四海']).optional(),
      危: z.coerce
        .number()
        .transform(v => _.clamp(v, 0, 100))
        .optional(),
      特: z.string().optional(),
      奖: z.union([z.array(z.string()), z.string().transform(v => (v ? [v] : []))]).prefault([]),
      限: z.string().optional(),
    })
    .optional(),
  创建时间: z
    .union([
      z.coerce.number(), // 兼容已有的时间戳
      z.string().transform(() => {
        // AI 输入修仙时间格式时，简化处理：直接用当前时间
        return Date.now();
      }),
    ])
    .prefault(() => Date.now()),
});

// 声望条目 Schema
export const ReputationEntrySchema = z.object({
  值: z.coerce
    .number()
    .transform(v => _.clamp(v, -100, 100))
    .prefault(0),
  关系: z.string().prefault('陌生'),
  更新时间: z.coerce.number().prefault(() => Date.now()),
});

// 声望系统 Schema（带自动关系计算 transform）
export const ReputationSystemSchema = z
  .record(z.string().describe('势力名'), ReputationEntrySchema)
  .prefault({})
  .transform(factions => {
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

        // 如果用户手动设置了关系，优先使用用户设置；否则使用自动计算的关系
        const 最终关系 = faction.关系 && faction.关系 !== '陌生' ? faction.关系 : 自动关系;

        return {
          ...faction,
          关系: 最终关系,
        };
      })
      .value();
  });

// 可参与机遇 Schema
type OpportunityType = '探索' | '任务' | '交易' | '结交' | '争夺' | '修炼' | '红颜' | '随机';

const 机遇类型映射: Record<string, OpportunityType> = {
  探索: '探索',
  任务: '任务',
  交易: '交易',
  结交: '结交',
  争夺: '争夺',
  修炼: '修炼',
  红颜: '红颜',
  随机: '随机',
  行动: '探索',
  冒险: '探索',
  日常: '任务',
  日常互动: '红颜',
  战斗: '争夺',
  挑战: '争夺',
  社交: '结交',
  互动: '结交',
  邀约: '结交',
  邂逅: '结交',
  机缘: '探索',
  机遇: '探索',
  奇遇: '探索',
  秘境: '探索',
  寻宝: '探索',
  采购: '交易',
  易物: '交易',
  买卖: '交易',
  委托: '任务',
  悬赏: '任务',
  临危受命: '任务',
  支线: '任务',
  主线: '任务',
  双修: '红颜',
  亲密: '红颜',
  调情: '红颜',
  random: '随机',
};

const 机遇类型推断规则: Array<{ type: OpportunityType; pattern: RegExp }> = [
  {
    type: '红颜',
    pattern:
      /红颜|佳人|道侣|双修|温情|独处|相拥|相守|调情|缠绵|共寝|同眠|忘忧|听雨|清弦|晚棠|云裳|梦杳泠|朔璃鸢|阿鸢|血手飞鸢|朔望舒|赤月女帝|幽影宗主|虞汐|虞颜|虞汐颜/,
  },
  { type: '修炼', pattern: /修炼|闭关|打坐|吐纳|冲关|破境|突破|压境|稳固|悟道|渡劫|根基|丹药|灵阵|参悟/ },
  { type: '交易', pattern: /坊市|易物|交易|买卖|采购|拍卖|丹药铺|商会|补给|售卖|收购|置换/ },
  { type: '争夺', pattern: /争夺|夺取|抢夺|截杀|斗法|厮杀|围攻|追杀|迎战|强敌|魔修|冲突|守擂|比斗/ },
  { type: '任务', pattern: /任务|委托|悬赏|求援|护送|调查|追查|营救|临危|急报|收尾|善后|赴约|赴命/ },
  { type: '结交', pattern: /结交|拜访|邀约|会面|结识|拉拢|试探|求见|访友|赴宴|论道|同游/ },
  { type: '随机', pattern: /随缘|随机|碰运气|听天由命/ },
];

function normalizeOpportunityText(value: unknown): string {
  return String(value ?? '').trim();
}

function inferOpportunityType(rawType: string, payload: Record<string, string>): OpportunityType {
  const mappedType = 机遇类型映射[rawType];
  if (mappedType) {
    return mappedType;
  }

  const text = Object.values(payload)
    .map(value => normalizeOpportunityText(value))
    .filter(Boolean)
    .join('｜');

  for (const rule of 机遇类型推断规则) {
    if (rule.pattern.test(text)) {
      return rule.type;
    }
  }

  return '探索';
}

export const OpportunitySchema = z
  .object({
    名称: z.coerce
      .string()
      .transform(v => String(v).trim())
      .prefault(''),
    来源: z.coerce
      .string()
      .transform(v => String(v).trim())
      .prefault(''), // 如：剧情推进、任务触发、NPC邀请、地点发现、时限事件
    类型: z.coerce
      .string()
      .transform(v => String(v).trim())
      .prefault('探索'),
    描述: z.coerce
      .string()
      .transform(v => String(v).trim())
      .prefault(''),
    回报预期: z.coerce
      .string()
      .transform(v => String(v).trim())
      .prefault(''), // 如：中等灵石收益、可能获得功法线索
    风险评估: z.coerce
      .string()
      .transform(v => String(v).trim())
      .prefault(''), // 如：低风险、有战斗可能
    时限: z.coerce
      .string()
      .transform(v => String(v).trim())
      .optional(), // 如：本日结束前、三日内
    关联事件: z.coerce
      .string()
      .transform(v => String(v).trim())
      .optional(), // 关联的世界事件或任务
    优先级: z.coerce
      .number()
      .transform(v => _.clamp(v, 1, 5))
      .prefault(3), // 1-5，5最高
  })
  .transform(item => {
    const payload = {
      名称: item.名称,
      来源: item.来源,
      描述: item.描述,
      回报预期: item.回报预期,
      风险评估: item.风险评估,
      时限: item.时限 ?? '',
      关联事件: item.关联事件 ?? '',
    };

    return {
      ...item,
      类型: inferOpportunityType(item.类型, payload),
    };
  });

// 系统设置 Schema
export const SystemSettingsSchema = z
  .object({
    启用行动提示: z.boolean().prefault(true),
    修炼系统版本: z.coerce.number().prefault(1),
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
        版本号: z.coerce.number().prefault(1),
        平衡保护: z
          .object({
            连续受挫计数: z.coerce.number().prefault(0),
            触发阈值: z.coerce.number().prefault(3),
            生效剩余回合: z.coerce.number().prefault(0),
            冷却剩余回合: z.coerce.number().prefault(0),
          })
          .prefault({}),
        动态策略: z
          .object({
            单回合改变量上限: z.coerce.number().prefault(0.15),
            自然回落速度: z.coerce.number().prefault(0.03),
            增长冷却回合: z.coerce.number().prefault(2),
          })
          .prefault({}),
        难度结算快照: z
          .object({
            回合基线系数: z.coerce.number().prefault(1.0),
            本回合最终系数: z.coerce.number().prefault(1.0),
            分层来源: z
              .object({
                世界叙事层: z.coerce.number().prefault(1.0),
                玩家偏好层: z.coerce.number().prefault(1.0),
                短期状态层: z.coerce.number().prefault(1.0),
              })
              .prefault({}),
          })
          .prefault({}),
      })
      .prefault({}),
  })
  .prefault({});
