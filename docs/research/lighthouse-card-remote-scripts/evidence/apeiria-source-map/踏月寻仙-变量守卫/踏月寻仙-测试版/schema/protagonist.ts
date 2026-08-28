// ============================================================================
// 踏月寻仙 - 本尊 Schema
// ============================================================================

import { z } from 'zod';
import {
  CultivationStateSchema,
  InventorySchema,
  SkillSchema,
  computeRealmInfo,
  normalizeCultivationState,
  normalizeSpiritStoneState,
} from './common';

// 战斗状态容错映射
const 战斗状态映射: Record<string, string> = {
  非战斗: '非战斗',
  和平: '非战斗',
  安全: '非战斗',
  脱战: '非战斗',
  对峙: '对峙',
  警戒: '对峙',
  僵持: '对峙',
  对视: '对峙',
  激战: '激战',
  战斗: '激战',
  交战: '激战',
  厮杀: '激战',
  重伤: '重伤',
  负伤: '重伤',
  伤重: '重伤',
  濒死: '濒死',
  将死: '濒死',
  垂危: '濒死',
  危急: '濒死',
};

const 伤势映射: Record<string, string> = {
  无伤: '无伤',
  无: '无伤',
  完好: '无伤',
  健康: '无伤',
  轻伤: '轻伤',
  小伤: '轻伤',
  微伤: '轻伤',
  重伤: '重伤',
  伤重: '重伤',
  大伤: '重伤',
  濒死: '濒死',
  将死: '濒死',
  垂危: '濒死',
};

const 战力评估映射: Record<string, string> = {
  碾压: '碾压',
  压倒: '碾压',
  秒杀: '碾压',
  吊打: '碾压',
  优势: '优势',
  占优: '优势',
  上风: '优势',
  有利: '优势',
  势均力敌: '势均力敌',
  均势: '势均力敌',
  平手: '势均力敌',
  相当: '势均力敌',
  旗鼓相当: '势均力敌',
  劣势: '劣势',
  下风: '劣势',
  不利: '劣势',
  落后: '劣势',
  绝望: '绝望',
  必死: '绝望',
  碾压劣势: '绝望',
  无望: '绝望',
};

const 敌人状态映射: Record<string, string> = {
  完好: '完好',
  无伤: '完好',
  健康: '完好',
  全盛: '完好',
  轻伤: '轻伤',
  小伤: '轻伤',
  微伤: '轻伤',
  重伤: '重伤',
  伤重: '重伤',
  大伤: '重伤',
  濒死: '濒死',
  将死: '濒死',
  垂危: '濒死',
  已死: '已死',
  死亡: '已死',
  击杀: '已死',
  阵亡: '已死',
};

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

// 战斗状态 Schema
const CombatStatusSchema = z
  .object({
    正在战斗: z.boolean().prefault(false),
    当前状态: z
      .string()
      .transform(v => 战斗状态映射[v] || '非战斗')
      .prefault('非战斗'),
    灵力值: z.coerce
      .number()
      .transform(v => _.clamp(v, 0, 100))
      .prefault(100),
    伤势等级: z
      .string()
      .transform(v => 伤势映射[v] || '无伤')
      .prefault('无伤'),
    已用底牌: z.array(z.string()).prefault([]),
    战斗回合: z.coerce.number().prefault(0),
  })
  .prefault({
    正在战斗: false,
    当前状态: '非战斗',
    灵力值: 100,
    伤势等级: '无伤',
    已用底牌: [],
    战斗回合: 0,
  });

// 当前敌人 Schema
const EnemySchema = z.object({
  名称: z.string().prefault('未知敌人'),
  境界: z.string().prefault('未知'),
  战力评估: z
    .string()
    .transform(v => 战力评估映射[v] || '势均力敌')
    .prefault('势均力敌'),
  状态: z
    .string()
    .transform(v => 敌人状态映射[v] || '完好')
    .prefault('完好'),
  特点: z.string().prefault(''),
});

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
    当前阶段: z.coerce
      .number()
      .transform(v => _.clamp(v, 0, 9))
      .prefault(0),
    总阶段数: z.coerce
      .number()
      .transform(v => _.clamp(v, 0, 9))
      .prefault(0),
    劫力承受: z.coerce
      .number()
      .transform(v => _.clamp(v, 0, 100))
      .prefault(100),
    已用护道: z.array(z.string()).prefault([]),
    劫难描述: z.string().prefault(''),
    触发原因: z.string().prefault(''),
    上次渡劫结果: z
      .string()
      .transform(v => 渡劫结果映射[v] || '无')
      .prefault('无'),
    渡劫冷却: z.coerce
      .number()
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
    危险度: z.coerce.number().prefault(10),
    可用通道: z.array(z.string()).prefault([]),
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
    等级: z.coerce
      .number()
      .transform(v => _.clamp(v, 1, 48))
      .prefault(1),
    修为: z.coerce
      .number()
      .transform(v => Math.max(0, v))
      .prefault(0),
    灵根: z.string().prefault('五行杂灵根'),
    体质: z.string().prefault('凡体'),
    功法: z.string().prefault('无'),
    本命兵器: z.string().prefault('无'),
    神通列表: z.record(z.string().describe('神通名'), SkillSchema).prefault({}),
    灵石: z.coerce
      .number()
      .transform(v => Math.max(0, v))
      .prefault(0),
    已活岁月: z.coerce
      .number()
      .transform(v => Math.max(0, v))
      .prefault(0),
    尝试突破: z.boolean().prefault(false),
    修炼状态: CultivationStateSchema,
    行踪: LocationTrackSchema,
    身份: IdentitySchema,
    背包: InventorySchema,
    法宝: InventorySchema,
    杂物袋: InventorySchema,
    战斗状态: CombatStatusSchema,
    当前敌人: z.array(EnemySchema).prefault([]),
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
    背包: {},
    法宝: {},
    杂物袋: {},
    战斗状态: {
      正在战斗: false,
      当前状态: '非战斗',
      灵力值: 100,
      伤势等级: '无伤',
      已用底牌: [],
      战斗回合: 0,
    },
    当前敌人: [],
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

    const realmInfo = computeRealmInfo(data, true);
    return { ...data, ...realmInfo };
  });
