// ============================================================================
// Character asset API
// Character-specific URL lists live in ./character-assets/characters/*.
// ============================================================================

import { CHARACTER_ASSETS, CHARACTER_IMAGE_POOLS } from './character-assets/index';
import type { CharacterImagePool, DualSoulImagePool, ExpressionImages } from './character-assets/types';
import { COMPANION_CANONICAL_NAMES } from '../灯火阑珊-变量结构/companion-aliases';

export { CHARACTER_ASSETS, CHARACTER_IMAGE_POOLS } from './character-assets/index';
export type {
  CharacterAssetConfig,
  CharacterAssets,
  CharacterImagePool,
  CharacterImagePoolConfig,
  CharacterImagePools,
  DualSoulImagePool,
  ExpressionImages,
} from './character-assets/types';

/**
 * 角色名称别名映射
 * AI 按照世界书规则会分别输出 "虞汐" 和 "虞颜"，需要映射到 "虞汐颜" 的资源配置
 */
/**
 * 解析角色名称（支持别名映射）
 * @param name AI 输出的角色名
 * @returns 标准化后的资源配置名
 */
function resolveCharacterName(name: string): string {
  return COMPANION_CANONICAL_NAMES[name] ?? name;
}

/**
 * 从原始角色名推断虞汐颜的优先魂体
 * @param originalName AI 输出的原始角色名
 * @returns 优先显示在正面的魂体，或 undefined 表示随机
 */
function inferPreferredSoul(originalName: string): '虞汐' | '虞颜' | undefined {
  if (originalName === '虞汐') return '虞汐';
  if (originalName === '虞颜') return '虞颜';
  return undefined;
}

/**
 * 默认表情 - 当 AI 输出的 img_code 不存在时使用
 */
export const DEFAULT_EXPRESSION = 'normal';

/**
 * 默认卡片背景 - 当角色没有配置图片时使用的占位图
 */
export const DEFAULT_PLACEHOLDER = 'https://files.catbox.moe/placeholder.jpg';

/**
 * 从图片池中随机选择一张图片
 * 虞汐颜专用：缓存当前选择的魂体，以便正面和背面使用不同的魂体
 */
let cachedDualSoul: '虞汐' | '虞颜' | null = null;

/**
 * 会话缓存：记录已经为虞汐颜生成过的卡片
 * 避免在同一个消息楼层中生成多张虞汐颜卡片
 */
let dualSoulSessionUsed = false;

/**
 * 抽取缓存：记录每个图片池当前轮次还没被抽过的图片
 * 当某个池被抽空时，自动重置并开始下一轮
 */
const imageDrawCache = new Map<string, string[]>();

function drawImageWithoutRepeat(poolKey: string, images: string[]): string {
  let remainingImages = imageDrawCache.get(poolKey);

  // 首次抽取或本轮已抽空时，重置为完整图池
  if (!remainingImages || remainingImages.length === 0) {
    remainingImages = [...images];
  }

  const randomIndex = Math.floor(Math.random() * remainingImages.length);
  const selectedImage = remainingImages[randomIndex];
  remainingImages.splice(randomIndex, 1);

  imageDrawCache.set(poolKey, remainingImages);
  return selectedImage;
}

function isCharacterImagePool(pool: unknown): pool is CharacterImagePool {
  if (!pool || typeof pool !== 'object') {
    return false;
  }

  const candidate = pool as Partial<CharacterImagePool>;
  return Array.isArray(candidate.front) && Array.isArray(candidate.back);
}

/**
 * 获取角色某一面的完整候选图片池，供图鉴手动浏览使用。
 * 虞汐颜会根据当前显示的魂体返回对应图片池。
 */
export function getCharacterImageCandidates(
  characterName: string,
  type: 'front' | 'back',
  soulName?: string,
): readonly string[] {
  const resolvedName = resolveCharacterName(characterName);
  const pool = CHARACTER_IMAGE_POOLS[resolvedName];

  if (!pool) return [];
  if (isCharacterImagePool(pool)) return pool[type];

  if (resolvedName === '虞汐颜') {
    const preferredSoul = soulName === '虞汐' || soulName === '虞颜' ? soulName : inferPreferredSoul(characterName);
    if (!preferredSoul) return [];
    return pool[`${preferredSoul}_${type}`];
  }

  return [];
}

function getRandomImage(characterName: string, type: 'front' | 'back'): string {
  const pool = CHARACTER_IMAGE_POOLS[characterName];
  if (!pool || !isCharacterImagePool(pool)) {
    console.warn(`[图鉴] 未找到角色 "${characterName}" 的图片池`);
    return DEFAULT_PLACEHOLDER;
  }

  const images = pool[type];
  if (!images || images.length === 0) {
    console.warn(`[图鉴] 角色 "${characterName}" 的 ${type} 图片池为空`);
    return DEFAULT_PLACEHOLDER;
  }

  return drawImageWithoutRepeat(`${characterName}:${type}`, images);
}

