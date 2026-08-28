import type { CharacterAssetConfig, CharacterImagePool } from '../types';
import { buildCharacterImageUrls } from '../image-url';

const FRONT_IMAGE_IDS = [
  2, 1, 3, 4, 5, 6, 7, 8, 9, 11, 13, 12, 14, 15, 16, 17, 18, 19, 21, 20, 22, 54, 53, 45, 49, 34, 55, 57, 56, 58, 59, 60,
  63, 65, 64, 67, 68, 69, 71, 70, 77, 89, 87, 86, 83, 82, 97, 96, 95, 94, 92, 91, 110, 108, 107, 106, 105, 103, 102,
  101, 100, 138, 137, 136, 135, 134, 133, 132, 131, 130, 129, 128, 127, 126, 125, 124, 123, 121, 120, 119, 118, 117,
  114, 113, 112, 111, 142, 144, 140,
] as const;

const BACK_IMAGE_IDS = [
  26, 27, 24, 23, 25, 37, 36, 35, 48, 47, 46, 38, 52, 51, 50, 44, 42, 41, 40, 39, 33, 32, 31, 29, 30, 28, 62, 61, 72,
  73, 74, 76, 75, 79, 78, 80, 81, 99, 98, 93, 90, 84, 115, 116, 122, 104, 109, 139, 143, 141,
] as const;

export const assets = {
  // 随机选择正面和背面图片
  normal: {
    front: 'random_front', // 特殊标记，表示从正面图片池中随机选择
    back: 'random_back', // 特殊标记，表示从背面图片池中随机选择
  },
} satisfies CharacterAssetConfig;

export const imagePool = {
  front: buildCharacterImageUrls('梦杳泠', FRONT_IMAGE_IDS),
  back: buildCharacterImageUrls('梦杳泠', BACK_IMAGE_IDS),
} satisfies CharacterImagePool;
