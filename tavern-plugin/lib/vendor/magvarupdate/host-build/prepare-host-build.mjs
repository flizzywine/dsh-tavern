import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const configPath = process.argv[2]
if (!configPath) {
  throw new Error('缺少待转换的 MagVarUpdate webpack.config.ts 路径')
}

function replaceExactlyOnce(source, original, replacement, label) {
  const first = source.indexOf(original)
  if (first === -1 || source.indexOf(original, first + original.length) !== -1) {
    throw new Error('官方 MVU 构建输入已变化，无法安全应用宿主转换：' + label)
  }
  return source.slice(0, first) + replacement + source.slice(first + original.length)
}

async function readSource(file) {
  return (await readFile(file, 'utf8')).replaceAll('\r\n', '\n')
}

let source = await readSource(configPath)
source = replaceExactlyOnce(
  source,
  "import child_process from 'node:child_process';\n",
  '',
  'remove child_process import'
)
source = replaceExactlyOnce(
  source,
  `    // 获取构建时常量
    const buildDate = (() => {
        const date = new Date();
        const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000); // 转成 UTC+8 时间
        const year = utc8.getUTCFullYear();
        const month = String(utc8.getUTCMonth() + 1).padStart(2, '0');
        const day = String(utc8.getUTCDate()).padStart(2, '0');
        const hour = String(utc8.getUTCHours()).padStart(2, '0');
        const minute = String(utc8.getUTCMinutes()).padStart(2, '0');
        return \`${'${year}-${month}-${day} ${hour}:${minute}'}\`;
    })();
    let commitId = 'unknown';
    try {
        commitId = child_process
            .execSync('git rev-parse --short HEAD', { encoding: 'utf-8' })
            .trim();
    } catch (error) {
        console.warn('无法获取 Git commit ID:', error);
    }
`,
  `    // dsh-tavern host build pins these values so the artifact is reproducible.
    const buildDate = '2026-08-18 20:37';
    const commitId = '0a730cd';
`,
  'pin build metadata'
)
source = replaceExactlyOnce(
  source,
  `            const cdn = {
                sass: 'https://jspm.dev/sass',
            };
            return callback(
                null,
                'module-import ' +
                    (cdn[request as keyof typeof cdn] ??
                        \`https://testingcf.jsdelivr.net/npm/${'${request}'}/+esm\`)
            );
`,
  `            return callback();
`,
  'bundle non-host dependencies'
)
source = replaceExactlyOnce(
  source,
  `                yaml: 'YAML',
                zod: 'z',
`,
  '',
  'bundle YAML and Zod into the host artifact'
)
source = replaceExactlyOnce(
  source,
  `            new webpack.DefinePlugin({
`,
  `            new webpack.ProvidePlugin({ YAML: 'yaml' }),
            new webpack.DefinePlugin({
`,
  'provide the upstream YAML global from the bundled dependency'
)

await writeFile(configPath, source)

const root = path.dirname(configPath)
const uniqueScriptPath = path.join(root, 'util/script.ts')
let uniqueScript = await readSource(uniqueScriptPath)
uniqueScript = replaceExactlyOnce(
  uniqueScript,
  `        // 从共享状态中取出已注册实例集合（跨脚本实例共享在 window.parent）。
        const registered_scripts = _.get(window.parent, path, new Set<string>());
        // 以页面上实际存在的脚本顺序为准，选出“最后一个仍有效”的实例作为优先实例。
        return _($('#tavern_helper').find('div[data-script-id]').toArray())
            .map(element => String($(element).attr('data-script-id')))
            .filter(element => registered_scripts.has(element))
            .last();
`,
  `        // dsh-tavern guarantees one official MVU core per chat sandbox. Keep the
        // uniqueness registry inside that sandbox instead of inspecting the Host DOM.
        const registered_scripts = _.get(window, path, new Set<string>());
        return Array.from(registered_scripts).at(-1);
`,
  'keep unique-script selection inside the isolated chat sandbox'
)
uniqueScript = uniqueScript.replaceAll('window.parent', 'window')
await writeFile(uniqueScriptPath, uniqueScript)

