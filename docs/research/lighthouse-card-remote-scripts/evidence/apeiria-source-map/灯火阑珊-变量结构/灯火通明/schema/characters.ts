// ============================================================================
// 踏月寻仙 - 角色 Schema（红颜角色库、红颜、NPC图鉴）
// ============================================================================

import { z } from 'zod';
import { CultivationStateSchema, SkillSchema, computeRealmInfo, normalizeCultivationState } from './common';

export const CustomPortraitSchema = z
  .object({
    正面: z.string().prefault(''),
    背面: z.string().prefault(''),
  })
  .prefault({});

// 红颜角色库 Schema（静态角色数据）
export const CharacterLibEntrySchema = z.object({
  级: z.coerce.number().transform(v => _.clamp(v, 1, 48)),
  根: z.string().describe('灵根'),
  质: z.string().describe('体质'),
  龄: z.string().describe('年龄'),
  属: z.string().describe('所属'),
  法: z.string().describe('功法'),
  器: z.string().describe('本命兵器'),
  通: z.array(z.string()).prefault([]),
  自定义立绘: CustomPortraitSchema,
});

// 红颜角色库默认数据
export const DEFAULT_CHARACTER_LIB = {
  许听雨: {
    级: 33,
    根: '水本源天',
    质: '归墟神体',
    龄: '外26实12000',
    属: '归墟之主',
    法: '万水归源先天',
    器: '沧海遗珠先天',
    通: ['归墟歌', '逆流虚妄', '寂灭海域', '万水同源'],
  },
  虞汐颜: {
    级: 12,
    根: '水阴阳异',
    质: '双鱼体',
    龄: '化形0年',
    属: '{{user}}玉佩',
    法: '双生天极/阴阳',
    器: '双鱼佩本体',
    通: ['枯木春', '夺命妆', '双鱼梦'],
  },
  白清弦: {
    级: 29,
    根: '金天根',
    质: '剑体',
    龄: '外30实1000+',
    属: '散修剑宗师',
    法: '剑意仙/天音天',
    器: '清弦琴剑灵宝',
    通: ['琴剑杀', '剑意歌', '万剑心'],
  },
  南宫云裳: {
    级: 16,
    根: '火天根',
    质: '神凰道体',
    龄: '外10实118',
    属: '大夏栖凤宫主',
    法: '九转涅槃仙',
    器: '栖梧簪灵宝',
    通: ['南明离火', '凰威镇世', '羽化虚空'],
  },
  梦杳泠: {
    级: 23,
    根: '瑞兽异根',
    质: '乘黄圣体',
    龄: '外8实万年+',
    属: '无(末代乘黄)',
    法: '乘黄本源天',
    器: '无',
    通: ['瑞光庇佑', '灵觉通明', '本源爆发'],
  },
  阮忘忧: {
    级: 44,
    根: '因果大道本源',
    质: '万法不侵之体',
    龄: '二八芳华/历劫万载',
    属: '仙界仙王（凡界伪装）',
    法: '因果大道',
    器: '无（万物皆兵）',
    通: ['概念抹除', '因果篡改', '仙王威压', '重塑纪元'],
  },
  晚棠: {
    级: 15,
    根: '幽冥灵根',
    质: '噬魂之体',
    龄: '未知',
    属: '散修',
    法: '幽冥归魂经天',
    器: '引魂铃灵宝',
    通: ['冥河指引', '冥莲沉梦', '归魂摆舟'],
  },
  朔璃鸢: {
    级: 4,
    根: '异变风灵根',
    质: '桂魄玲珑体',
    龄: '外16实16',
    属: '西庚琼轮垂曜宫离宗千金',
    法: '碎星幽影诀残篇',
    器: '碎星双刃',
    通: ['燕回闪'],
  },
  朔望舒: {
    级: 32,
    根: '皓月异灵根',
    质: '皓月幽微体',
    龄: '外20实2000+',
    属: '西庚琼轮垂曜宫宫主',
    法: '赤渊镇世血月诀',
    器: '霜魄极品灵宝',
    通: ['月映千机', '赤月昭心', '月华封禁', '血月镇魂', '万影归宗'],
  },
  安迟迟: {
    级: 9,
    根: '木属天灵根',
    质: '墨海灵心',
    龄: '外23实23',
    属: '东苍浮云朝露阁藏卷阁掌籍弟子',
    法: '书画载道',
    器: '青琅玕笔',
    通: ['神魂镇海', '书墨化形', '丹青赋灵', '过目成诵'],
  },
};

export const CompanionRelationContextSchema = z
  .object({
    当前情绪: z.string().prefault(''),
    态度缘由: z.string().prefault(''),
    关系诉求: z.string().prefault(''),
    相处禁忌: z.string().prefault(''),
    未了约定: z.string().prefault(''),
  })
  .prefault({});

// 红颜（动态角色数据）Schema
export const CompanionSchema = z
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
    好感度: z.coerce
      .number()
      .transform(v => _.clamp(v, -200, 200))
      .prefault(0),
    关系: z.string().prefault('陌生人'),
    关系上下文: CompanionRelationContextSchema,
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
    好感度: 0,
    关系: '陌生人',
    关系上下文: {},
  })
  .transform(data => {
    data.修炼状态 = normalizeCultivationState(data.修炼状态, {
      legacyAttemptBreakthrough: data.尝试突破,
      level: data.等级,
      cultivation: data.修为,
    });
    data.尝试突破 = data.修炼状态.阶段 === '突破中';
    const realmInfo = computeRealmInfo(data, false);
    return { ...data, ...realmInfo };
  });

// NPC图鉴 Schema - 极简版
export const NpcSchema = z.object({
  等级: z.coerce
    .number()
    .transform(v => _.clamp(v, 1, 48))
    .prefault(1),
  所在宗门: z.string().prefault('散修'),
  备注: z.string().prefault(''),
});
