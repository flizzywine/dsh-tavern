import type { CharacterAssetConfig, CharacterImagePool } from '../types';
import { buildCharacterImageUrls } from '../image-url';

const FRONT_IMAGE_IDS = [
  1, 2, 3, 4, 25, 29, 31, 43, 44, 42, 45, 49, 50, 51, 52, 53, 54, 55, 56, 60, 62, 64, 65, 81, 82, 84, 85, 86, 87, 94,
  98, 96, 97, 101, 102, 106, 105, 104, 103, 110, 107, 108, 90, 121, 115, 114, 113, 112, 111, 130, 129, 128, 127, 126,
  125, 124, 123, 174, 171, 173, 160, 158, 157, 156, 155, 152, 153, 150, 148, 149, 145, 144, 143, 142, 141, 140, 139,
  138, 137, 136, 135,
] as const;

const BACK_IMAGE_IDS = [
  5, 6, 7, 8, 80, 79, 78, 77, 73, 74, 75, 76, 71, 72, 70, 69, 68, 67, 66, 63, 61, 59, 58, 57, 47, 46, 48, 41, 40, 39,
  38, 37, 36, 35, 34, 33, 30, 32, 28, 27, 26, 21, 22, 23, 24, 20, 17, 18, 16, 14, 15, 13, 12, 11, 10, 9, 93, 91, 92, 95,
  99, 109, 100, 89, 88, 83, 122, 120, 119, 116, 117, 118, 132, 133, 131, 134, 147, 146, 151, 154, 159, 161, 165, 164,
  163, 162, 166, 167, 168, 169, 172, 176, 177, 175,
] as const;

export const assets = {
  // 随机选择正面和背面图片
  normal: {
    front: 'random_front', // 特殊标记，表示从正面图片池中随机选择
    back: 'random_back', // 特殊标记，表示从背面图片池中随机选择
  },
} satisfies CharacterAssetConfig;

export const imagePool = {
  front: buildCharacterImageUrls('阮忘忧', FRONT_IMAGE_IDS),
  back: buildCharacterImageUrls('阮忘忧', BACK_IMAGE_IDS),
} satisfies CharacterImagePool;