/**
 * 虞汐颜专用：获取一体双魂的图片和名字
 * 正面虞汐时背面虞颜，正面虞颜时背面虞汐
 *
 * 重要：每次调用此函数时，只会生成一对卡片（正面+背面）
 * 如果已经生成过，则返回 null，避免重复生成
 */
function getDualSoulImage(
  type: 'front' | 'back',
  preferredSoul?: '虞汐' | '虞颜',
): { url: string; soulName: string } | null {
  const pool = CHARACTER_IMAGE_POOLS['虞汐颜'] as DualSoulImagePool | undefined;
  if (!pool) {
    console.warn(`[图鉴] 未找到虞汐颜的图片池`);
    return { url: DEFAULT_PLACEHOLDER, soulName: '虞汐颜' };
  }

  if (type === 'front') {
    // 如果已经生成过虞汐颜卡片，返回 null
    if (dualSoulSessionUsed) {
      console.info(`[图鉴] 虞汐颜卡片已生成，跳过重复生成`);
      return null;
    }

    // 标记为已使用
    dualSoulSessionUsed = true;

    // 正面：优先使用指定的魂体，否则随机选择
    const soul = preferredSoul ?? (Math.random() < 0.5 ? '虞汐' : '虞颜');
    cachedDualSoul = soul;
    const images = pool[`${soul}_front`];
    if (!images || images.length === 0) {
      console.warn(`[图鉴] 虞汐颜的 ${soul} 正面图片池为空`);
      return { url: DEFAULT_PLACEHOLDER, soulName: soul };
    }
    console.info(`[图鉴] 虞汐颜正面选择: ${soul}`);
    return {
      url: drawImageWithoutRepeat(`虞汐颜:${soul}_front`, images),
      soulName: soul,
    };
  } else {
    // 背面：使用另一个魂体
    // 如果 cachedDualSoul 为 null，说明出现了异常调用顺序
    if (!cachedDualSoul) {
      console.error(`[图鉴] 错误：虞汐颜背面图片获取时，正面魂体未缓存`);
      return { url: DEFAULT_PLACEHOLDER, soulName: '虞汐颜' };
    }

    const soul = cachedDualSoul === '虞汐' ? '虞颜' : '虞汐';
    const images = pool[`${soul}_back`];
    if (!images || images.length === 0) {
      console.warn(`[图鉴] 虞汐颜的 ${soul} 背面图片池为空`);
      return { url: DEFAULT_PLACEHOLDER, soulName: soul };
    }
    console.info(`[图鉴] 虞汐颜背面选择: ${soul}`);
    return {
      url: drawImageWithoutRepeat(`虞汐颜:${soul}_back`, images),
      soulName: soul,
    };
  }
}

/**
 * 标准化表情配置（将简写形式转换为完整形式）
 * 对于虞汐颜，还会返回对应的魂体名字
 *
 * 如果虞汐颜已经生成过卡片，则返回 null
 */
function normalizeExpressionImages(
  config: ExpressionImages | string,
  characterName: string,
  originalName?: string,
): (ExpressionImages & { frontName?: string; backName?: string }) | null {
  if (typeof config === 'string') {
    return { front: config, back: config };
  }

  // 处理虞汐颜的特殊逻辑
  if (characterName === '虞汐颜') {
    if (config.front === 'random_dual_front') {
      const preferredSoul = inferPreferredSoul(originalName ?? characterName);
      const frontResult = getDualSoulImage('front', preferredSoul);

      // 如果返回 null，说明已经生成过了
      if (frontResult === null) {
        return null;
      }

      const backResult = getDualSoulImage('back');
      if (backResult === null) {
        return null;
      }

      return {
        front: frontResult.url,
        back: backResult.url,
        frontName: frontResult.soulName,
        backName: backResult.soulName,
      };
    }
  }

  // 处理普通随机图片
  let front = config.front;
  let back = config.back ?? config.front;

  if (front === 'random_front') {
    front = getRandomImage(characterName, 'front');
  }
  if (back === 'random_back') {
    back = getRandomImage(characterName, 'back');
  }

  return { front, back };
}

/**
 * 获取角色正面图片URL
 * @param characterName 角色名
 * @param imgCode 表情代号
 * @returns 正面图片URL
 */
export function getCharacterImage(characterName: string, imgCode: string): string {
  const resolvedName = resolveCharacterName(characterName);
  const character = CHARACTER_ASSETS[resolvedName];
  if (!character) {
    console.warn(`[图鉴] 未找到角色 "${characterName}" 的图片配置，使用占位图`);
    return DEFAULT_PLACEHOLDER;
  }

  const config = character[imgCode] ?? character[DEFAULT_EXPRESSION];
  if (!config) {
    console.warn(`[图鉴] 角色 "${characterName}" 没有表情 "${imgCode}" 的图片，使用占位图`);
    return DEFAULT_PLACEHOLDER;
  }

  const normalized = normalizeExpressionImages(config, resolvedName, characterName);
  if (!normalized) {
    console.warn(`[图鉴] 角色 "${characterName}" 图片标准化失败，使用占位图`);
    return DEFAULT_PLACEHOLDER;
  }
  return normalized.front;
}

