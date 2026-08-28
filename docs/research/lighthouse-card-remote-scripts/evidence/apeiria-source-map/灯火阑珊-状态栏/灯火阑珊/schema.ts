// ============================================================================
// 踏月寻仙 - MVU 变量结构定义 (入口文件)
// ============================================================================
// 从子模块导入并组合最终 Schema

import { z } from 'zod';
import { COMPANION_ALIAS_GROUPS } from '../灯火阑珊-变量结构/companion-aliases';

// 子模块导入
import {
  CharacterLibEntrySchema,
  CompanionBondChronicleSchema,
  CompanionSchema,
  DEFAULT_CHARACTER_LIB,
  NpcSchema,
} from './schema/characters';
import {
  computeRealmInfo,
  finiteNumber,
  migrateCultivationProgress,
  NormalizedStringListSchema,
  normalizeCultivationState,
} from './schema/common';
import { ProtagonistSchema } from './schema/protagonist';
import {
  DifficultySystemSchema,
  OpportunitySchema,
  QuestSchema,
  ReputationSystemSchema,
  SystemSettingsSchema,
  unwrapOpportunityPatchPayload,
} from './schema/systems';
import {
  DEFAULT_LOCATIONS,
  DEFAULT_TREASURES,
  FactionSchema,
  LocationSchema,
  PhysiqueSchema,
  SpiritRootSchema,
  TechniqueSchema,
  TreasureSchema,
} from './schema/world';

// 重新导出所有子模块的公开内容
export {
  CharacterLibEntrySchema,
  COMPANION_BOND_EVENT_TYPES,
  CompanionBondChronicleEntrySchema,
  CompanionBondChronicleSchema,
  CompanionSchema,
  CompanionRelationContextSchema,
  CustomPortraitSchema,
  DEFAULT_CHARACTER_LIB,
  NpcSchema,
} from './schema/characters';
export {
  CultivationStateSchema,
  computeRealmInfo,
  describeRealmByLevel,
  extractSpiritStoneFromInventory,
  finiteNumber,
  getCultivationStatusLabel,
  getRealmThreshold,
  InventorySchema,
  isSpiritStoneCurrencyItem,
  ItemSchema,
  migrateCultivationProgress,
  migrateLegacyCultivationProgress,
  NormalizedStringListSchema,
  normalizeSpiritStoneAmount,
  normalizeSpiritStoneState,
  normalizeCultivationState,
  normalizeRealmLevel,
  RealmTransitionSchema,
  SkillListSchema,
  SkillSchema,
  品阶映射,
  熟练度映射,
} from './schema/common';
export { CONFIG, REALM_LIFESPANS, REALM_NAMES, REALM_STAGES, REALM_THRESHOLDS } from './schema/constants';
export { ProtagonistSchema } from './schema/protagonist';
export {
  DifficultySystemSchema,
  OpportunitySchema,
  QuestSchema,
  ReputationEntrySchema,
  ReputationSystemSchema,
  SystemSettingsSchema,
  unwrapOpportunityPatchPayload,
} from './schema/systems';
export {
  compareRealmStanding,
  getDangerColor,
  getRealmColor,
  getRootColor,
  parseRealmToLevel,
  resolveBattleMomentum,
} from './schema/utils';
export type { BattleMomentum, MomentumBasis, RealmStanding } from './schema/utils';
export {
  DEFAULT_FACTIONS,
  DEFAULT_LOCATIONS,
  DEFAULT_TREASURES,
  FactionSchema,
  LocationSchema,
  PhysiqueSchema,
  SpiritRootSchema,
  TechniqueSchema,
  TreasureSchema,
} from './schema/world';

// ============================================================================
// 完整的 MVU 变量结构
// ============================================================================

const LATEST_CULTIVATION_SYSTEM_VERSION = 3;
const LATEST_SCHEMA_VERSION = 4;
const DEFAULT_COMPANION = CompanionSchema.parse({});
const CJK_TEXT_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const MAX_OPPORTUNITIES = 4;
const ACTION_TEXT_LIMIT = 80;
const ACTION_HINT_LIMIT = 28;
const SITUATION_TEXT_LIMIT = 64;