const globalPath = path.join(root, 'src/function/global/index.ts')
let globalSource = await readSource(globalPath)
globalSource = globalSource.replaceAll('window.parent', 'window')
await writeFile(globalPath, globalSource)

const mainPath = path.join(root, 'src/main.ts')
let mainSource = await readSource(mainPath)
mainSource = replaceExactlyOnce(
  mainSource,
  `    stop_list.push(initGlobals());

    let chat_level_stop_list: Stop[] = [];
`,
  `    stop_list.push(initGlobals());

    // The Host loads the official core before card companion scripts so they can
    // resolve Mvu. Delay only chat-level initialization until those scripts have
    // registered their official MVU event handlers.
    await (window as any).__dshTavernCompanionScriptsReady;

    let chat_level_stop_list: Stop[] = [];
`,
  'wait for card companion scripts before chat initialization'
)
await writeFile(mainPath, mainSource)

// Host dispatch already serializes and acknowledges each settlement. Lodash's
// trailing throttle returns the previous event's Promise and writes after the
// current transaction has closed; each host event must await its own handler.
const updatePath = path.join(root, 'src/function/update/index.ts')
let updateSource = await readSource(updatePath)
updateSource = replaceExactlyOnce(updateSource,
  'is_jest_environment ? onMessageReceived : _.throttle(onMessageReceived, 3000)',
  'onMessageReceived', 'await each serialized host message event')
await writeFile(updatePath, updateSource)

// Host settlement supplies the frozen turn baseline on the target swipe. Other
// MESSAGE_RECEIVED events still use the preceding snapshot, with the existing
// current-floor fallback for resumed/imported games.
const receivedPath = path.join(root, 'src/function/update/on_message_received.ts')
let receivedSource = await readSource(receivedPath)
receivedSource = replaceExactlyOnce(receivedSource,
  '{ force = false }: { force?: boolean } = {}',
  '{ force = false, useCurrentVariables = false }: { force?: boolean; useCurrentVariables?: boolean } = {}',
  'accept the host settlement baseline option')
for (const indent of ['        ', '    ']) {
  receivedSource = replaceExactlyOnce(receivedSource,
    `\n${indent}await handleVariablesInMessage(message_id);`,
    `\n${indent}await handleVariablesInMessage(message_id, useCurrentVariables);`,
    'pass the frozen baseline option to variable processing')
}
await writeFile(receivedPath, receivedSource)

const variablesPath = path.join(root, 'src/function/update_variables.ts')
let variablesSource = await readSource(variablesPath)
variablesSource = replaceExactlyOnce(variablesSource,
  'export async function handleVariablesInMessage(message_id: number) {',
  'export async function handleVariablesInMessage(message_id: number, useCurrentVariables = false) {',
  'accept explicit host baseline in variable processing')
variablesSource = replaceExactlyOnce(variablesSource, `    const variables = getLastValidVariable(request_message_id);`, `    const current = () => getVariables({ type: 'message', message_id }) as MvuData;
    const variables = useCurrentVariables ? current() : getLastValidVariable(request_message_id) ?? (() => {
        const snapshot = current();
        return _.has(snapshot, 'stat_data') && _.has(snapshot, 'schema') ? snapshot : undefined;
    })();
    if (useCurrentVariables && variables && _.isPlainObject(variables.stat_data) && !variables.schema) {
        variables.schema = generateSchema(klona(variables.stat_data));
        cleanUpMetadata(variables.stat_data);
    }`,
  'use the frozen host baseline and fill in a missing schema')
await writeFile(variablesPath, variablesSource)

