import type { CharacterAssetConfig, CharacterImagePool } from '../types';
import { buildCharacterImageUrls } from '../image-url';

const FRONT_IMAGE_IDS = [
  64, 63, 62, 61, 60, 59, 58, 53, 52, 44, 43, 41, 40, 39, 38, 37, 36, 34, 33, 30, 29, 28, 25, 26, 23, 20, 19, 17, 16,
  15, 13, 12, 11, 10, 9, 2, 1, 77, 76, 75, 74, 73, 72, 71, 70, 78, 87, 86, 85, 84, 135, 134, 136, 133, 132, 131, 130,
  129, 126, 125, 122, 118, 117, 116, 115, 114, 112, 111, 110, 106, 107, 108, 109, 96, 97, 92, 89, 88, 93, 94, 95, 100,
  101,
] as const;

const BACK_IMAGE_IDS = [
  35, 24, 65, 66, 67, 68, 69, 3, 4, 8, 7, 6, 5, 14, 18, 22, 21, 27, 31, 32, 42, 47, 46, 45, 48, 51, 50, 49, 55, 54, 56,
  57, 81, 80, 79, 83, 82, 119, 102, 103, 104, 105, 99, 98, 90, 121, 120, 124, 123, 127, 128, 137, 113, 91,
] as const;

export const assets = {
  // 随机选择正面和背面图片
  normal: {
    front: 'random_front', // 特殊标记，表示从正面图片池中随机选择
    back: 'random_back', // 特殊标记，表示从背面图片池中随机选择
  },
} satisfies CharacterAssetConfig;

export const imagePool = {
  front: buildCharacterImageUrls('朔璃鸢', FRONT_IMAGE_IDS),
  back: buildCharacterImageUrls('朔璃鸢', BACK_IMAGE_IDS),
} satisfies CharacterImagePool;
