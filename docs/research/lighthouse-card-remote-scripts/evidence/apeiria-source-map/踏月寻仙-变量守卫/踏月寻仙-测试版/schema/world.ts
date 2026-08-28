// ============================================================================
// 踏月寻仙 - 世界设定 Schema（宗门、功法、法宝、地点、灵根、体质）
// ============================================================================

import { z } from 'zod';
import { 品阶映射 } from './common';

// 宗门势力 Schema - 优化版
export const FactionSchema = z.object({
    地: z.string().describe('所在地'),
    特: z.string().describe('核心特点'),
    力: z.string().describe('最高战力'),
    营: z.enum(['正', '魔', '中']),
    模: z.enum(['超大', '大', '小', '微', '特']),
});

// 功法 Schema - 优化版（添加品阶容错转换）
export const TechniqueSchema = z.object({
    阶: z.string()
        .transform(v => 品阶映射[v] || '凡')
        .catch('凡'),
    性: z.string().describe('属性'),
    效: z.string().describe('效果'),
});

// 法宝兵器 Schema - 极简版
// 品阶从低到高: 凡器 < 法器 < 灵器 < 法宝 < 灵宝 < 仙器 < 圣器 < 道器 < 本命
// 本命法宝: 与主人神魂相连，可随主人成长，威力随契合度提升，极为稀有
export const TreasureSchema = z.object({
    阶: z.enum(['凡器', '法器', '灵器', '法宝', '灵宝', '仙器', '圣器', '道器', '本命']),
    类: z.string().describe('类型'),
    // 本命法宝专属字段
    本命特性: z.string().optional().describe('本命法宝独有特性'),
    器灵: z.string().optional().describe('器灵名称'),
}).transform(data => ({
    ...data,
    特: data.阶 === '本命' ? '至尊' : data.阶 === '道器' ? '超凡' : data.阶 === '圣器' ? '极品' : data.阶 === '仙器' ? '顶级' : data.阶 === '灵宝' ? '强' : data.阶 === '法宝' ? '中' : '普通',
}));

// 地点 Schema - 优化版
export const LocationSchema = z.object({
    域: z.enum(['天层', '神州', '东苍', '南炎', '西庚', '北冥', '下层', '四海']),
    类: z.enum(['秘境', '城镇', '宗门', '禁地', '遗迹', '地形']),
    危: z.coerce.number().transform(v => _.clamp(v, 0, 100)),
    特: z.string().describe('特点'),
    资: z.union([
        z.array(z.string()),
        z.string().transform(v => v ? [v] : []),
    ]).prefault([]),
});

// 灵根 Schema - 极简版（速度根据质自动计算）
export const SpiritRootSchema = z.object({
    质: z.enum(['劣', '下', '中', '上', '极', '天', '异']),
    性: z.string().describe('属性'),
    稀: z.enum(['常', '少', '罕', '稀', '传']),
}).transform(data => {
    const 速度映射 = { 劣: '0.3倍', 下: '0.5倍', 中: '1倍', 上: '2倍', 极: '3倍', 天: '5倍', 异: '4倍' };
    return {
        ...data,
        速: 速度映射[data.质] || '1倍',
        特: data.质 === '天' ? '单系顶级' : data.质 === '异' ? '变异稀有' : data.质 === '极' ? '双系优秀' : '常规',
    };
});

// 体质 Schema - 优化版
export const PhysiqueSchema = z.object({
    质: z.enum(['凡', '灵', '道', '圣', '神']),
    特: z.string().describe('特性'),
    稀: z.enum(['常', '少', '罕', '稀', '传']),
}).transform(data => ({
    ...data,
    优: data.质 === '神' ? '至高' : data.质 === '圣' ? '极强' : data.质 === '道' ? '强' : data.质 === '灵' ? '中' : '无',
}));