function normalizePromptText(value: unknown, maxLength: number): string {
  return Array.from(
    String(value ?? '')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
    .slice(0, maxLength)
    .join('');
}

function migrateHiddenOpportunityField(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const input = { ...(value as Record<string, unknown>) };
  if (!Object.hasOwn(input, '$可参与机遇') && Object.hasOwn(input, '可参与机遇')) {
    input.$可参与机遇 = input.可参与机遇;
  }
  delete input.可参与机遇;
  return input;
}

function preferNonDefaultString(incoming: unknown, current: string, fallback: string): string {
  const normalizedIncoming = String(incoming ?? '').trim();
  if (normalizedIncoming && normalizedIncoming !== fallback) {
    return normalizedIncoming;
  }
  return current;
}

function extractChineseQuestLabel(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return '';
  }

  const strippedPrefix = raw
    .replace(/^(?:[A-Za-z][A-Za-z0-9]*)(?:[._:\-/\\\s]+[A-Za-z0-9]+)*[._:\-/\\\s]*/u, '')
    .trim();
  const candidate = strippedPrefix || raw;
  const firstCjkIndex = candidate.search(CJK_TEXT_PATTERN);
  if (firstCjkIndex < 0) {
    return '';
  }

  return candidate.slice(firstCjkIndex).trim();
}

function getQuestFallbackLabel(type: unknown): string {
  const normalizedType = String(type ?? '').trim();
  const fallbackByType: Record<string, string> = {
    主线: '主线任务',
    支线: '支线任务',
    每日: '每日任务',
    临危受命: '临危受命',
    秘境探索: '秘境探索',
  };
  return fallbackByType[normalizedType] || '未命名任务';
}