// ST JSONL compaction cannot write host-owned history snapshots through saveChat.
// Disable it at the plugin boundary, including legacy enabled settings. Keep the
// restore listener for imported chats and leave variable calculation untouched.
for (const [file, signature, body] of [
  ['legacy_chat.ts', 'export async function checkAndCleanupLegacyChat()', 'export async function checkAndCleanupLegacyChat() {}\n'],
  ['cleanup_variables.ts', 'export function cleanupMessageVariables(', 'export function cleanupMessageVariables(_start: number, _end: number, _interval: number) { return 0; }\n'],
]) {
  const filePath = path.join(root, 'src/function/cleanup', file)
  const original = await readSource(filePath)
  replaceExactlyOnce(original, signature, signature, 'disable host-incompatible cleanup: ' + file)
  await writeFile(filePath, '// DSH Tavern preserves authoritative historical variable snapshots.\n' + body)
}
const buttonsPath = path.join(root, 'src/button.ts')
let buttonsSource = await readSource(buttonsPath)
const cleanupButton = buttonsSource.match(/    \{\n        name: '清除旧楼层变量',[\s\S]*?\n    \},/)
if (!cleanupButton) throw new Error('官方 MVU 清理按钮已变化，无法安全应用宿主转换')
buttonsSource = replaceExactlyOnce(buttonsSource, cleanupButton[0], '', 'remove unsupported manual cleanup button')
await writeFile(buttonsPath, buttonsSource)

const cleanupPanelPath = path.join(root, 'src/panel/Cleanup.vue')
const cleanupPanel = await readSource(cleanupPanelPath)
replaceExactlyOnce(cleanupPanel, '<Section :label="t(\'panel.cleanup.section\')">', '', 'replace unsupported cleanup controls')
await writeFile(cleanupPanelPath, `<template>
    <Section :label="t('panel.cleanup.section')">
        <template #content>
            <p>DSH Tavern 暂不支持旧变量清理，历史变量会保留用于回退和恢复。</p>
        </template>
    </Section>
</template>
<script setup lang="ts">
import Section from '@/panel/component/Section.vue';
import { useMvuI18n } from '@/i18n';
const { t } = useMvuI18n();
</script>
`)

const notificationPath = path.join(root, 'src/function/notification/index.ts')
let notificationSource = await readSource(notificationPath)
for (const flag of ['已提醒自动清理旧变量功能', '已默认开启自动清理旧变量功能']) {
  notificationSource = replaceExactlyOnce(notificationSource,
    `if (store.settings.internal.${flag} === false) {`,
    'if (false) {', 'suppress unsupported cleanup notification: ' + flag)
}
await writeFile(notificationPath, notificationSource)

// Looking for the previous valid snapshot must not copy every earlier row.
// On a paged host each array access can be an actual historical read.
const utilPath = path.join(root, 'src/util.ts')
let utilSource = await readSource(utilPath)
utilSource = replaceExactlyOnce(utilSource,
  'export function getLastValidMessageId(end_message_id: number): number {',
  'export function getLastValidMessageId(end_message_id: number, includePartial = false): number {',
  'allow initialization to find card-authored partial snapshots')
utilSource = replaceExactlyOnce(utilSource, `export function getLastValidVariable(end_message_id: number): MvuData | undefined {
    const message_id = getLastValidMessageId(end_message_id);`, `export function getLastValidVariable(end_message_id: number, includePartial = false): MvuData | undefined {
    const message_id = getLastValidMessageId(end_message_id, includePartial);`, 'forward the partial snapshot option')
utilSource = replaceExactlyOnce(utilSource, `    return _(SillyTavern.chat)
        .slice(0, end_message_id)
        .findLastIndex(chat_message => {
            return isMvuData(_.get(chat_message, ['variables', chat_message.swipe_id ?? 0], {}));
        });`, `    const chat = SillyTavern.chat;
    const end = _.toInteger(end_message_id);
    const limit = end < 0 ? Math.max(0, chat.length + end) : Math.min(chat.length, end);
    for (let index = limit - 1; index >= 0; index--) {
        const chat_message = chat[index];
        const data = _.get(chat_message, ['variables', chat_message.swipe_id ?? 0], {});
        if (isMvuData(data) || (includePartial && _.isPlainObject(data?.stat_data))) return index;
    }
    return -1;`, 'search prior MVU snapshot without copying historical rows')
