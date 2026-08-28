export const GENERIC_MAP_LAYERS = ['天层', '地层', '下层'] as const;

export const LAND_MAP_DOMAINS = ['神州', '东苍', '南炎', '西庚', '北冥'] as const;

/**
 * 海域在地图定位中与五大地域同级；“四海”仅保留为旧数据和总称入口。
 */
export const SEA_MAP_DOMAINS = [
  '四海',
  '潮音海',
  '龙眠海',
  '蓬莱幻海',
  '北冥冰海',
  '无尽洋',
  '天泣洋',
  '永夜海域',
  '雷暴海',
] as const;

export const BORDER_MAP_DOMAINS = ['苍茫古径', '赤金走廊', '雪线', '龙眠海峡'] as const;
export const CELESTIAL_MAP_DOMAINS = ['天渊', '星陨废墟', '太古战场', '天道裂隙'] as const;
export const ABYSS_MAP_DOMAINS = ['归墟', '碎金渊', '黄泉古迹', '无尽炎渊', '神木枯冢'] as const;
export const SPECIAL_MAP_DOMAINS = ['倒悬天墟'] as const;

export const SPECIFIC_MAP_DOMAINS = [
  ...LAND_MAP_DOMAINS,
  ...SEA_MAP_DOMAINS,
  ...BORDER_MAP_DOMAINS,
  ...CELESTIAL_MAP_DOMAINS,
  ...ABYSS_MAP_DOMAINS,
  ...SPECIAL_MAP_DOMAINS,
] as const;

/** 地点库“域”允许使用的完整标准值。 */
export const LOCATION_DOMAIN_VALUES = [...GENERIC_MAP_LAYERS, ...SPECIFIC_MAP_DOMAINS] as const;

export const MAP_ANCHOR_ALIASES: Record<string, string> = {
  中州: '神州',
  中原: '神州',
  东荒: '东苍',
  南疆: '南炎',
  西漠: '西庚',
  北域: '北冥',
  外海: '四海',
  归墟之海: '永夜海域',
  万剑冢: '碎金渊',
  '碎金渊·万剑冢': '碎金渊',
  下霄: '星陨废墟',
  '星陨废墟（下霄）': '星陨废墟',
  中霄: '太古战场',
  九天遗迹: '太古战场',
  '太古战场·九天遗迹（中霄）': '太古战场',
  上霄: '天道裂隙',
  '天道裂隙（上霄）': '天道裂隙',
  '倒悬天墟·五行逆反界': '倒悬天墟',
};

const mapDomainSet = new Set<string>(SPECIFIC_MAP_DOMAINS);
const genericLayerSet = new Set<string>(GENERIC_MAP_LAYERS);
const searchableAnchors = [...SPECIFIC_MAP_DOMAINS].sort((left, right) => right.length - left.length);
const searchableAliases = Object.entries(MAP_ANCHOR_ALIASES).sort(([left], [right]) => right.length - left.length);

const text = (value: unknown): string => String(value ?? '').trim();

export const isSpecificMapDomain = (value: unknown): boolean => mapDomainSet.has(text(value));
export const isGenericMapLayer = (value: unknown): boolean => genericLayerSet.has(text(value));

export const normalizeMapAnchor = (value: unknown): string => {
  const normalized = text(value);
  if (!normalized) return '';
  if (mapDomainSet.has(normalized)) return normalized;
  if (MAP_ANCHOR_ALIASES[normalized]) return MAP_ANCHOR_ALIASES[normalized];

  for (const anchor of searchableAnchors) {
    if (normalized.includes(anchor)) return anchor;
  }
  for (const [alias, anchor] of searchableAliases) {
    if (normalized.includes(alias)) return anchor;
  }
  return '';
};

type LocationRecord = Record<string, { 域?: string; 特?: string }>;
type WorldMapRecord = Record<string, { layer?: string; desc?: string; connections?: string[] }>;

export interface ResolveMapAnchorInput {
  currentRegion: string;
  currentDomain?: string;
  environmentDesc?: string;
  anchors?: Record<string, string>;
  locationLib?: LocationRecord;
  worldMap?: WorldMapRecord;
}

const findRecordValue = <T>(record: Record<string, T> | undefined, region: string): T | undefined => {
  if (!record || !region) return undefined;
  if (record[region]) return record[region];

  const normalizedRegion = region.replace(/[\s·•\-—_：:／/|]/g, '');
  return Object.entries(record).find(([name]) => {
    const normalizedName = text(name).replace(/[\s·•\-—_：:／/|]/g, '');
    return normalizedName && (normalizedRegion.includes(normalizedName) || normalizedName.includes(normalizedRegion));
  })?.[1];
};

/**
 * 解析伪同层地图落点。优先级：显式锚点 > 当前地点就是地图域 > 地点库域 > 描述中的地图域 > 已推断地域。
 */
export const resolveMapAnchor = ({
  currentRegion,
  currentDomain = '',
  environmentDesc = '',
  anchors,
  locationLib,
  worldMap,
}: ResolveMapAnchorInput): string => {
  const region = text(currentRegion);
  const explicitAnchor = normalizeMapAnchor(anchors?.[region]);
  if (explicitAnchor) return explicitAnchor;

  const directRegion = normalizeMapAnchor(region);
  if (directRegion) return directRegion;

  const location = findRecordValue(locationLib, region);
  const locationDomain = normalizeMapAnchor(location?.域);
  if (locationDomain) return locationDomain;

  const mapEntry = findRecordValue(worldMap, region);
  const descriptiveAnchor = normalizeMapAnchor(
    [location?.特, mapEntry?.desc, ...(mapEntry?.connections ?? []), environmentDesc].filter(Boolean).join(' '),
  );
  if (descriptiveAnchor) return descriptiveAnchor;

  return normalizeMapAnchor(currentDomain);
};