// 宗门势力库默认数据
export const DEFAULT_FACTIONS = {
    // 正道
    剑阁: { 地: '神州剑门关', 特: '剑道源头', 力: '渡劫后期', 营: '正' as const, 模: '超大' as const },
    万法宗: { 地: '神州问道峰', 特: '万法本源', 力: '渡劫初期', 营: '正' as const, 模: '超大' as const },
    金刚寺: { 地: '西天佛山', 特: '佛修炼体', 力: '大乘中期', 营: '正' as const, 模: '大' as const },
    药王谷: { 地: '神农架', 特: '医炼丹药', 力: '大乘初期', 营: '正' as const, 模: '大' as const },
    儒门: { 地: '文圣山', 特: '浩然正气', 力: '大乘中期', 营: '正' as const, 模: '大' as const },
    青龙殿: { 地: '东苍青龙山', 特: '守护青帝', 力: '大乘初期', 营: '正' as const, 模: '大' as const },
    玄武宗: { 地: '北冥玄冰山', 特: '镇守归墟', 力: '大乘后期', 营: '正' as const, 模: '大' as const },
    青云门: { 地: '神州青云山', 特: '水脉一系', 力: '大乘初期', 营: '正' as const, 模: '大' as const },
    建木宗: { 地: '东苍建木树', 特: '木系道法', 力: '合体中期', 营: '正' as const, 模: '小' as const },
    百花谷: { 地: '百花秘境', 特: '女修花道', 力: '合体后期', 营: '正' as const, 模: '小' as const },
    // 魔道
    血神教: { 地: '血魔渊', 特: '血道炼法', 力: '渡劫中期', 营: '魔' as const, 模: '超大' as const },
    天魔宗: { 地: '天魔山', 特: '天魔大道', 力: '大乘中期', 营: '魔' as const, 模: '大' as const },
    // 中立
    妖盟: { 地: '万妖森林', 特: '妖族联盟', 力: '渡劫中期', 营: '中' as const, 模: '超大' as const },
    大夏王朝: { 地: '中州皇城', 特: '世俗统治', 力: '大乘初期', 营: '中' as const, 模: '大' as const },
    九州商会: { 地: '九大主城', 特: '商业联盟', 力: '大乘初期', 营: '中' as const, 模: '大' as const },
    离火宫: { 地: '南炎火山', 特: '朱雀供奉', 力: '合体圆满', 营: '中' as const, 模: '小' as const },
    铸剑山庄: { 地: '南炎地火', 特: '炼器第一', 力: '合体后期', 营: '中' as const, 模: '小' as const },
};

// 法宝库默认数据
export const DEFAULT_TREASURES = {
    镇渊剑: { 阶: '仙器' as const, 类: '剑' },
    双鱼佩: {
        阶: '本命' as const,
        类: '玉佩',
        本命特性: '源血契约、阴阳双生、器灵化形、与主共修、生死相依、锁血护主',
        器灵: '虞汐颜',
    },
};

// 地点库默认数据
export const DEFAULT_LOCATIONS = {
    // 天层 - 保留核心禁地
    天渊: { 域: '天层' as const, 类: '禁地' as const, 危: 95, 特: '星辰裂隙', 资: ['星辰碎片', '陨铁'] },
    罡风带: { 域: '天层' as const, 类: '禁地' as const, 危: 90, 特: '罡风屏障', 资: ['罡风精华'] },
    // 神州
    问道峰: { 域: '神州' as const, 类: '宗门' as const, 危: 10, 特: '万法宗', 资: ['功法', '灵药'] },
    剑门关: { 域: '神州' as const, 类: '宗门' as const, 危: 15, 特: '剑阁', 资: ['剑意', '飞剑'] },
    藏书阁: { 域: '神州' as const, 类: '宗门' as const, 危: 5, 特: '古籍', 资: ['功法', '秘术'] },
    酆都城: { 域: '神州' as const, 类: '城镇' as const, 危: 30, 特: '鬼市', 资: ['幽冥材料'] },
    龙门瀑: { 域: '神州' as const, 类: '秘境' as const, 危: 40, 特: '化龙', 资: ['龙气'] },
    // 东苍
    建木林: { 域: '东苍' as const, 类: '地形' as const, 危: 50, 特: '古树精', 资: ['灵木', '妖丹'] },
    青帝陵: { 域: '东苍' as const, 类: '遗迹' as const, 危: 85, 特: '青帝传承', 资: ['青帝传承'] },
    百花境: { 域: '东苍' as const, 类: '秘境' as const, 危: 20, 特: '花海', 资: ['灵花'] },
    // 南炎
    不灭火山: { 域: '南炎' as const, 类: '地形' as const, 危: 80, 特: '朱雀涅槃', 资: ['朱雀火'] },
    涅槃台: { 域: '南炎' as const, 类: '遗迹' as const, 危: 70, 特: '涅槃', 资: ['涅槃感悟'] },
    // 西庚
    万剑冢: { 域: '西庚' as const, 类: '禁地' as const, 危: 85, 特: '剑意', 资: ['剑意', '古剑'] },
    // 北冥
    玄冰山: { 域: '北冥' as const, 类: '宗门' as const, 危: 50, 特: '玄武宗', 资: ['玄冰'] },
    归墟眼: { 域: '北冥' as const, 类: '禁地' as const, 危: 99, 特: '归墟', 资: ['归墟感悟'] },
    // 下层
    黄泉迹: { 域: '下层' as const, 类: '遗迹' as const, 危: 90, 特: '幽冥', 资: ['黄泉水'] },
    炎渊: { 域: '下层' as const, 类: '禁地' as const, 危: 95, 特: '地心火', 资: ['地心火'] },
};