function mergeCompanionData(
  base: z.infer<typeof CompanionSchema> | undefined,
  incoming: z.infer<typeof CompanionSchema>,
): z.infer<typeof CompanionSchema> {
  if (!base) {
    return _.cloneDeep(incoming);
  }

  const merged = _.cloneDeep(base);
  const fallbackRelationContext = _.cloneDeep(DEFAULT_COMPANION.关系上下文);
  merged.等级 = Math.max(Number(base.等级 ?? DEFAULT_COMPANION.等级), Number(incoming.等级 ?? DEFAULT_COMPANION.等级));
  merged.修为 = Math.max(Number(base.修为 ?? DEFAULT_COMPANION.修为), Number(incoming.修为 ?? DEFAULT_COMPANION.修为));
  merged.灵石 = Math.max(Number(base.灵石 ?? DEFAULT_COMPANION.灵石), Number(incoming.灵石 ?? DEFAULT_COMPANION.灵石));
  merged.已活岁月 = Math.max(
    Number(base.已活岁月 ?? DEFAULT_COMPANION.已活岁月),
    Number(incoming.已活岁月 ?? DEFAULT_COMPANION.已活岁月),
  );
  merged.尝试突破 = Boolean(base.尝试突破 || incoming.尝试突破);
  const fallbackCultivationState = _.cloneDeep(DEFAULT_COMPANION.修炼状态);
  merged.修炼状态 = normalizeCultivationState(
    {
      阶段: preferNonDefaultString(
        incoming.修炼状态?.阶段,
        String(base.修炼状态?.阶段 ?? fallbackCultivationState.阶段),
        fallbackCultivationState.阶段,
      ),
      瓶颈原因: preferNonDefaultString(
        incoming.修炼状态?.瓶颈原因,
        String(base.修炼状态?.瓶颈原因 ?? fallbackCultivationState.瓶颈原因),
        fallbackCultivationState.瓶颈原因,
      ),
      突破目标: preferNonDefaultString(
        incoming.修炼状态?.突破目标,
        String(base.修炼状态?.突破目标 ?? fallbackCultivationState.突破目标),
        fallbackCultivationState.突破目标,
      ),
      上次结果: preferNonDefaultString(
        incoming.修炼状态?.上次结果,
        String(base.修炼状态?.上次结果 ?? fallbackCultivationState.上次结果),
        fallbackCultivationState.上次结果,
      ),
      境界变动: incoming.修炼状态?.境界变动?.类型 !== '无' ? incoming.修炼状态.境界变动 : base.修炼状态?.境界变动,
    },
    {
      legacyAttemptBreakthrough: merged.尝试突破,
      level: merged.等级,
      cultivation: merged.修为,
    },
  );
  merged.好感度 = Number.isFinite(Number(incoming.好感度))
    ? Number(incoming.好感度)
    : Number(base.好感度 ?? DEFAULT_COMPANION.好感度);
  merged.关系 = preferNonDefaultString(
    incoming.关系,
    String(base.关系 ?? DEFAULT_COMPANION.关系),
    DEFAULT_COMPANION.关系,
  );
  merged.关系上下文 = {
    当前情绪: preferNonDefaultString(
      incoming.关系上下文?.当前情绪,
      String(base.关系上下文?.当前情绪 ?? fallbackRelationContext.当前情绪),
      fallbackRelationContext.当前情绪,
    ),
    态度缘由: preferNonDefaultString(
      incoming.关系上下文?.态度缘由,
      String(base.关系上下文?.态度缘由 ?? fallbackRelationContext.态度缘由),
      fallbackRelationContext.态度缘由,
    ),
    关系诉求: preferNonDefaultString(
      incoming.关系上下文?.关系诉求,
      String(base.关系上下文?.关系诉求 ?? fallbackRelationContext.关系诉求),
      fallbackRelationContext.关系诉求,
    ),
    相处禁忌: preferNonDefaultString(
      incoming.关系上下文?.相处禁忌,
      String(base.关系上下文?.相处禁忌 ?? fallbackRelationContext.相处禁忌),
      fallbackRelationContext.相处禁忌,
    ),
    未了约定: preferNonDefaultString(
      incoming.关系上下文?.未了约定,
      String(base.关系上下文?.未了约定 ?? fallbackRelationContext.未了约定),
      fallbackRelationContext.未了约定,
    ),
  };
  merged.羁绊纪事 = CompanionBondChronicleSchema.parse({
    ...(base.羁绊纪事 ?? {}),
    ...(incoming.羁绊纪事 ?? {}),
  });

  if (String(base.灵根 ?? DEFAULT_COMPANION.灵根) === DEFAULT_COMPANION.灵根 && String(incoming.灵根 ?? '').trim()) {
    merged.灵根 = incoming.灵根;
  }
  if (String(base.体质 ?? DEFAULT_COMPANION.体质) === DEFAULT_COMPANION.体质 && String(incoming.体质 ?? '').trim()) {
    merged.体质 = incoming.体质;
  }
  if (String(base.功法 ?? DEFAULT_COMPANION.功法) === DEFAULT_COMPANION.功法 && String(incoming.功法 ?? '').trim()) {
    merged.功法 = incoming.功法;
  }
  if (
    String(base.本命兵器 ?? DEFAULT_COMPANION.本命兵器) === DEFAULT_COMPANION.本命兵器 &&
    String(incoming.本命兵器 ?? '').trim()
  ) {
    merged.本命兵器 = incoming.本命兵器;
  }

  merged.神通列表 = {
    ...(base.神通列表 ?? {}),
    ...(incoming.神通列表 ?? {}),
  };

  return merged;
}

function mergeCharacterLibEntry(
  base: z.infer<typeof CharacterLibEntrySchema> | undefined,
  incoming: z.infer<typeof CharacterLibEntrySchema>,
): z.infer<typeof CharacterLibEntrySchema> {
  if (!base) {
    return _.cloneDeep(incoming);
  }

  return {
    级: Math.max(Number(base.级 ?? 1), Number(incoming.级 ?? 1)),
    根: preferNonDefaultString(incoming.根, String(base.根 ?? ''), ''),
    质: preferNonDefaultString(incoming.质, String(base.质 ?? ''), ''),
    龄: preferNonDefaultString(incoming.龄, String(base.龄 ?? ''), ''),
    属: preferNonDefaultString(incoming.属, String(base.属 ?? ''), ''),
    法: preferNonDefaultString(incoming.法, String(base.法 ?? ''), ''),
    器: preferNonDefaultString(incoming.器, String(base.器 ?? ''), ''),
    通: Array.from(
      new Set([...(base.通 ?? []), ...(incoming.通 ?? [])].map(value => String(value).trim()).filter(Boolean)),
    ),
    自定义立绘: {
      正面: String(incoming.自定义立绘?.正面 ?? '').trim() || String(base.自定义立绘?.正面 ?? '').trim(),
      背面: String(incoming.自定义立绘?.背面 ?? '').trim() || String(base.自定义立绘?.背面 ?? '').trim(),
    },
  };
}

