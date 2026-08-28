import { compareRealmStanding } from '../schema';

export type BattlePhase = '平静' | '对峙' | '试探' | '交锋' | '决胜' | '脱战' | '余波';
export type BattleMomentum = '敌方压制' | '敌方占先' | '相持' | '我方占先' | '我方压制';
export type EssenceBurden = string;
export type SoulBurden = string;
export type BodyBurden = string;
export type EnemyState = '全盛' | '受制' | '负伤' | '重创' | '失能' | '退走' | '被擒' | '败亡';
export type BurdenTone = 'clear' | 'steady' | 'strained' | 'critical';

export interface CombatState {
  正在战斗: boolean;
  阶段: BattlePhase;
  交锋轮次: number;
  战局: {
    态势: BattleMomentum;
    我方目的: string;
    敌方目的: string;
    战场要素: string[];
    态势依据: string[];
    战机: string[];
    危机: string[];
    已显手段: { 我方: string[]; 敌方: string[] };
    最近转折: string;
  };
  负荷: {
    真元: EssenceBurden;
    神识: SoulBurden;
    肉身: BodyBurden;
  };
  最近战果: {
    结果: '无' | '胜' | '负' | '脱身' | '议和' | '中止';
    对手: string[];
    达成: string;
    代价: string[];
    后患: string[];
  };
}

export interface EnemyInfo {
  等级: number;
  境界描述: string;
  状态: EnemyState;
  目的: string;
  威胁手段: string[];
  已暴露破绽: string[];
}

export type EnemyRecord = Record<string, EnemyInfo>;

export interface TribulationState {
  正在渡劫?: boolean;
  劫种?: string;
  劫难等级?: string;
  当前阶段?: number;
  总阶段数?: number;
  劫力承受?: number;
  劫难描述?: string;
  触发原因?: string;
  已用护道?: string[];
  上次渡劫结果?: string;
  渡劫冷却?: number;
  失败惩罚记录?: string;
}

const INACTIVE_ENEMY_STATES = new Set<EnemyState>(['失能', '退走', '被擒', '败亡']);

export const isEnemyActive = (enemy: EnemyInfo): boolean => !INACTIVE_ENEMY_STATES.has(enemy.状态);

export const getRealmStanding = (playerLevel: number, enemy: EnemyInfo): string =>
  compareRealmStanding(playerLevel, enemy.等级);

export const getRealmStandingTone = (standing: string): 'safe' | 'easy' | 'equal' | 'hard' | 'deadly' => {
  if (standing.startsWith('我方位格') || standing.includes('近乎碾压')) return 'safe';
  if (standing.startsWith('我方')) return 'easy';
  if (standing === '同阶') return 'equal';
  if (standing.startsWith('敌方位格') || standing.startsWith('敌方近乎')) return 'deadly';
  return 'hard';
};

export const getEnemyStateIcon = (state: EnemyState): string => {
  const icons: Record<EnemyState, string> = {
    全盛: 'fa-solid fa-shield',
    受制: 'fa-solid fa-link',
    负伤: 'fa-solid fa-bandage',
    重创: 'fa-solid fa-heart-crack',
    失能: 'fa-solid fa-ban',
    退走: 'fa-solid fa-person-running',
    被擒: 'fa-solid fa-handcuffs',
    败亡: 'fa-solid fa-skull-crossbones',
  };
  return icons[state];
};

const CANONICAL_BURDEN_TONES: Record<string, BurdenTone> = {
  充盈: 'clear',
  澄明: 'clear',
  无恙: 'clear',
  尚足: 'steady',
  疲乏: 'steady',
  轻创: 'steady',
  吃紧: 'strained',
  动荡: 'strained',
  重创: 'strained',
  枯竭: 'critical',
  受创: 'critical',
  濒危: 'critical',
};

const DESCRIPTIVE_BURDEN_PATTERNS: Array<{ tone: BurdenTone; pattern: RegExp }> = [
  { tone: 'clear', pattern: /充盈|澄明|无恙|无伤|完好|平稳|安然|痊愈/gu },
  { tone: 'steady', pattern: /尚足|疲乏|疲惫|轻创|轻伤|小伤|微伤|轻损|小损|微损|略耗|消耗|擦伤|不稳/gu },
  { tone: 'strained', pattern: /吃紧|动荡|震荡|重创|重伤|伤重|中损|中创|受损|负伤|受伤|剧耗|大损|紊乱|反噬|迸裂/gu },
  { tone: 'critical', pattern: /枯竭|耗尽|濒危|濒死|垂危|危殆|将死|命悬|识海崩|神魂崩/gu },
];

export const getBurdenTone = (value: string): BurdenTone => {
  const description = String(value ?? '').trim();
  if (!description) return 'clear';
  if (CANONICAL_BURDEN_TONES[description]) return CANONICAL_BURDEN_TONES[description];

  let lastMatchIndex = -1;
  let inferredTone: BurdenTone | null = null;
  for (const { tone, pattern } of DESCRIPTIVE_BURDEN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of description.matchAll(pattern)) {
      if ((match.index ?? -1) >= lastMatchIndex) {
        lastMatchIndex = match.index ?? -1;
        inferredTone = tone;
      }
    }
  }

  // 非空的未知描述代表“存在状态信息”，不能再按健康状态显示。
  return inferredTone ?? 'strained';
};

export const getTribulationTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    无: '#888888',
    雷劫: '#8844ff',
    心劫: '#ff44aa',
    天劫: '#ffdd00',
    情劫: '#ff6b9d',
    因果劫: '#44aaff',
    红尘劫: '#ff8844',
    轮回劫: '#44ffaa',
  };
  return colors[type] || '#888888';
};

export const getTribulationLevelColor = (level: string) => {
  const colors: Record<string, string> = {
    无: '#888888',
    小劫: '#44aa44',
    中劫: '#ffcc00',
    大劫: '#ff8800',
    天罚: '#ff0000',
  };
  return colors[level] || '#888888';
};
