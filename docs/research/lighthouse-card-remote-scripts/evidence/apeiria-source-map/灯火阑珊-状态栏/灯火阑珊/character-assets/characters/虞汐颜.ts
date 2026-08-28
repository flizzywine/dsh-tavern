import type { CharacterAssetConfig, DualSoulImagePool } from '../types';
import { buildCharacterImageUrls } from '../image-url';

const YUXI_FRONT_IMAGE_IDS = [
  1, 15, 16, 6, 5, 3, 2, 13, 11, 14, 10, 12, 18, 24, 23, 26, 25, 37, 36, 43, 41, 45, 46, 44, 47, 77, 74, 75, 73, 72, 69,
  68, 71, 70, 67, 66, 65, 57, 56, 49, 50, 88, 87, 89, 90, 86, 85, 93, 92, 91, 96, 97, 79, 80, 81, 83, 84, 106, 105, 104,
  114, 112, 111, 116, 115, 140, 139, 136, 135, 134, 133, 132, 131, 128, 127, 126, 124, 123, 122, 119, 120, 117, 118,
  145, 141,
] as const;

const YUXI_BACK_IMAGE_IDS = [
  17, 8, 7, 4, 20, 19, 33, 29, 30, 31, 28, 27, 34, 35, 39, 38, 42, 40, 59, 58, 60, 48, 94, 78, 98, 95, 99, 109, 113,
  103, 102, 101, 100, 130, 146, 125, 121, 144, 143, 138, 129, 142,
] as const;

const YUYAN_FRONT_IMAGE_IDS = [
  15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 1, 16, 17, 19, 21, 89, 88, 87, 86, 82, 84, 83, 78, 81, 77, 76, 75, 74, 73, 72, 71,
  70, 68, 65, 64, 61, 60, 56, 54, 55, 53, 97, 96, 98, 99, 103, 102, 100, 104, 108, 109, 110, 111, 115, 114, 113, 112,
  117, 119, 118, 123, 122, 121, 125, 126, 127, 128, 131, 139, 137, 135, 149, 146, 144, 145, 143, 142, 141, 140,
] as const;

const YUYAN_BACK_IMAGE_IDS = [
  5, 4, 3, 2, 18, 20, 22, 23, 24, 28, 25, 39, 29, 32, 31, 30, 33, 34, 35, 36, 37, 38, 44, 45, 46, 47, 52, 43, 42, 50,
  51, 49, 48, 85, 79, 80, 67, 66, 63, 62, 59, 58, 57, 93, 94, 95, 101, 105, 106, 107, 116, 120, 124, 129, 136, 132, 133,
  134, 138, 130, 148, 147,
] as const;

export const assets = {
  // 随机选择正面和背面图片
  // 特殊逻辑：正面虞汐时背面虞颜，正面虞颜时背面虞汐
  normal: {
    front: 'random_dual_front', // 特殊标记，随机选择虞汐或虞颜的正面
    back: 'random_dual_back', // 特殊标记，自动选择另一个魂体的背面
  },
} satisfies CharacterAssetConfig;

export const imagePool = {
  虞汐_front: buildCharacterImageUrls('虞汐', YUXI_FRONT_IMAGE_IDS),
  虞汐_back: buildCharacterImageUrls('虞汐', YUXI_BACK_IMAGE_IDS),
  虞颜_front: buildCharacterImageUrls('虞颜', YUYAN_FRONT_IMAGE_IDS),
  虞颜_back: buildCharacterImageUrls('虞颜', YUYAN_BACK_IMAGE_IDS),
} satisfies DualSoulImagePool;
