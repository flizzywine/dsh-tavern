import { readFile, writeFile } from 'node:fs/promises'

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

await writeFile(configPath, source)
