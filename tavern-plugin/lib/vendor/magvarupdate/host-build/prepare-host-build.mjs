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
