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

export type RealmStanding =
  | '我方位格压制'
  | '我方近乎碾压'
  | '我方强压'
  | '我方境界占优'
  | '同阶'
  | '敌方境界占优'
  | '敌方强压'
  | '敌方近乎碾压'
  | '敌方位格压制';

export type BattleMomentum = '敌方压制' | '敌方占先' | '相持' | '我方占先' | '我方压制';

export type MomentumBasis = {
  realmStanding: RealmStanding;
  establishedConditions?: boolean;
  explicitCounter?: boolean;
  fieldAdvantage?: boolean;
  significantCost?: boolean;
  matchingExternalStanding?: boolean;
};

const BATTLE_MOMENTUM: BattleMomentum[] = ['敌方压制', '敌方占先', '相持', '我方占先', '我方压制'];

/** 只比较修为位格，不把功法、法宝与临场态势压缩成单一战力数值。 */
export function compareRealmStanding(myLevel: number, enemyLevel: number): RealmStanding {
  const normalizedMine = _.clamp(Math.floor(Number(myLevel) || 1), 1, 48);
  const normalizedEnemy = _.clamp(Math.floor(Number(enemyLevel) || 1), 1, 48);
  const majorDelta = Math.floor((normalizedMine - 1) / 4) - Math.floor((normalizedEnemy - 1) / 4);

  if (majorDelta > 0) return '我方位格压制';
  if (majorDelta < 0) return '敌方位格压制';

  const minorDelta = normalizedMine - normalizedEnemy;
  if (minorDelta >= 3) return '我方近乎碾压';
  if (minorDelta === 2) return '我方强压';
  if (minorDelta === 1) return '我方境界占优';
  if (minorDelta === 0) return '同阶';
  if (minorDelta === -1) return '敌方境界占优';
  if (minorDelta === -2) return '敌方强压';
  return '敌方近乎碾压';
}

/**
 * 确定性推进道争态势：无决定性依据时相持，普通依据至多一阶，
 * 只有铺垫、克制与显著代价同时成立时才允许两阶推进。
 */
export function resolveBattleMomentum(
  current: BattleMomentum,
  requestedShift: number,
  basis: MomentumBasis,
): BattleMomentum {
  const currentIndex = Math.max(0, BATTLE_MOMENTUM.indexOf(current));
  const direction = Math.sign(Number(requestedShift) || 0);
  if (direction === 0) return BATTLE_MOMENTUM[currentIndex];

  const movingForPlayer = direction > 0;
  const blockedByRealm =
    (movingForPlayer && basis.realmStanding === '敌方位格压制') ||
    (!movingForPlayer && basis.realmStanding === '我方位格压制');
  if (blockedByRealm && !(basis.matchingExternalStanding && basis.significantCost)) {
    return BATTLE_MOMENTUM[currentIndex];
  }

  const hasDecisiveBasis =
    basis.establishedConditions || basis.explicitCounter || basis.fieldAdvantage || basis.significantCost;
  if (!hasDecisiveBasis) return BATTLE_MOMENTUM[currentIndex];

  const allowsTwoSteps = basis.establishedConditions && basis.explicitCounter && basis.significantCost;
  const magnitude = Math.min(Math.abs(Math.trunc(requestedShift)), allowsTwoSteps ? 2 : 1);
  return BATTLE_MOMENTUM[_.clamp(currentIndex + direction * magnitude, 0, BATTLE_MOMENTUM.length - 1)];
}
