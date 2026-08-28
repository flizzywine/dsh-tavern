import { Schema } from '../踏月寻仙-测试版/schema';

const GUARD_INSTALLED_KEY = '__踏月寻仙_mvu_guard_installed__';
const READONLY_DERIVED_FIELDS = new Set(['突破阈值', '寿元上限', '境界描述', '寿元状态', '状态', '进度']);
const DUAL_SOUL_CANONICAL_NAME = '虞汐颜';
const DUAL_SOUL_ALIASES = new Set(['虞汐', '虞颜']);
const pendingCompanionLevels = new Map<string, number>();
const pendingCompanionLibraryLevels = new Map<string, number>();
const MVU_ROOT_KEYS = [
  '世界时钟',
  '世界地图',
  '世界图志',
  '宗门势力库',
  '功法库',
  '法宝库',
  '地点库',
  '$宗门推断',
  '灵根库',
  '体质库',
  '本尊',
  '红颜角色库',
  '红颜',
  'NPC图鉴',
  '任务列表',
  '声望系统',
  '难度系统',
  '可参与机遇',
  '当前处境',
  '_系统设置',
  '_好感度快照',
] as const;

function normalizeCommandPath(rawPath: string): string {
  let path = String(rawPath || '').trim();
  if (!path) return path;

  if (path.startsWith('./')) {
    path = path.slice(1);
  }
  if (path.startsWith('/')) {
    path = path.replace(/^\/+/, '').replaceAll('/', '.');
  }

  path = path
    .replaceAll('：', ':')
    .replaceAll('。', '.')
    .replace(/\s+/g, '')
    .replace(/\.\.+/g, '.');

  const aliasMap: Record<string, string> = {
    世界時鐘: '世界时钟',
    世界地圖: '世界地图',
    世界圖志: '世界图志',
    宗門勢力庫: '宗门势力库',
    功法庫: '功法库',
    法寶庫: '法宝库',
    地點庫: '地点库',
    靈根庫: '灵根库',
    體質庫: '体质库',
    紅顏角色庫: '红颜角色库',
    紅顏: '红颜',
    聲望系統: '声望系统',
    難度系統: '难度系统',
    危險度: '危险度',
    當前區域: '当前区域',
    所屬層級: '所属层级',
    當前處境: '当前处境',
    可參與機遇: '可参与机遇',
    任務列表: '任务列表',
  };

  for (const [from, to] of Object.entries(aliasMap)) {
    path = path.replaceAll(from, to);
  }

  if (!path.startsWith('stat_data.')) {
    if (MVU_ROOT_KEYS.some(key => path === key || path.startsWith(`${key}.`))) {
      path = `stat_data.${path}`;
    }
  }

  return path;
}

function normalizeCompanionAliasPath(path: string): string {
  const companionMatch = path.match(/^stat_data\.红颜\.([^./]+)(?=\.|$)/);
  if (companionMatch && DUAL_SOUL_ALIASES.has(companionMatch[1])) {
    return path.replace(`stat_data.红颜.${companionMatch[1]}`, `stat_data.红颜.${DUAL_SOUL_CANONICAL_NAME}`);
  }

  const libraryMatch = path.match(/^stat_data\.红颜角色库\.([^./]+)(?=\.|$)/);
  if (libraryMatch && DUAL_SOUL_ALIASES.has(libraryMatch[1])) {
    return path.replace(`stat_data.红颜角色库.${libraryMatch[1]}`, `stat_data.红颜角色库.${DUAL_SOUL_CANONICAL_NAME}`);
  }

  return path;
}

function coerceByPath(path: string, value: unknown): unknown {
  if (path.endsWith('熟练度') && typeof value === 'string') {
    const v = value.trim();
    const unquoted = v.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');

    if (unquoted.includes('小成')) return '熟练';
    if (unquoted.includes('中成')) return '精通';
    if (unquoted.includes('大圆满')) return '圆满';
  }

  return value;
}

function isReadonlyDerivedStatPath(path: string): boolean {
  const match = path.match(/^stat_data\.(?:本尊|红颜\.[^./]+|NPC图鉴\.[^./]+)\.([^./]+)$/);
  return !!match && READONLY_DERIVED_FIELDS.has(match[1]);
}

function getReadonlyDerivedPathValue(path: string, variables: Mvu.MvuData): unknown {
  const directValue = _.get(variables, path);
  if (typeof directValue !== 'undefined') {
    return _.cloneDeep(directValue);
  }

  const parsed = Schema.safeParse(_.get(variables, 'stat_data'));
  if (!parsed.success) {
    return undefined;
  }

  return _.get({ stat_data: parsed.data }, path);
}

