// ============================================================================
// 踏月寻仙 - 工具函数
// ============================================================================

import { CONFIG, REALM_NAMES, REALM_STAGES } from './constants';

// 获取灵根元素颜色
export function getRootColor(root: string): string {
    for (const [elem, data] of Object.entries(CONFIG.ELEMENTS)) {
        if (root.includes(elem)) {
            return data.color;
        }
    }
    return '#cc99ff'; // 默认薰衣草紫（神秘优雅，适合特殊灵根）
}

// 获取境界等级颜色
export function getRealmColor(level: number): string {
    const majorIdx = Math.floor((level - 1) / 4);
    const colors = [
        '#888888', // 练气 - 灰色
        '#44aa44', // 筑基 - 绿色
        '#4488ff', // 金丹 - 蓝色
        '#aa44ff', // 元婴 - 紫色
        '#ff4444', // 化神 - 红色
        '#ffaa00', // 炼虚 - 橙色
        '#ffdd44', // 合体 - 金色
        '#ffffff', // 大乘 - 白色
        '#ff88ff', // 渡劫 - 粉色
        '#66e0ff', // 真仙 - 仙青
        '#c7a6ff', // 仙王 - 王紫
        '#ffd166', // 仙帝 - 帝金
    ];
    return colors[majorIdx] || '#888888';
}

// 获取危险度颜色
export function getDangerColor(danger: number): string {
    if (danger >= 90) return '#ff0000';
    if (danger >= 70) return '#ff4400';
    if (danger >= 50) return '#ff8800';
    if (danger >= 30) return '#ffcc00';
    return '#44aa44';
}

// 根据境界描述解析等级（如"金丹后期" → 11）
export function parseRealmToLevel(realm: string): number {
    // 先匹配大境界
    let majorIdx = -1;
    for (let i = 0; i < REALM_NAMES.length; i++) {
        if (realm.includes(REALM_NAMES[i])) {
            majorIdx = i;
            break;
        }
    }
    if (majorIdx === -1) return 1; // 无法识别，返回最低等级

    // 再匹配小境界
    let minorIdx = 0; // 默认初期
    for (let i = 0; i < REALM_STAGES.length; i++) {
        if (realm.includes(REALM_STAGES[i])) {
            minorIdx = i;
            break;
        }
    }

    return majorIdx * 4 + minorIdx + 1;
}

// 根据境界等级计算基础战力（指数级增长，跨大境界约10倍差距）
export function calculateBaseCombatPower(level: number): number {
    const majorIdx = Math.floor((level - 1) / 4); // 大境界索引(0-8)
    const minorIdx = (level - 1) % 4;              // 小境界索引(0-3)

    // 基础战力：每个大境界翻10倍，小境界内线性增长20%
    const 大境界基础 = Math.pow(10, majorIdx + 1); // 10, 100, 1000, 10000...
    const 小境界加成 = 大境界基础 * 0.2 * minorIdx; // 每小境界+20%基础

    return Math.round(大境界基础 + 小境界加成);
}

// 根据战力差距返回战力评估
export function evaluateCombatPower(myPower: number, enemyPower: number): string {
    const ratio = myPower / enemyPower;
    if (ratio >= 2.0) return '碾压';
    if (ratio >= 1.3) return '优势';
    if (ratio >= 0.8) return '势均力敌';
    if (ratio >= 0.5) return '劣势';
    return '绝望';
}