/**
 * 获取角色背面图片URL
 * @param characterName 角色名
 * @param imgCode 表情代号
 * @returns 背面图片URL
 */
export function getCharacterBackImage(characterName: string, imgCode: string): string {
  const resolvedName = resolveCharacterName(characterName);
  const character = CHARACTER_ASSETS[resolvedName];
  if (!character) {
    console.warn(`[图鉴] 未找到角色 "${characterName}" 的图片配置，使用占位图`);
    return DEFAULT_PLACEHOLDER;
  }

  const config = character[imgCode] ?? character[DEFAULT_EXPRESSION];
  if (!config) {
    console.warn(`[图鉴] 角色 "${characterName}" 没有表情 "${imgCode}" 的图片，使用占位图`);
    return DEFAULT_PLACEHOLDER;
  }

  const normalized = normalizeExpressionImages(config, resolvedName, characterName);
  if (!normalized || !normalized.back) {
    console.warn(`[图鉴] 角色 "${characterName}" 背面图片标准化失败，使用占位图`);
    return DEFAULT_PLACEHOLDER;
  }
  return normalized.back;
}

/**
 * 获取角色正面和背面图片URL
 * 对于虞汐颜，会返回对应的魂体名字
 *
 * 重要：每次页面加载时，虞汐颜只会生成一张卡片
 * @param characterName 角色名
 * @param imgCode 正面表情代号
 * @param backImgCode 背面表情代号（可选，默认与正面相同）
 * @returns { front: 正面URL, back: 背面URL, frontName?: 正面名字, backName?: 背面名字 } 或 null（如果虞汐颜已生成）
 */
export function getCharacterImages(
  characterName: string,
  imgCode: string,
  backImgCode?: string,
): { front: string; back: string; frontName?: string; backName?: string } | null {
  const resolvedName = resolveCharacterName(characterName);
  const character = CHARACTER_ASSETS[resolvedName];
  if (!character) {
    console.warn(`[图鉴] 未找到角色 "${characterName}" 的图片配置，使用占位图`);
    return { front: DEFAULT_PLACEHOLDER, back: DEFAULT_PLACEHOLDER };
  }

  const frontConfig = character[imgCode] ?? character[DEFAULT_EXPRESSION];
  if (!frontConfig) {
    console.warn(`[图鉴] 角色 "${characterName}" 没有表情 "${imgCode}" 的图片，使用占位图`);
    return { front: DEFAULT_PLACEHOLDER, back: DEFAULT_PLACEHOLDER };
  }

  const frontNormalized = normalizeExpressionImages(frontConfig, resolvedName, characterName);

  // 如果返回 null（虞汐颜已生成），则返回 null
  if (frontNormalized === null) {
    return null;
  }

  // 如果指定了 backImgCode，则单独获取背面图片
  let backUrl = frontNormalized.back;
  if (backImgCode && backImgCode !== imgCode) {
    const backConfig = character[backImgCode] ?? character[DEFAULT_EXPRESSION];
    if (backConfig) {
      const backNormalized = normalizeExpressionImages(backConfig, resolvedName, characterName);
      if (backNormalized && backNormalized.back) {
        backUrl = backNormalized.back;
      }
    } else {
      console.warn(`[图鉴] 角色 "${characterName}" 没有背面表情 "${backImgCode}"，使用正面背面`);
    }
  }

  if (!backUrl) {
    console.warn(`[图鉴] 角色 "${characterName}" 背面图片缺失，使用正面图片`);
    backUrl = frontNormalized.front;
  }

  return {
    front: frontNormalized.front,
    back: backUrl,
    frontName: frontNormalized.frontName,
    backName: frontNormalized.backName,
  };
}

/**
 * 重置虞汐颜的会话缓存
 * 在新的消息楼层或页面重新加载时调用
 */
export function resetDualSoulSession() {
  dualSoulSessionUsed = false;
  cachedDualSoul = null;
  console.info('[图鉴] 虞汐颜会话缓存已重置');
}

/**
 * 获取角色所有可用的表情列表
 * @param characterName 角色名
 * @returns 表情代号列表
 */
export function getAvailableExpressions(characterName: string): string[] {
  const resolvedName = resolveCharacterName(characterName);
  const character = CHARACTER_ASSETS[resolvedName];
  return character ? Object.keys(character) : [];
}

/**
 * 检查角色是否已配置
 * @param characterName 角色名
 * @returns 是否已配置
 */
export function isCharacterConfigured(characterName: string): boolean {
  const resolvedName = resolveCharacterName(characterName);
  return resolvedName in CHARACTER_ASSETS;
}