await writeFile(utilPath, utilSource)

// Restoration only acts when a missing snapshot is within the recent threshold.
// Older missing rows have always taken the no-restoration branch.
const restorePath = path.join(root, 'src/function/cleanup/restore_variables.ts')
let restoreSource = await readSource(restorePath)
restoreSource = replaceExactlyOnce(restoreSource, `    const last_not_has_variable_message_id = SillyTavern.chat.findLastIndex(
        chat_message =>
            !_.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'stat_data']) ||
            !_.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'schema'])
    );`, `    let last_not_has_variable_message_id = -1;
    for (let index = last_message_id; index >= last_10th_message_id; index--) {
        const chat_message = SillyTavern.chat[index];
        if (!_.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'stat_data']) ||
            !_.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'schema'])) {
            last_not_has_variable_message_id = index;
            break;
        }
    }`, 'bound restoration eligibility to its existing recent-floor threshold')
await writeFile(restorePath, restoreSource)

// An opening <initvar> replaces stat_data after the lorebook schema was built,
// and upstream neither derives a schema from it nor strips its metadata: $meta
// (strictSet, extensible) stays inert and $arrayMeta elements remain real data
// until some later update reconciles. Treat it like the lorebook path does.
const initPath = path.join(root, 'src/function/initvar/variable_init.ts')
let initSource = await readSource(initPath)
initSource = replaceExactlyOnce(initSource,
  '    let variables: MvuData & Record<string, any>;',
  '    let variables: MvuData & Record<string, any>;\n    let needsSchema = false;',
  'track partial initialization separately from worldbook loading')
initSource = replaceExactlyOnce(initSource,
  '        variables = getLastValidVariable(getLastMessageId() + 1) ?? createEmptyGameData();',
  `        const lastMessageId = getLastMessageId();
        const snapshot = getLastValidVariable(lastMessageId + 1, true);
        needsSchema = Boolean(snapshot && !snapshot.schema);
        // On floor zero, each swipe contributes its own authored data below.
        variables = (lastMessageId === 0 && needsSchema ? undefined : snapshot) ?? createEmptyGameData();`,
  'recognize card-authored snapshots during initialization')
initSource = replaceExactlyOnce(initSource,
  '    const is_updated = await loadInitVarData(variables);',
  '    const is_updated = (await loadInitVarData(variables)) || needsSchema;',
  'complete a partial snapshot even when every worldbook is already initialized')
initSource = replaceExactlyOnce(initSource,
  '                        const current_data = correctlyMerge(',
  `                        const authored = !vanilla_variable_data.schema && _.isPlainObject(vanilla_variable_data.stat_data)
                            ? klona(vanilla_variable_data.stat_data) : undefined;
                        const current_data = correctlyMerge(`,
  'capture the authored data before merging opening defaults')
initSource = replaceExactlyOnce(initSource, `                            //重新进行其他全局世界书的初始化。
                            await loadInitVarData(current_data);
                        }
`, `                            //重新进行其他全局世界书的初始化。
                            await loadInitVarData(current_data);
                        }
                        if (authored) {
                            current_data.stat_data = { ...current_data.stat_data, ...authored };
                        }
                        if (is_initvar_applied || authored) {
                            const opening_schema: SchemaNode & RootAdditionalProps = generateSchema(
                                klona(current_data.stat_data)
                            );
                            if (isObjectSchema(opening_schema)) {
                                for (const key of ['strictTemplate', 'concatTemplateArray', 'strictSet'] as const) {
                                    if (_.has(current_data.stat_data, ['$meta', key]))
                                        opening_schema[key] = current_data.stat_data['$meta']?.[key] as boolean;
                                }
                                current_data.schema = opening_schema;
                            }
                            cleanUpMetadata(current_data.stat_data);
                        }
`, 'derive schema for opening initvar and preserve swipe-specific authored data')
await writeFile(initPath, initSource)
