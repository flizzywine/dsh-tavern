const kinds = { 'writing-rules': 'writingRules', guide: 'guide', script: 'scriptReference', other: 'other' };
const contextKinds = new Set(['character', 'persona', 'worldbook', ...Object.keys(kinds)]);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

/** Adapt upstream's public DTO; internal revisions/checkpoints never enter the compiler. */
export function compilerMaterials(materials) {
  const m = materials;
  if (m?.schemaVersion !== 1 || !['normal', 'regenerate', 'retry'].includes(m.reason)
    || typeof m.gameId !== 'string' || !Array.isArray(m.history)
    || typeof m.input?.raw !== 'string' || typeof m.input?.text !== 'string'
    || !Array.isArray(m.context) || m.context.some(s => !contextKinds.has(s?.kind) || typeof s.text !== 'string')
    || typeof m.identities?.characterName !== 'string' || typeof m.identities?.playerName !== 'string'
    || !object(m.state) || typeof m.state.status !== 'string' || typeof m.guidance !== 'string') {
    throw new Error('宿主正文材料格式不受支持，请使用提供正文生成接口的新版上游 DSH Tavern');
  }
  const join = kind => m.context.filter(s => s.kind === kind).map(s => s.text).join('\n\n');
  // Only the host's explicit stable-prefix section is known to be constant.
  // Other (including mixed constant/active) lore stays intact as turn material.
  const worldbook = m.context.filter(s => s.kind === 'worldbook');
  const constant = s => s.id === 'tavern:constant-worldbook';
  return structuredClone({
    // Upstream schema 1 guarantees complete visible history without a separate flag.
    schemaVersion: 1, completeness: { history: 'all-visible' }, gameId: m.gameId,
    trigger: m.reason === 'normal' ? 'normal' : 'regenerate', history: m.history,
    ...(m.scriptState ? { scriptState: m.scriptState } : {}),
    input: { raw: m.input.raw, projected: m.input.text, ...(typeof m.input.sourceText === 'string' ? { sourceText: m.input.sourceText } : {}) },
    card: { name: m.identities.characterName }, persona: { name: m.identities.playerName },
    // Already resolved, including persona: do not run card/history macros a second time.
    cardContext: [join('character'), join('persona')].filter(Boolean).join('\n\n'),
    worldbook: {
      constantContext: worldbook.filter(constant).map(s => s.text).join('\n\n'),
      context: worldbook.filter(s => !constant(s)).map(s => s.text).join('\n\n'),
    },
    beforeState: { variables: m.state.variables, messageVariables: m.state.messageVariables, posture: m.state.status },
    writingRequirements: [
      ...m.context.filter(s => Object.hasOwn(kinds, s.kind)).map(s => ({ kind: kinds[s.kind], text: s.text })),
      ...(m.guidance ? [{ kind: 'guidance', text: m.guidance }] : []),
    ],
  });
}