function normalizeCharacterLibraryAliases(
  library: Record<string, z.infer<typeof CharacterLibEntrySchema>>,
): Record<string, z.infer<typeof CharacterLibEntrySchema>> {
  const normalizedLibrary = _.cloneDeep(library ?? {});

  for (const { canonical, aliases } of COMPANION_ALIAS_GROUPS) {
    let canonicalEntry = normalizedLibrary[canonical] ? _.cloneDeep(normalizedLibrary[canonical]) : undefined;

    for (const alias of aliases) {
      const aliasEntry = normalizedLibrary[alias];
      if (!aliasEntry) continue;
      canonicalEntry = mergeCharacterLibEntry(canonicalEntry, aliasEntry);
      delete normalizedLibrary[alias];
    }

    if (canonicalEntry) {
      normalizedLibrary[canonical] = canonicalEntry;
    }
  }

  return normalizedLibrary;
}

function normalizeCompanionAliases(
  companions: Record<string, z.infer<typeof CompanionSchema>>,
  snapshot: Record<string, number>,
): { companions: Record<string, z.infer<typeof CompanionSchema>>; snapshot: Record<string, number> } {
  const normalizedCompanions = _.cloneDeep(companions ?? {});
  const normalizedSnapshot = _.cloneDeep(snapshot ?? {});

  for (const { canonical, aliases } of COMPANION_ALIAS_GROUPS) {
    let canonicalCompanion = normalizedCompanions[canonical] ? _.cloneDeep(normalizedCompanions[canonical]) : undefined;

    for (const alias of aliases) {
      const aliasCompanion = normalizedCompanions[alias];
      if (!aliasCompanion) continue;
      canonicalCompanion = mergeCompanionData(canonicalCompanion, aliasCompanion);
      delete normalizedCompanions[alias];
    }

    if (canonicalCompanion) {
      normalizedCompanions[canonical] = canonicalCompanion;
    }

    const snapshotCandidates = [normalizedSnapshot[canonical], ...aliases.map(alias => normalizedSnapshot[alias])]
      .map(value => Number(value))
      .filter(value => Number.isFinite(value));

    for (const alias of aliases) {
      delete normalizedSnapshot[alias];
    }

    if (snapshotCandidates.length > 0) {
      normalizedSnapshot[canonical] = snapshotCandidates[snapshotCandidates.length - 1];
    }
  }

  return {
    companions: normalizedCompanions,
    snapshot: normalizedSnapshot,
  };
}

function getFavorDeltaLimitByValue(favor: number): number {
  const normalizedFavor = Math.max(0, Number.isFinite(favor) ? favor : 0);
  if (normalizedFavor <= 20) return 6;
  if (normalizedFavor <= 60) return 4;
  if (normalizedFavor <= 120) return 3;
  return 2;
}

function normalizeProtagonistCultivation(
  protagonist: z.infer<typeof ProtagonistSchema>,
  currentCultivationVersion: number,
): void {
  if (currentCultivationVersion < LATEST_CULTIVATION_SYSTEM_VERSION) {
    protagonist.修为 = migrateCultivationProgress(
      protagonist.等级,
      protagonist.修为,
      currentCultivationVersion,
      LATEST_CULTIVATION_SYSTEM_VERSION,
    );
  }

  protagonist.修炼状态 = normalizeCultivationState(protagonist.修炼状态, {
    legacyAttemptBreakthrough: protagonist.尝试突破,
    level: protagonist.等级,
    cultivation: protagonist.修为,
  });
  protagonist.尝试突破 = protagonist.修炼状态.阶段 === '突破中';
  Object.assign(protagonist, computeRealmInfo(protagonist));
}

