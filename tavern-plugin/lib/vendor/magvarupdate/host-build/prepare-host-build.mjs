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

let source = await readFile(configPath, 'utf8')
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
let uniqueScript = await readFile(uniqueScriptPath, 'utf8')
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
let globalSource = await readFile(globalPath, 'utf8')
globalSource = globalSource.replaceAll('window.parent', 'window')
await writeFile(globalPath, globalSource)

const mainPath = path.join(root, 'src/main.ts')
let mainSource = await readFile(mainPath, 'utf8')
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
let updateSource = await readFile(updatePath, 'utf8')
updateSource = replaceExactlyOnce(updateSource,
  'is_jest_environment ? onMessageReceived : _.throttle(onMessageReceived, 3000)',
  'onMessageReceived', 'await each serialized host message event')
await writeFile(updatePath, updateSource)

// Resumed/imported games may only have a complete snapshot on the current floor.
// Preserve upstream's prior-floor baseline when available; otherwise use that
// current snapshot rather than silently skipping a valid host settlement.
const variablesPath = path.join(root, 'src/function/update_variables.ts')
let variablesSource = await readFile(variablesPath, 'utf8')
variablesSource = replaceExactlyOnce(variablesSource,
  'const variables = getLastValidVariable(request_message_id);',
  "const variables = getLastValidVariable(request_message_id) ?? (() => { const current = getVariables({ type: 'message', message_id }); return _.has(current, 'stat_data') && _.has(current, 'schema') ? current : undefined; })();",
  'allow complete current-floor MVU baseline when history has none')
await writeFile(variablesPath, variablesSource)

// ST JSONL compaction cannot write host-owned history snapshots through saveChat.
// Disable it at the plugin boundary, including legacy enabled settings. Keep the
// restore listener for imported chats and leave variable calculation untouched.
for (const [file, signature, body] of [
  ['legacy_chat.ts', 'export async function checkAndCleanupLegacyChat()', 'export async function checkAndCleanupLegacyChat() {}\n'],
  ['cleanup_variables.ts', 'export function cleanupMessageVariables(', 'export function cleanupMessageVariables(_start: number, _end: number, _interval: number) { return 0; }\n'],
]) {
  const filePath = path.join(root, 'src/function/cleanup', file)
  const original = await readFile(filePath, 'utf8')
  replaceExactlyOnce(original, signature, signature, 'disable host-incompatible cleanup: ' + file)
  await writeFile(filePath, '// DSH Tavern preserves authoritative historical variable snapshots.\n' + body)
}
const buttonsPath = path.join(root, 'src/button.ts')
let buttonsSource = await readFile(buttonsPath, 'utf8')
const cleanupButton = buttonsSource.match(/    \{\n        name: '清除旧楼层变量',[\s\S]*?\n    \},/)
if (!cleanupButton) throw new Error('官方 MVU 清理按钮已变化，无法安全应用宿主转换')
buttonsSource = replaceExactlyOnce(buttonsSource, cleanupButton[0], '', 'remove unsupported manual cleanup button')
await writeFile(buttonsPath, buttonsSource)

const cleanupPanelPath = path.join(root, 'src/panel/Cleanup.vue')
const cleanupPanel = await readFile(cleanupPanelPath, 'utf8')
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
let notificationSource = await readFile(notificationPath, 'utf8')
for (const flag of ['已提醒自动清理旧变量功能', '已默认开启自动清理旧变量功能']) {
  notificationSource = replaceExactlyOnce(notificationSource,
    `if (store.settings.internal.${flag} === false) {`,
    'if (false) {', 'suppress unsupported cleanup notification: ' + flag)
}
await writeFile(notificationPath, notificationSource)

// Looking for the previous valid snapshot must not copy every earlier row.
// On a paged host each array access can be an actual historical read.
const utilPath = path.join(root, 'src/util.ts')
let utilSource = await readFile(utilPath, 'utf8')
utilSource = replaceExactlyOnce(utilSource, `    return _(SillyTavern.chat)
        .slice(0, end_message_id)
        .findLastIndex(chat_message => {
            return isMvuData(_.get(chat_message, ['variables', chat_message.swipe_id ?? 0], {}));
        });`, `    const chat = SillyTavern.chat;
    const end = _.toInteger(end_message_id);
    const limit = end < 0 ? Math.max(0, chat.length + end) : Math.min(chat.length, end);
    for (let index = limit - 1; index >= 0; index--) {
        const chat_message = chat[index];
        if (isMvuData(_.get(chat_message, ['variables', chat_message.swipe_id ?? 0], {}))) return index;
    }
    return -1;`, 'search prior MVU snapshot without copying historical rows')
await writeFile(utilPath, utilSource)

// Restoration only acts when a missing snapshot is within the recent threshold.
// Older missing rows have always taken the no-restoration branch.
const restorePath = path.join(root, 'src/function/cleanup/restore_variables.ts')
let restoreSource = await readFile(restorePath, 'utf8')
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
let initSource = await readFile(initPath, 'utf8')
initSource = replaceExactlyOnce(initSource, `                            //重新进行其他全局世界书的初始化。
                            await loadInitVarData(current_data);
`, `                            //重新进行其他全局世界书的初始化。
                            await loadInitVarData(current_data);
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
`, 'derive schema and strip metadata for opening initvar')
await writeFile(initPath, initSource)
