export const COMPANION_ALIAS_GROUPS = [
  { canonical: '虞汐颜', aliases: ['虞汐', '虞颜'] },
  { canonical: '朔璃鸢', aliases: ['阿鸢', '血手飞鸢'] },
  { canonical: '朔望舒', aliases: ['赤月女帝', '幽影宗主'] },
  { canonical: '安迟迟', aliases: ['念迟迟', '蘅之', '拈韵居士', '掌籍师姐'] },
  { canonical: '梦杳泠', aliases: ['泠泠', '乘黄少女', '乘黄幼崽', '末代乘黄'] },
  { canonical: '羽岚', aliases: ['羽岚烟', '岚烟'] },
] as const;

export const COMPANION_CANONICAL_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  COMPANION_ALIAS_GROUPS.flatMap(({ canonical, aliases }) => aliases.map(alias => [alias, canonical])),
);

export const COMPANION_ALIASES_BY_CANONICAL: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  COMPANION_ALIAS_GROUPS.map(({ canonical, aliases }) => [canonical, aliases]),
);
