import { describeRealmByLevel } from '../schema';

const DISPLAY_GUARD_INSTALLED_KEY = '__踏月寻仙_updatevariable_display_guard_installed__';
const READONLY_DERIVED_FIELDS = new Set(['突破阈值', '寿元上限', '境界描述', '寿元状态', '状态', '进度']);
const UPDATE_VARIABLE_BLOCK_REGEX = /<update(?:variable)?>([\s\S]*?)<\/update(?:variable)?>/i;
const ANALYSIS_TAG_REGEX = /<analysis>([\s\S]*?)<\/analysis>/i;
const JSON_PATCH_TAG_REGEX = /<jsonpatch>([\s\S]*?)<\/jsonpatch>/i;

type JsonPatchItem = {
  op?: string;
  path?: string;
  value?: unknown;
};

type RealmCorrection = {
  wrong: string;
  correct: string;
};

function normalizeJsonPointer(path: unknown): string {
  let normalized = String(path ?? '').trim();
  if (!normalized) return normalized;
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized.replace(/^\/+/, '')}`;
  }
  return normalized.replaceAll('／', '/').replace(/\/+/g, '/');
}

function isReadonlyDerivedPatchPath(path: string): boolean {
  const match = path.match(/^\/(?:本尊|红颜\/[^/]+|NPC图鉴\/[^/]+)\/([^/]+)$/);
  return !!match && READONLY_DERIVED_FIELDS.has(match[1]);
}

function buildRealmCorrections(patchItems: JsonPatchItem[]): RealmCorrection[] {
  const corrections: RealmCorrection[] = [];
  const protagonistLevelPatch = patchItems.find(item => normalizeJsonPointer(item.path) === '/本尊/等级');
  const protagonistRealmPatch = patchItems.find(item => normalizeJsonPointer(item.path) === '/本尊/境界描述');
  const protagonistLevel = Number(protagonistLevelPatch?.value);

  if (Number.isFinite(protagonistLevel) && typeof protagonistRealmPatch?.value === 'string') {
    const wrong = String(protagonistRealmPatch.value).trim();
    const correct = describeRealmByLevel(protagonistLevel);
    if (wrong && wrong !== correct) {
      corrections.push({ wrong, correct });
    }
  }

  const companionLevelMap = new Map<string, string>();
  for (const item of patchItems) {
    const match = normalizeJsonPointer(item.path).match(/^\/红颜\/([^/]+)\/等级$/);
    const level = Number(item.value);
    if (!match || !Number.isFinite(level)) continue;
    companionLevelMap.set(match[1], describeRealmByLevel(level));
  }

  for (const item of patchItems) {
    const match = normalizeJsonPointer(item.path).match(/^\/红颜\/([^/]+)\/境界描述$/);
    if (!match || typeof item.value !== 'string') continue;
    const wrong = String(item.value).trim();
    const correct = companionLevelMap.get(match[1]);
    if (correct && wrong && wrong !== correct) {
      corrections.push({ wrong, correct });
    }
  }

  return _.uniqBy(corrections, correction => `${correction.wrong}=>${correction.correct}`);
}

function sanitizeAnalysisText(analysis: string, corrections: RealmCorrection[]): string {
  let sanitized = analysis;
  for (const { wrong, correct } of corrections) {
    sanitized = sanitized.split(wrong).join(correct);
  }
  return sanitized;
}

function sanitizeUpdateVariableInnerContent(innerContent: string): string {
  const analysisMatch = innerContent.match(ANALYSIS_TAG_REGEX);
  const patchMatch = innerContent.match(JSON_PATCH_TAG_REGEX);
  if (!analysisMatch || !patchMatch) {
    return innerContent;
  }

  try {
    const parsedPatch = JSON.parse(patchMatch[1].trim());
    if (!Array.isArray(parsedPatch)) {
      return innerContent;
    }

    const patchItems = parsedPatch as JsonPatchItem[];
    const filteredPatchItems = patchItems.filter(item => !isReadonlyDerivedPatchPath(normalizeJsonPointer(item.path)));
    const originalAnalysis = analysisMatch[1].trim();
    const sanitizedAnalysis = sanitizeAnalysisText(originalAnalysis, buildRealmCorrections(patchItems));
    const changed = filteredPatchItems.length !== patchItems.length || sanitizedAnalysis !== originalAnalysis;
    if (!changed) {
      return innerContent;
    }

    return `<Analysis>${sanitizedAnalysis}</Analysis>\n<JSONPatch>${JSON.stringify(filteredPatchItems, null, 2)}</JSONPatch>`;
  } catch {
    return innerContent;
  }
}

function applySanitizedUpdateVariableDisplay(messageId: number): boolean {
  const message = String(getChatMessages(messageId)?.[0]?.message || '');
  const blockMatch = message.match(UPDATE_VARIABLE_BLOCK_REGEX);
  if (!blockMatch) {
    return true;
  }

  const sanitizedInnerContent = sanitizeUpdateVariableInnerContent(blockMatch[1].trim());
  const $displayedMessage = retrieveDisplayedMessage(messageId);
  const $details = $displayedMessage.find('details.cultivation-var-update');
  if ($details.length === 0) {
    return false;
  }

  $details.each((_index, element) => {
    const $content = $(element).children('div').last();
    if ($content.length === 0) return;
    if ($content.text().trim() === sanitizedInnerContent) return;
    $content.text(sanitizedInnerContent);
  });

  return true;
}

function scheduleDisplaySanitization(messageId: number, retries: number = 8): void {
  window.setTimeout(() => {
    if (applySanitizedUpdateVariableDisplay(messageId) || retries <= 1) {
      return;
    }
    scheduleDisplaySanitization(messageId, retries - 1);
  }, 80);
}

export function bootstrapUpdateVariableDisplayGuard() {
  const globalRef = window as unknown as Record<string, unknown>;
  if (globalRef[DISPLAY_GUARD_INSTALLED_KEY]) return;
  globalRef[DISPLAY_GUARD_INSTALLED_KEY] = true;

  const messageId = getCurrentMessageId();
  if (typeof messageId !== 'number') {
    return;
  }

  const sanitizeCurrentMessage = () => {
    scheduleDisplaySanitization(messageId);
  };

  sanitizeCurrentMessage();

  eventOn(tavern_events.MESSAGE_UPDATED, id => {
    if (id === messageId) {
      sanitizeCurrentMessage();
    }
  });

  eventOn(tavern_events.MESSAGE_RECEIVED, id => {
    if (id === messageId) {
      sanitizeCurrentMessage();
    }
  });
}
