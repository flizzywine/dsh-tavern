import type { CharacterAssetConfig, CharacterImagePool } from '../types';
import { buildCharacterImageUrls } from '../image-url';

const FRONT_IMAGE_IDS = [
  72, 69, 68, 67, 65, 64, 63, 62, 61, 60, 58, 57, 52, 54, 51, 50, 49, 48, 47, 45, 44, 46, 41, 40, 38, 36, 35, 34, 27,
  25, 24, 23, 22, 20, 19, 18, 17, 16, 15, 14, 12, 8, 9, 11, 6, 5, 2, 80, 83, 87, 86, 89, 91, 90, 95, 94,
] as const;

const BACK_IMAGE_IDS = [
  4, 3, 1, 7, 10, 13, 21, 26, 29, 28, 30, 31, 33, 32, 39, 43, 42, 53, 55, 56, 59, 66, 70, 71, 75, 74, 73, 79, 77, 76,
  78, 96, 92, 93, 88, 84, 85, 82, 81,
] as const;

export const assets = {
  // 随机选择正面和背面图片
  normal: {
    front: 'random_front', // 特殊标记，表示从正面图片池中随机选择
    back: 'random_back', // 特殊标记，表示从背面图片池中随机选择
  },
} satisfies CharacterAssetConfig;

export const imagePool = {
  front: buildCharacterImageUrls('安迟迟', FRONT_IMAGE_IDS),
  back: buildCharacterImageUrls('安迟迟', BACK_IMAGE_IDS),
} satisfies CharacterImagePool;
