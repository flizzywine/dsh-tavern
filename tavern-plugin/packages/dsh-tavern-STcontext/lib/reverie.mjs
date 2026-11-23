import { createHash } from 'node:crypto';

// The 3.18.1 general loader identifies the settings contract. Only local values
// used during story generation are consumed; the bootstrap itself never runs.
const loaderHash = '8fbbf2189fda23a10f002a3f9accd1f875db139d232b7c9a22f2c9ae8759ec88';
export function isReverieLoader(source) {
  if (typeof source !== 'string' || !source.includes('destined-journey-assistant-general.js')) return false;
  return createHash('sha256').update(source.replace(/\r\n/g, '\n').trim()).digest('hex') === loaderHash;
}

export const reverieMacros = Object.freeze({ general_prompt_noise: '' });
const shortNames = '字数|字数要求|对白比例|对白轮次|战斗回合|人称|人称要求|正文语言|思维链语言|全局设定|全局偏好|用户附加设定|女性体型池|男性体型池';
const shortMacros = new RegExp('<\\|(' + shortNames + ')\\|>', 'gu');
// Reserved spellings quoted in chat, card or managed settings are literal data.
export const reverieLiteralTags = new RegExp('<\\|(?:placeholder|命定_[^|>\r\n]+|' + shortNames + ')\\|>', 'gu');

const bodyWeights = {
  female_build: { 骨感: 1, 纤细: 6, 匀称: 8, 健美: 3, 丰腴: 4, 微胖: 1 },
  female_bust: { 平坦: 1, 小巧: 3, 适中: 4, 丰满: 3, 巨乳: 1 },
  male_build: { 瘦削: 1, 匀称: 6, 精壮: 5, 魁梧: 3, 敦实: 2, 肥胖: 1 },
};

function drawBodyTrait(category, weights, random) {
  const defaults = bodyWeights[category];
  const options = Object.entries(defaults).map(([name, fallback]) => {
    const raw = weights?.[category]?.[name];
    const weight = raw == null || raw === '' ? NaN : Number(raw);
    return [name, Number.isInteger(weight) && weight >= 0 && weight <= 10 ? weight : fallback];
  });
  const choices = options.some(([, weight]) => weight > 0) ? options : Object.entries(defaults);
  let draw = random() * choices.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of choices) {
    draw -= weight;
    if (draw < 0) return name;
  }
  return choices.at(-1)[0];
}

function settingList(entries, env) {
  if (!Array.isArray(entries)) return '';
  const identities = /\{\{\s*(user|char|charIfNotGroup|group)\s*\}\}|<(user|char|bot|charIfNotGroup|group)>/gi;
  return entries.filter(item => item?.enabled === true && typeof item.text === 'string' && item.text.trim())
    .map(item => '- ' + item.text.trim().replace(/\r\n?/g, '\n').replace(/\n/g, '\n  ')
      .replace(identities, (_, macro, tag) => (macro ?? tag).toLowerCase() === 'user' ? env.userName : env.charName))
    .join('\n');
}

export function createReverieShortMacros(settings, env, opaque) {
  const values = settings.managedValues;
  const min = values.min_hanzi ?? '1500', max = values.max_hanzi ?? '2500';
  const person = { first: '第一', second: '第二', third: '第三' };
  const narration = Object.hasOwn(person, values.narration_person) ? values.narration_person : 'third';
  const lengths = { minimum: '不少于' + min, maximum: '不多于' + max, range: min + '—' + max };
  const shared = settingList(values.global_settings, env);
  const macros = {
    字数: min, 字数要求: Object.hasOwn(lengths, values.length_mode) ? lengths[values.length_mode] : lengths.minimum,
    正文语言: values.body_language ?? '简体中文', 思维链语言: values.thinking_language ?? '简体中文',
    对白比例: values.dialogue_ratio ?? '40', 对白轮次: values.dialogue_round_trips ?? '3', 战斗回合: values.combat_rounds ?? '1',
    人称: narration, 人称要求: '必须以' + person[narration] + '人称有限视角创作正文',
    用户附加设定: settingList(values.user_additional_settings, env), 全局设定: shared, 全局偏好: shared,
  };
  const draw = category => drawBodyTrait(category, values.body_pool, env.random);
  return text => text.replace(shortMacros, (_, name) => {
    if (name === '女性体型池' || name === '男性体型池') {
      const samples = Array.from({ length: 3 }, () => name === '女性体型池'
        ? draw('female_build') + '·' + draw('female_bust') : draw('male_build'));
      return '[' + samples.join(', ') + ']';
    }
    return opaque(String(macros[name]));
  });
}