function normalizeCompanionCultivation(
  companion: z.infer<typeof CompanionSchema>,
  currentCultivationVersion: number,
): void {
  if (currentCultivationVersion < LATEST_CULTIVATION_SYSTEM_VERSION) {
    companion.修为 = migrateCultivationProgress(
      companion.等级,
      companion.修为,
      currentCultivationVersion,
      LATEST_CULTIVATION_SYSTEM_VERSION,
    );
  }

  companion.修炼状态 = normalizeCultivationState(companion.修炼状态, {
    legacyAttemptBreakthrough: companion.尝试突破,
    level: companion.等级,
    cultivation: companion.修为,
  });
  companion.尝试突破 = companion.修炼状态.阶段 === '突破中';
  Object.assign(companion, computeRealmInfo(companion));
}

export const Schema = z.preprocess(
  migrateHiddenOpportunityField,
  z
    .object({
      世界时钟: z
        .object({
          纪元: z.string().prefault('盛法时代'),
          年份: finiteNumber(1)
            .transform(v => Math.max(1, Math.floor(v)))
            .prefault(1),
          月份: finiteNumber(1)
            .transform(v => _.clamp(Math.floor(v), 1, 12))
            .prefault(1),
          日期: finiteNumber(1)
            .transform(v => _.clamp(Math.floor(v), 1, 30))
            .prefault(1),
          时辰: z.string().prefault('子时'),
        })
        .prefault({
          纪元: '盛法时代',
          年份: 1,
          月份: 1,
          日期: 1,
          时辰: '子时',
        }),

      世界地图: z
        .record(
          z.string().describe('区域名'),
          z.object({
            layer: z.enum(['天层', '地层', '下层']).prefault('地层'),
            danger: finiteNumber(0).transform(v => _.clamp(v, 0, 100)),
            desc: z.string().prefault(''),
            connections: NormalizedStringListSchema,
          }),
        )
        .prefault({}),

      世界图志: z
        .record(
          z.string().describe('事件名'),
          z.object({
            状态: z.string().prefault(''),
            事件: z.string().prefault(''),
          }),
        )
        .prefault({}),

      // 宗门势力库 - AI 自由创造，只需提供 { 地, 特, 力, 营, 模 }
      宗门势力库: z.record(z.string().describe('宗门名'), FactionSchema).prefault({}),

      // 功法库 - AI 自由创造，只需提供 { 阶, 性, 效 }
      功法库: z.record(z.string().describe('功法名'), TechniqueSchema).prefault({}),

      // 法宝库 - 仅保留剧情关键法宝，其他 AI 自由创造
      法宝库: z.record(z.string().describe('法宝名'), TreasureSchema).prefault(DEFAULT_TREASURES),

      地点库: z.record(z.string().describe('地点名'), LocationSchema).prefault(DEFAULT_LOCATIONS),

      // 玩家/开场白声明的地点 → 舆图落点。前缀 $ 使其不进入常规 AI 更新范围。
      $地图锚点: z.record(z.string().describe('地点名'), z.string().describe('地图地域名')).prefault({}),

      // 提示词/脚本派生缓存：仅供脚本和 EJS 使用，不展示给 AI
      $宗门推断: z
        .object({
          当前域: z.string().prefault(''),
          当前主势力: z.string().prefault(''),
        })
        .prefault({
          当前域: '',
          当前主势力: '',
        }),

      // 灵根库 - AI 自由创造，只需提供 { 质, 性, 稀 }，速度和特性由 transform 自动计算
      灵根库: z.record(z.string().describe('灵根名'), SpiritRootSchema).prefault({}),

      // 体质库 - AI 自由创造，只需提供 { 质, 特, 稀 }，优势由 transform 自动计算
      体质库: z.record(z.string().describe('体质名'), PhysiqueSchema).prefault({}),

      本尊: ProtagonistSchema,

      红颜角色库: z.record(z.string().describe('角色名'), CharacterLibEntrySchema).prefault(DEFAULT_CHARACTER_LIB),

      红颜: z.record(z.string().describe('红颜名'), CompanionSchema).prefault({}),

      // NPC图鉴 - 极简版（保留向后兼容）
      NPC图鉴: z.record(z.string().describe('NPC名'), NpcSchema).prefault({}),

      // 任务列表 - 容错归一化并清理：仅保留进行中的有效任务
      任务列表: z
        .record(z.string().describe('任务ID'), QuestSchema)
        .prefault({})
        .transform(v =>
          _(v)
            .pickBy((task, taskId) => !!task && !!String(taskId).trim())
            .mapValues((task, taskId) => ({
              ...task,
              // 统一剥离 MQ/SQ/task_01 之类英文前缀，避免前端直接出现英文任务名
              名称:
                extractChineseQuestLabel(task.名称) ||
                extractChineseQuestLabel(taskId) ||
                getQuestFallbackLabel(task.类型),
            }))
            .pickBy(task => task.状态 === '进行中')
            .value(),
        ),

      // 声望系统 - 健壮性与智能管理优化
      声望系统: ReputationSystemSchema,

      // 难度系统（LLM探针 + 脚本暗箱状态）
      难度系统: DifficultySystemSchema,

      // ========== 行动提示系统：$ 前缀使变量列表宏不向正文 AI 展示 ==========
      $可参与机遇: z.preprocess(
        unwrapOpportunityPatchPayload,
        z
          .array(OpportunitySchema)
          .prefault([])
          .transform(list => {
            const seen = new Set<string>();

            return list
              .flatMap(item => {
                const action = normalizePromptText(item.行动, ACTION_TEXT_LIMIT);
                if (!action || seen.has(action)) {
                  return [];
                }

                seen.add(action);
                const hint = normalizePromptText(item.提示, ACTION_HINT_LIMIT);
                return [
                  {
                    行动: action,
                    类型: item.类型,
                    ...(hint ? { 提示: hint } : {}),
                  },
                ];
              })
              .slice(0, MAX_OPPORTUNITIES);
          }),
      ),

      // 当前处境描述（用于行动提示面板顶部显示）
      当前处境: z
        .string()
        .prefault('')
        .transform(value => normalizePromptText(value, SITUATION_TEXT_LIMIT)),

      // 系统设置
      _系统设置: SystemSettingsSchema,
      // 内部快照：用于限制红颜好感度单次变动幅度
      _好感度快照: z
        .record(
          z.string().describe('红颜名'),
          finiteNumber(0).transform(v => _.clamp(v, -200, 200)),
        )
        .prefault({}),
    })
    .transform(data => {
      data.红颜角色库 = normalizeCharacterLibraryAliases(data.红颜角色库 ?? {});
      const normalizedCompanionData = normalizeCompanionAliases(data.红颜 ?? {}, data._好感度快照 ?? {});
      data.红颜 = normalizedCompanionData.companions;
      data._好感度快照 = normalizedCompanionData.snapshot;
      const currentCultivationVersion = Math.max(1, Math.floor(Number(data._系统设置?.修炼系统版本 ?? 1) || 1));

      normalizeProtagonistCultivation(data.本尊, currentCultivationVersion);
      for (const companion of Object.values(data.红颜 ?? {})) {
        normalizeCompanionCultivation(companion, currentCultivationVersion);
      }
      data._系统设置 = {
        ...(data._系统设置 ?? {}),
        修炼系统版本: LATEST_CULTIVATION_SYSTEM_VERSION,
        变量结构版本: LATEST_SCHEMA_VERSION,
        _临时状态手动覆盖签名: String(data._系统设置?._临时状态手动覆盖签名 ?? ''),
      };

      const snapshot = _.cloneDeep(data._好感度快照 ?? {});

      for (const [name, companion] of Object.entries(data.红颜 ?? {})) {
        const currentFavor = Number(companion?.好感度);
        if (!Number.isFinite(currentFavor)) {
          continue;
        }

        const prevFavor = Number(snapshot[name]);
        if (Number.isFinite(prevFavor)) {
          const favorDeltaLimit = getFavorDeltaLimitByValue(prevFavor);
          companion.好感度 = _.clamp(currentFavor, prevFavor - favorDeltaLimit, prevFavor + favorDeltaLimit);
        } else {
          companion.好感度 = _.clamp(currentFavor, -200, 200);
        }

        snapshot[name] = companion.好感度;
      }

      data._好感度快照 = _.pickBy(snapshot, (_value, name) => _.has(data.红颜, name));
      return data;
    }),
);

// 导出 Schema 类型
export type SchemaType = z.output<typeof Schema>;
