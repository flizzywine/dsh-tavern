import type { CharacterAssetConfig, CharacterImagePool } from '../types';
import { buildCharacterImageUrls } from '../image-url';

const FRONT_IMAGE_IDS = [
  2, 1, 6, 3, 10, 11, 12, 7, 8, 9, 24, 30, 29, 28, 43, 42, 41, 50, 49, 52, 51, 53, 54, 36, 35, 39, 38, 37, 40, 62, 61,
  60, 59, 63, 71, 70, 69, 68, 67, 66, 64, 65, 74, 78, 84, 86, 85, 87, 92, 90, 89, 95, 96, 93, 97, 104, 103, 102, 101,
  105, 79, 113, 112, 109, 106, 138, 137, 107, 111, 133, 135, 127, 129, 123, 124, 122, 136, 108, 118, 116,
] as const;

const BACK_IMAGE_IDS = [
  13, 14, 15, 16, 17, 20, 21, 18, 19, 22, 23, 34, 27, 26, 25, 31, 32, 33, 56, 55, 47, 46, 45, 44, 48, 57, 58, 73, 72,
  75, 76, 77, 89, 81, 80, 100, 99, 98, 94, 88, 91, 83, 82, 114, 110, 139, 134, 132, 131, 130, 117, 119, 120, 115, 126,
  128,
] as const;

export const assets = {
  // 随机选择正面和背面图片
  normal: {
    front: 'random_front', // 特殊标记，表示从正面图片池中随机选择
    back: 'random_back', // 特殊标记，表示从背面图片池中随机选择
  },
} satisfies CharacterAssetConfig;

export const imagePool = {
  front: buildCharacterImageUrls('晚棠', FRONT_IMAGE_IDS),
  back: buildCharacterImageUrls('晚棠', BACK_IMAGE_IDS),
} satisfies CharacterImagePool;
