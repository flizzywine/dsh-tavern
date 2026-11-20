import { execSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setLauncherPackageName } from '../../bin/launcher-package-name.mjs'

const name = '@flizzywine/dsh-tavern'
const source = fileURLToPath(new URL('../../tavern-plugin/packages/dsh-tavern/', import.meta.url))
const destination = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../../output/', import.meta.url))
const { name: sourceName, version, files } = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
const staging = mkdtempSync(join(tmpdir(), 'dsh-tavern-npm-'))

try {
  for (const file of ['package.json', ...files]) {
    cpSync(join(source, file), join(staging, file), { recursive: true })
  }
  setLauncherPackageName(staging, sourceName, name)
  writeFileSync(join(staging, 'README.md'), `# DSH Tavern

这是 DSH Tavern 的桌面启动器，支持 Windows 和 macOS 上的 DeepSeek Harness 与 DSH NEXT。

在原版 \`desktop\` Profile 中打开 **插件 → 添加插件**，选择 **npm 官方源**，输入 \`${name}\` 并启用。若已通过其他渠道安装启动器，先移除旧启动器。

打开 **设置 → 酒馆启动器**，点击 **安装酒馆**。启动器会从酒馆的发布渠道下载安装程序。

[项目主页及使用说明](https://github.com/flizzywine/dsh-tavern#readme)
`)
  execSync('npm pack --ignore-scripts --quiet', { cwd: staging, stdio: 'inherit' })
  const archive = `flizzywine-dsh-tavern-${version}.tgz`
  mkdirSync(destination, { recursive: true })
  copyFileSync(join(staging, archive), join(destination, archive))
  console.log(join(destination, archive))
} finally {
  rmSync(staging, { recursive: true, force: true })
}
