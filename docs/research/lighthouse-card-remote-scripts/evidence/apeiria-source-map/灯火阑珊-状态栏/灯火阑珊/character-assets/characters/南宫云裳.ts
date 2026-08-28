import type { CharacterAssetConfig, CharacterImagePool } from '../types';
import { buildCharacterImageUrls } from '../image-url';

const FRONT_IMAGE_IDS = [
  1, 3, 4, 8, 9, 10, 11, 18, 19, 20, 49, 37, 35, 34, 59, 54, 53, 52, 51, 50, 48, 42, 43, 38, 36, 67, 68, 69, 70, 66, 78,
  76, 74, 75, 73, 72, 71, 87, 86, 85, 90, 91, 92, 93, 94, 95, 96, 88, 89, 114, 113, 111, 110, 112, 118, 99, 98, 103,
  104, 105, 109, 108, 107, 106, 134, 135, 121, 122, 133, 132, 131, 130, 129, 128, 127, 126, 124, 125, 123, 147, 136,
  137, 138, 140, 139, 141, 142, 143, 144, 145,
] as const;

const BACK_IMAGE_IDS = [
  5, 6, 61, 33, 32, 31, 30, 29, 28, 27, 26, 60, 57, 56, 55, 58, 47, 46, 45, 44, 41, 40, 39, 62, 65, 64, 63, 81, 79, 77,
  83, 84, 82, 97, 102, 100, 101, 120, 119, 115, 116, 146, 148,
] as const;

export const assets = {
  // 随机选择正面和背面图片
  normal: {
    front: 'random_front', // 特殊标记，表示从正面图片池中随机选择
    back: 'random_back', // 特殊标记，表示从背面图片池中随机选择
  },
} satisfies CharacterAssetConfig;

export const imagePool = {
  front: buildCharacterImageUrls('南宫云裳', FRONT_IMAGE_IDS),
  back: buildCharacterImageUrls('南宫云裳', BACK_IMAGE_IDS),
} satisfies CharacterImagePool;
