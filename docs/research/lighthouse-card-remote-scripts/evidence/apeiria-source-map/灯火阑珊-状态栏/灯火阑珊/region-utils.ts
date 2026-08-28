import {
  GENERIC_MAP_LAYERS,
  MAP_ANCHOR_ALIASES,
  SPECIFIC_MAP_DOMAINS,
  isGenericMapLayer,
  isSpecificMapDomain,
} from './map-system';

const GENERIC_LAYERS = GENERIC_MAP_LAYERS;
const SPECIFIC_DOMAINS = SPECIFIC_MAP_DOMAINS;

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  神州: ['神州', '中州', '中原'],
  东苍: ['东苍', '东荒'],
  南炎: ['南炎', '南疆'],
  西庚: ['西庚', '西漠'],
  北冥: ['北冥', '北域'],
  四海: ['四海', '外海'],
  潮音海: ['潮音海'],
  龙眠海: ['龙眠海'],
  蓬莱幻海: ['蓬莱幻海'],
  北冥冰海: ['北冥冰海'],
  无尽洋: ['无尽洋'],
  天泣洋: ['天泣洋'],
  永夜海域: ['永夜海域', '归墟之海'],
  天渊: ['天渊'],
  星陨废墟: ['星陨废墟', '下霄'],
  太古战场: ['太古战场', '九天遗迹', '中霄'],
  天道裂隙: ['天道裂隙', '上霄'],
  归墟: ['归墟'],
  碎金渊: ['碎金渊', '万剑冢'],
  黄泉古迹: ['黄泉古迹', '黄泉'],
  无尽炎渊: ['无尽炎渊', '炎渊'],
  雷暴海: ['雷暴海'],
  龙眠海峡: ['龙眠海峡'],
  苍茫古径: ['苍茫古径'],
  赤金走廊: ['赤金走廊'],
  雪线: ['雪线'],
  神木枯冢: ['神木枯冢', '万古枯荣渊'],
  倒悬天墟: ['倒悬天墟', '五行逆反界'],
};

export const ALL_KNOWN_REGIONS = [...GENERIC_LAYERS, ...SPECIFIC_DOMAINS] as readonly string[];
export const GENERIC_LAYERS_LIST = [...GENERIC_LAYERS] as readonly string[];
export const SPECIFIC_DOMAINS_LIST = [...SPECIFIC_DOMAINS] as readonly string[];

export const isSpecificDomain = (value: string): boolean => isSpecificMapDomain(value);
export const isGenericLayer = (value: string): boolean => isGenericMapLayer(value);

export const normalizeRegionName = (value: string): string => {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';

  const parts = cleaned
    .split(/[·•\-—_：:／/|]/)
    .map(s => s.trim())
    .filter(Boolean);

  if (parts.length >= 2 && ALL_KNOWN_REGIONS.includes(parts[0])) {
    return parts.slice(1).join('');
  }
  return cleaned;
};

export const extractDomainFromText = (text: string): string => {
  const source = String(text || '');
  if (!source) return '';

  for (const domain of [...SPECIFIC_DOMAINS].sort((left, right) => right.length - left.length)) {
    if (source.includes(domain)) return domain;
  }

  for (const [alias, domain] of Object.entries(MAP_ANCHOR_ALIASES).sort(
    ([left], [right]) => right.length - left.length,
  )) {
    if (source.includes(alias)) return domain;
  }

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some(k => source.includes(k))) return domain;
  }

  return '';
};

const inferDomainFromRecord = <TValue>(
  currentRegionRaw: string,
  currentRegion: string,
  record: Record<string, TValue> | undefined,
  getDomain: (value: TValue) => string | undefined,
): string => {
  if (!record) return '';

  const rawRegion = String(currentRegionRaw || '').trim();
  const candidates = Array.from(
    new Set(
      [rawRegion, currentRegion, normalizeRegionName(rawRegion), normalizeRegionName(currentRegion)].filter(Boolean),
    ),
  );

  for (const candidate of candidates) {
    const directMatch = record[candidate];
    const directDomain = directMatch ? String(getDomain(directMatch) || '').trim() : '';
    if (isSpecificDomain(directDomain) || isGenericLayer(directDomain)) {
      return directDomain;
    }
  }

  let bestMatch = '';
  let bestDomain = '';

  for (const [name, value] of Object.entries(record)) {
    const domain = String(getDomain(value) || '').trim();
    if (!isSpecificDomain(domain) && !isGenericLayer(domain)) continue;

    const normalizedName = normalizeRegionName(name);
    if (!normalizedName) continue;

    const matched = candidates.some(
      candidate => candidate.includes(normalizedName) || normalizedName.includes(candidate),
    );
    if (!matched) continue;

    if (normalizedName.length > bestMatch.length) {
      bestMatch = normalizedName;
      bestDomain = domain;
    }
  }

  return bestDomain;
};

export const inferLayerFromTrack = (
  currentRegionRaw: string,
  layerRaw: string,
  environmentDesc: string,
  locationLib?: Record<string, { 域?: string }>,
  worldMap?: Record<string, { layer?: string }>,
  previousLayer?: string,
): string => {
  const currentRegion = normalizeRegionName(currentRegionRaw);
  const layer = String(layerRaw || '').trim();
  const prev = String(previousLayer || '').trim();

  const inlineDomain = extractDomainFromText(String(currentRegionRaw || ''));
  if (inlineDomain) return inlineDomain;

  const locationDomain = inferDomainFromRecord(currentRegionRaw, currentRegion, locationLib, value =>
    String((value as { 域?: string })?.域 || ''),
  );
  if (isSpecificDomain(locationDomain)) return locationDomain;

  const mapDomain = inferDomainFromRecord(currentRegionRaw, currentRegion, worldMap, value =>
    String((value as { layer?: string })?.layer || ''),
  );
  if (isSpecificDomain(mapDomain)) return mapDomain;

  if (isSpecificDomain(layer)) return layer;

  if (isGenericLayer(layer)) {
    const fallbackDomain = extractDomainFromText(
      `${String(currentRegionRaw || '')} ${currentRegion} ${String(environmentDesc || '')}`,
    );
    if (fallbackDomain) return fallbackDomain;

    // 当前地点库/世界地图已经明确写了泛层级时，以当前记录为准，不能继承上一地点的旧地域。
    if (isGenericLayer(locationDomain)) return locationDomain;
    if (isGenericLayer(mapDomain)) return mapDomain;
    return layer;
  }

  if (isSpecificDomain(prev)) return prev;

  return layer;
};
