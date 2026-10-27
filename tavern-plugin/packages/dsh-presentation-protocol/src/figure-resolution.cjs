// shared exact identity resolution, no media or storage access.
const figureResolution = (() => {
// Pure recall evidence. OpenCC subset attribution: https://github.com/BYVoid/OpenCC (Apache-2.0).
const traditional = '醫學樓門開關聲風雨電車馬鈴鐘書館場園廳間網機鐵橋邊廣辦廚臥寢臺燈牆戰鬥劍槍擊響腳步葉鳥蟲蟬貓龍靈藥煉爐陣雲霧島灣樹林綠紅黃藍驚動靜樂溫暖懸謎險傷祕舊報話訊號櫃課體泳禮營礦窯獄廟廢遺跡鎮鄉莊農倉庫邁進傳來後裡遠處側陰陽曉晚時長廊實驗術藝計腦飛發髮滿覺麗區鄰賣買貨攤飲煙塵滅爆彈殼鎖鑰敲碎落濺濕濤浪轟轎輪軌輛廠產經濟會議訓練護衛隊軍敵聖殿國宮寬窄圍觀戲劇院幹'
const simplified = '医学楼门开关声风雨电车马铃钟书馆场园厅间网机铁桥边广办厨卧寝台灯墙战斗剑枪击响脚步叶鸟虫蝉猫龙灵药炼炉阵云雾岛湾树林绿红黄蓝惊动静乐温暖悬谜险伤秘旧报话讯号柜课体泳礼营矿窑狱庙废遗迹镇乡庄农仓库迈进传来后里远处侧阴阳晓晚时长廊实验术艺计脑飞发发满觉丽区邻卖买货摊饮烟尘灭爆弹壳锁钥敲碎落溅湿涛浪轰轿轮轨辆厂产经济会议训练护卫队军敌圣殿国宫宽窄围观戏剧院干'
const conversion = new Map([...traditional].map((c, i) => [c, [...simplified][i]]))
const traditionalPattern = new RegExp('[' + traditional + ']', 'gu')
const length = value => [...value].length
const codepointCompare = (a, b) => {
  const x = [...String(a)], y = [...String(b)]
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d }
  return x.length - y.length
}

function normalizeCatalogueText(value) {
  return String(value ?? '').normalize('NFKC').replace(traditionalPattern, c => conversion.get(c)).toLowerCase().replace(/\s+/gu, ' ').trim()
}


// Shared display normalization; director resources retain their identity suffix.
function promptHandleStem(value, separator = '_', limit = 24) {
  return [...String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, separator).replace(new RegExp('^' + separator + '|' + separator + '$', 'g'), '')].slice(0, limit).join('')
}
const speakerKey = row => row.actorKey || row.alias
const speakerIdentity = row => row.ref ? row.ref.packId + '/' + row.ref.figureId : speakerKey(row)
function speakerStem(row) {
  const aliases = row.aliases || []
  const readable = aliases.find(value => /^[a-z][a-z0-9 _-]*$/i.test(value)) || aliases[0]
  return promptHandleStem(normalizeCatalogueText(readable || (!row.ref && row.alias) || row.name)) || 'speaker'
}
// Derive from the full card, not the recalled subset. No stored alias table or turn state.
// One pass over the enabled rows: each row's stem, the identities sharing a stem and the identities owning each normalized
// name/alias/key. A handle then costs set lookups, so resolving a name over a whole library is linear, not quadratic
// .
function speakerIndex(rows) {
  const peers = new Map(), owners = new Map(), stems = new Set()
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(value) }
  for (const other of rows) {
    if (other.enabled === false) continue
    const stem = speakerStem(other), identity = speakerIdentity(other)
    stems.add(stem); add(peers, stem, identity)
    for (const value of [speakerKey(other), other.name, ...(other.aliases || [])]) add(owners, normalizeCatalogueText(value), identity)
  }
  return {peers, owners, stems, sorted:new Map()}
}
function indexedSpeakerHandle(index, row) {
  const stem = speakerStem(row), key = speakerIdentity(row)
  if (!index.sorted.has(stem)) index.sorted.set(stem, [...(index.peers.get(stem) || [])].sort(codepointCompare))
  const peers = index.sorted.get(stem)
  if (peers.length === 1 && ![...(index.owners.get(stem) || [])].some(identity => identity !== key)) return stem
  const rank = peers.indexOf(key) + 1
  let ordinal = 0, suffix = 0, candidate
  do {
    candidate = stem + '_' + ++suffix
    if (!index.stems.has(candidate) && !index.owners.has(candidate)) ordinal++
  } while (ordinal < rank)
  return candidate
}
function figureSpeakerHandle(rows, row) {
  return indexedSpeakerHandle(speakerIndex(rows), row)
}

// Exact names and aliases authorize identity; outfit trigger words never do.
function resolveFigureName(rows, segment = {}) {
  const alias = normalizeCatalogueText(typeof segment === 'string' ? segment : segment.alias);
  const name = normalizeCatalogueText(typeof segment === 'string' ? '' : segment.name);
  const available = rows.filter(row => row.enabled !== false);
  const matchesRef = (row, ref) => row.ref && ref && row.ref.packId === ref.packId && row.ref.figureId === ref.figureId;
  const byRef = ref => available.find(row => matchesRef(row,ref));
  if (segment.figureId) {
    const row = byRef(segment);
    return row ? {status:'resolved', actorKey:row.actorKey, ref:row.ref, row} : {status:'unavailable', ref:segment};
  }
  const exact = value => available.filter(row => normalizeCatalogueText(row.name) === value);
  const named = name ? exact(name) : [];
  const candidates = available.filter(row => (row.aliases || []).some(value => normalizeCatalogueText(value) === alias || name && normalizeCatalogueText(value) === name));
  const exactMatches = named.length ? named : exact(alias);
  const exactAmbiguous = new Set(exactMatches.map(speakerIdentity)).size > 1;
  const ambiguous = exactAmbiguous || new Set(candidates.map(speakerIdentity)).size > 1;
  const handleMatch = () => { const index = speakerIndex(rows); return available.find(row => normalizeCatalogueText(indexedSpeakerHandle(index, row)) === alias) };
  const found = available.find(row => row.actorKey === alias) || handleMatch()
    || (!exactAmbiguous && exactMatches[0]) || (!ambiguous && candidates[0]);
  if (!found) return {status:ambiguous ? 'ambiguous' : 'unknown'};
  if (named.length && !named.some(row => speakerIdentity(row) === speakerIdentity(found))) return {status:'conflict', actorKey:found.actorKey, ref:found.ref};
  return {status:'resolved', actorKey:found.actorKey, ref:found.ref, row:found};
}
return {normalizeCatalogueText, codepointCompare, promptHandleStem, figureSpeakerHandle, resolveFigureName};
})();
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = figureResolution;
