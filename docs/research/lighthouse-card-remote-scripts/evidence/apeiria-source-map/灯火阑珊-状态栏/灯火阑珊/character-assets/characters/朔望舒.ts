import type { CharacterAssetConfig, CharacterImagePool } from '../types';
import { buildCharacterImageUrls } from '../image-url';

const FRONT_IMAGE_IDS = [
  7, 9, 15, 18, 20, 23, 21, 25, 27, 30, 29, 36, 40, 38, 41, 43, 44, 47, 46, 45, 48, 52, 51, 50, 49, 53, 54, 55, 56, 60,
  59, 58, 57, 61, 62, 63, 1, 2, 3, 67, 66, 71, 72, 73, 76, 83, 82, 114, 112, 111, 104, 106, 99, 101, 102, 97, 89, 88,
  84, 151, 155, 154, 153, 152, 149, 148, 150, 146, 147, 145, 144, 142, 134, 133, 132, 131, 130, 129, 128, 127, 126, 125,
  124, 157, 156, 158, 159, 122, 120, 123, 119, 118, 116, 115,
] as const;

const BACK_IMAGE_IDS = [
  81, 80, 78, 79, 75, 74, 69, 68, 4, 65, 64, 42, 37, 33, 34, 31, 32, 26, 28, 24, 22, 19, 17, 14, 16, 12, 11, 10, 8, 6,
  95, 113, 107, 108, 109, 110, 100, 96, 98, 94, 93, 91, 90, 87, 85, 86, 105, 103, 143, 141, 140, 139, 138, 137, 136,
  135, 121, 117,
] as const;

export const assets = {
  // 随机选择正面和背面图片
  normal: {
    front: 'random_front', // 特殊标记，表示从正面图片池中随机选择
    back: 'random_back', // 特殊标记，表示从背面图片池中随机选择
  },
} satisfies CharacterAssetConfig;

export const imagePool = {
  front: buildCharacterImageUrls('朔望舒', FRONT_IMAGE_IDS),
  back: buildCharacterImageUrls('朔望舒', BACK_IMAGE_IDS),
} satisfies CharacterImagePool;
