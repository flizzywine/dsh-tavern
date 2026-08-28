import type { CharacterAssetConfig, CharacterImagePool } from '../types';
import { buildCharacterImageUrls } from '../image-url';

const FRONT_IMAGE_IDS = [
  1, 2, 3, 4, 5, 24, 25, 26, 27, 28, 29, 31, 64, 65, 77, 76, 75, 74, 70, 69, 68, 67, 71, 72, 73, 80, 102, 101, 97, 92,
  89, 90, 91, 86, 83, 111, 110, 109, 105, 106, 108, 104, 119, 120, 115, 116, 125, 128, 129, 133, 132, 131, 136, 137,
  138, 140, 139, 141, 153, 152, 151, 149, 148, 146, 145, 157, 155, 173, 174, 172, 158, 176, 159, 166, 165, 162, 161,
] as const;

const BACK_IMAGE_IDS = [
  6, 7, 8, 9, 14, 15, 17, 18, 19, 20, 21, 16, 22, 33, 23, 30, 32, 34, 35, 36, 42, 43, 44, 40, 39, 38, 37, 41, 54, 55,
  56, 59, 58, 57, 60, 45, 63, 53, 52, 51, 50, 47, 46, 48, 49, 62, 61, 66, 96, 85, 88, 93, 95, 94, 98, 99, 100, 78, 82,
  81, 79, 107, 112, 114, 113, 118, 117, 121, 122, 103, 123, 124, 130, 126, 127, 134, 135, 142, 144, 143, 150, 147, 156,
  154, 167, 164, 163, 170, 169, 171, 175, 177,
] as const;

export const assets = {
  // 随机选择正面和背面图片
  normal: {
    front: 'random_front', // 特殊标记，表示从正面图片池中随机选择
    back: 'random_back', // 特殊标记，表示从背面图片池中随机选择
  },
} satisfies CharacterAssetConfig;

export const imagePool = {
  front: buildCharacterImageUrls('许听雨', FRONT_IMAGE_IDS),
  back: buildCharacterImageUrls('许听雨', BACK_IMAGE_IDS),
} satisfies CharacterImagePool;
