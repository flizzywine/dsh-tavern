import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Wiki owns navigation and tutorials; source references stay beside their Skills.
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--wiki-root') {
  console.error('Usage: node bin/sync-wiki-references.mjs --wiki-root D:/Workspace/dsh-tavern-wiki');
  process.exit(1);
}
const wiki = path.resolve(args[1]);
await stat(path.join(wiki, '.git'));
const base = 'https://github.com/flizzywine/dsh-tavern/blob/main/';
const groups = [];
for (const directory of ['presets/tavern/skills', 'presets/tavern-background/skills', 'tavern-plugin/packages/dsh-tavern-image-bundled/skills']) {
  for (const entry of (await readdir(path.join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const relative = `${directory}/${entry.name}`;
    const source = await readFile(path.join(root, relative, 'SKILL.md'), 'utf8');
    const title = source.match(/^# (.+)$/m)?.[1] ?? entry.name;
    const files = [];
    async function collect(folder) {
      let entries;
      try { entries = await readdir(path.join(root, relative, folder), { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const file of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const target = `${folder}/${file.name}`;
        if (file.isDirectory()) await collect(target);
        else if (file.name.endsWith('.md')) {
          const content = await readFile(path.join(root, relative, target), 'utf8');
          files.push(`- [${content.match(/^# (.+)$/m)?.[1] ?? file.name}](${base}${relative}/${target})`);
        }
      }
    }
    await collect('references');
    if (files.length) groups.push(`## ${title}\n\n[对应 Skill](${base}${relative}/SKILL.md)\n\n${files.join('\n')}`);
  }
}
const content = `# Skill 参考文档\n\n这里按功能链接仓库中的原始参考文件，不复制正文。界面位置、参数、工具契约和限制以这些文件为准；Wiki 负责入门教程、任务导航和跨功能说明。部分参考包含供 Agent 使用的工具格式。\n\n修改功能规则时，在仓库中修改对应参考文件；新增参考文件后运行 \`node bin/sync-wiki-references.mjs --wiki-root <Wiki 仓库目录>\` 刷新本页。普通教程仍可直接在 Wiki 编辑。\n\n[安装与更新](https://github.com/flizzywine/dsh-tavern#快速开始) · [Wiki 首页](Home) · [功能索引](功能索引)\n\n${groups.join('\n\n')}\n`;
await writeFile(path.join(wiki, 'Skill-参考文档.md'), content);
console.log(`Updated ${path.join(wiki, 'Skill-参考文档.md')} (${groups.length} topics).`);