function rewriteReadonlyDerivedCommand(
  command: { type?: unknown; args?: unknown[]; reason?: unknown },
  path: string,
  variables: Mvu.MvuData,
): boolean {
  if (!isReadonlyDerivedStatPath(path)) {
    return false;
  }

  const currentValue = getReadonlyDerivedPathValue(path, variables);
  if (typeof currentValue === 'undefined') {
    return false;
  }

  command.type = 'set';
  command.args = [path, JSON.stringify(currentValue)];
  command.reason = '只读派生字段被守卫改写为no-op';
  return true;
}

function getCommandValueArgIndex(command: { type?: unknown; args?: unknown[] }): number | null {
  if (!Array.isArray(command.args)) return null;

  switch (command.type) {
    case 'set':
      return command.args.length >= 3 ? 2 : command.args.length >= 2 ? 1 : null;
    case 'insert':
      return command.args.length >= 3 ? 2 : command.args.length >= 2 ? 1 : null;
    case 'add':
      return command.args.length >= 2 ? 1 : null;
    default:
      return null;
  }
}

function rememberCompanionLevel(path: string, value: unknown): void {
  const level = Number(value);
  if (!Number.isFinite(level) || level < 1) return;
  const normalizedLevel = Math.floor(level);

  const companionMatch = path.match(/^stat_data\.红颜\.([^./]+)\.等级$/);
  if (companionMatch) {
    pendingCompanionLevels.set(companionMatch[1], normalizedLevel);
    return;
  }

  const libraryMatch = path.match(/^stat_data\.红颜角色库\.([^./]+)\.级$/);
  if (libraryMatch) {
    pendingCompanionLibraryLevels.set(libraryMatch[1], normalizedLevel);
  }
}

function applyPendingCompanionLevels(newVariables: Mvu.MvuData): void {
  for (const [name, level] of pendingCompanionLevels.entries()) {
    if (_.has(newVariables, `stat_data.红颜.${name}`)) {
      _.set(newVariables, `stat_data.红颜.${name}.等级`, level);
    }
  }

  for (const [name, level] of pendingCompanionLibraryLevels.entries()) {
    if (_.has(newVariables, `stat_data.红颜角色库.${name}`)) {
      _.set(newVariables, `stat_data.红颜角色库.${name}.级`, level);
    }
  }
}

function installGuard() {
  const globalRef = window as unknown as Record<string, unknown>;
  if (globalRef[GUARD_INSTALLED_KEY]) return;
  globalRef[GUARD_INSTALLED_KEY] = true;

  eventOn(Mvu.events.COMMAND_PARSED, (variables: Mvu.MvuData, commands: Mvu.CommandInfo[]) => {
    for (const command of commands as Array<{ type?: unknown; args?: unknown[] }>) {
      if (!Array.isArray(command.args) || command.args.length === 0) continue;

      const rawPath = String(command.args[0] ?? '');
      const normalizedPath = normalizeCompanionAliasPath(normalizeCommandPath(rawPath));
      if (normalizedPath && normalizedPath !== rawPath) {
        command.args[0] = normalizedPath;
      }

      if (normalizedPath && rewriteReadonlyDerivedCommand(command, normalizedPath, variables)) {
        continue;
      }

      const valueArgIndex = getCommandValueArgIndex(command);
      if (valueArgIndex !== null && command.args.length > valueArgIndex && normalizedPath) {
        const rawValue = command.args[valueArgIndex];
        const normalizedValue = coerceByPath(normalizedPath, rawValue);
        if (!_.isEqual(rawValue, normalizedValue)) {
          command.args[valueArgIndex] = normalizedValue;
        }
        rememberCompanionLevel(normalizedPath, normalizedValue);
      }
    }
  });

  eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (newVariables: Mvu.MvuData) => {
    applyPendingCompanionLevels(newVariables);
    const statData = _.get(newVariables, 'stat_data');
    const parsed = Schema.safeParse(statData);
    pendingCompanionLevels.clear();
    pendingCompanionLibraryLevels.clear();
    if (!parsed.success) return;

    if (!_.isEqual(statData, parsed.data)) {
      _.set(newVariables, 'stat_data', parsed.data);
    }
  });

  console.info('[踏月寻仙] 独立变量守卫已启用');
}

$(() => {
  waitGlobalInitialized('Mvu')
    .then(() => installGuard())
    .catch(e => console.warn('[踏月寻仙] 独立变量守卫加载失败', e));
});

