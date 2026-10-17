// Shared bootstrap for the official desktop, shell installers and the Windows bundle.
// Runs under Electron Node mode so packaged app.asar files remain readable.
const fs = require('node:fs');
const path = require('node:path');
function layout(executable, platform = process.platform) {
  const resources = platform === 'darwin' ? path.resolve(path.dirname(executable), '../Resources') : path.join(path.dirname(executable), 'resources');
  const app = fs.existsSync(path.join(resources, 'app', 'package.json')) ? path.join(resources, 'app') : path.join(resources, 'app.asar');
  return { resources, app, host: path.join(app, 'dsh'), pnpm: path.join(resources, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs') };
}
function prepare({ executable, home, env = process.env, platform = process.platform }) {
  if (!executable || !home) throw Error('请先安装官方 DeepSeek Harness，并指定安装目录');
  const paths = layout(executable, platform);
  const manifest = JSON.parse(fs.readFileSync(path.join(paths.app, 'package.json'), 'utf8'));
  if (manifest.name !== '@deepseek-ai/dsh-desktop') throw Error('Desktop 宿主必须是官方 DeepSeek Harness，不能使用社区 DSH Desktop');
  const bootstrap = path.join(paths.host, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
  for (const file of [bootstrap, paths.pnpm]) if (!fs.existsSync(file)) throw Error('官方桌面运行时不完整：' + file);
  const bin = path.join(home, 'tools', 'official-desktop', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  for (const [name, entry] of [['node', null], ['pnpm', paths.pnpm], ['dsh', bootstrap]]) {
    const file = path.join(bin, name + (platform === 'win32' ? '.cmd' : ''));
    const text = platform === 'win32'
      ? '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%DSH_DESKTOP_NODE_EXECUTABLE%" --expose-internals ' + (entry ? '"%' + (name === 'dsh' ? 'DSH_DESKTOP_DSH_BOOTSTRAP' : 'DSH_DESKTOP_PNPM_ENTRY') + '%" ' : '') + '%*\r\nexit /b %errorlevel%\r\n'
      : '#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ' + quote(executable) + ' --expose-internals ' + (entry ? quote(entry) + ' ' : '') + '"$@"\n';
    fs.writeFileSync(file, text, { mode: 0o755 });
  }
  const key = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  return { DSH_HOME: path.resolve(home), DSH_DESKTOP_NODE_EXECUTABLE: executable, DSH_DESKTOP_APP_EXECUTABLE: executable,
    DSH_DESKTOP_DSH_BOOTSTRAP: bootstrap, DSH_DESKTOP_PNPM_ENTRY: paths.pnpm,
    DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: path.join(paths.host, 'package.json'),
    [key]: bin + (platform === 'win32' ? ';' : ':') + (env[key] || '') };
}
function discover(env = process.env, platform = process.platform) {
  const candidates = [env.DSH_DESKTOP_NODE_EXECUTABLE, env.DSH_DESKTOP_APP_EXECUTABLE, process.versions.electron ? process.execPath : undefined];
  if (platform === 'darwin') candidates.push('/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness', path.join(require('node:os').homedir(), 'Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'));
  if (platform === 'win32') for (const root of [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles]) if (root) candidates.push(path.join(root, 'DeepSeek Harness', 'DeepSeek Harness.exe'));
  const executable = candidates.find(file => file && fs.existsSync(file));
  if (!executable) throw Error('找不到官方 DeepSeek Harness；请先安装，或用 DSH_DESKTOP_APP_EXECUTABLE 指定程序路径');
  return executable;
}
module.exports = { layout, prepare, discover };
if (require.main === module) {
  try {
    const result = prepare({ executable: process.execPath, home: process.argv[2] });
    if (process.argv.includes('--shell')) for (const [key, value] of Object.entries(result)) console.log('export ' + key + "='" + value.replaceAll("'", "'\\''") + "'");
    else console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
