const CHARACTER_IMAGE_BASE_URL = 'https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo';

export type CharacterImageToken = number | string;

/** 数字使用“角色名 (编号).png”；字符串作为历史文件名原样拼接。 */
export function buildCharacterImageUrls(characterName: string, tokens: readonly CharacterImageToken[]): string[] {
  return tokens.map(token => {
    const filename = typeof token === 'number' ? `${characterName} (${token}).png` : token;
    return `${CHARACTER_IMAGE_BASE_URL}/${filename}`;
  });
}
