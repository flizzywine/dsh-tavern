import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// main is the current release (DSH 0.2.1); the DSH 0.1.5 release lives on the stable branch.
const root = new URL('../', import.meta.url)
test('安装脚本与更新检查在所有下载方式上都跟随 main 分支', () => {
  for (const file of ['install.sh', 'install.ps1', 'tavern-plugin/lib/application-updater.js', 'bin/launcher-environment.mjs']) {
    const source = readFileSync(new URL(file, root), 'utf8')
    assert.ok(source.includes('/commits/main'), file)
    assert.doesNotMatch(source, /0\.2\.1版本|%E7%89%88%E6%9C%AC|\/commits\/stable|@stable\//, file)
    if (file.startsWith('install.')) {
      assert.ok(source.includes('refs/heads/main'), file)
      assert.ok(source.includes('@runtime-archive-main/dsh-tavern-runtime.json'), file)
      assert.match(source, /--branch["', ]+main/, file)
      assert.match(source, /origin["', ]+main\b/, file)
    }
  }
  assert.match(readFileSync(new URL('android/setup.sh', root), 'utf8'), /BRANCH="\$\{DSH_TAVERN_BRANCH:-main\}"/)
  for (const file of ['android/setup.sh', 'tavern-plugin/lib/application-updater.js']) {
    assert.ok(readFileSync(new URL(file, root), 'utf8').includes('@runtime-archive-main/dsh-tavern-runtime.json'), file)
  }
  const workflow = readFileSync(new URL('.github/workflows/publish-runtime-manifest.yml', root), 'utf8')
  assert.match(workflow, /branches: \[main, stable\]/)
  assert.doesNotMatch(workflow, /@main\/|@0\.2\.1/, 'CDN 刷新按推送的分支')
})

test('安装脚本只接受桌面版与命令行版宿主', { skip: process.platform === 'win32' }, () => {
  const result = spawnSync('sh', [new URL('install.sh', root).pathname], { encoding: 'utf8', env: { ...process.env, DSH_TAVERN_HOST: 'android' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /只支持官方桌面和独立命令行/)
})

test('安装脚本内嵌自己的版本号，jsDelivr 下载不接受比它旧的运行清单', () => {
  const version = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version
  const sh = readFileSync(new URL('install.sh', root), 'utf8')
  const ps1 = readFileSync(new URL('install.ps1', root), 'utf8')
  assert.ok(sh.includes(`INSTALLER_VERSION='${version}'`), 'install.sh 的版本号与 package.json 一致（node bin/build-installer-scripts.mjs）')
  assert.ok(ps1.includes(`$InstallerVersion = '${version}'`), 'install.ps1 的版本号与 package.json 一致')
  assert.match(sh, /download\.cjs" runtime [^\n]*--min-version "\$\{INSTALLER_VERSION\}"/)
  assert.match(ps1, /'runtime', [^\n]*'--min-version', \$InstallerVersion\)/)
})

test('Windows 桌面探测：环境变量里的 node.exe 不算桌面程序；卸载项缺 InstallLocation 时从卸载程序路径找（#250）', () => {
  const source = readFileSync(new URL('install.ps1', root), 'utf8')
  const candidates = source.slice(source.indexOf('$DesktopCandidates = '), source.indexOf('$OfficialDesktopExecutable = '))
  assert.match(candidates, /\$DesktopCandidates = @\(\$env:DSH_DESKTOP_APP_EXECUTABLE\)/, 'an explicit app path wins')
  assert.match(candidates, /DSH_DESKTOP_NODE_EXECUTABLE\) -notmatch '\^node\(\\\.exe\)\?\$'/)
  assert.match(candidates, /UninstallString/)
  assert.match(candidates, /DisplayIcon/)
})
