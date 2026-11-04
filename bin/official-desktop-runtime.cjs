// Bootstrap for official DeepSeek Harness only. Electron reads packaged app.asar files.
const fs = require('node:fs');
const path = require('node:path');
const OFFICIAL = '@deepseek-ai/dsh-desktop';
const APP_NAMES = ['DeepSeek Harness'];
// Read archive metadata under plain Node as well, so unsupported hosts fail before mutation.
function withoutAsar(fn) { const prev = process.noAsar; process.noAsar = true; try { return fn(); } finally { process.noAsar = prev; } }
function asarRead(archive, relative, contents) { return withoutAsar(() => {
  const fd = fs.openSync(archive, 'r');
  try {
    const sizes = Buffer.alloc(16);
    fs.readSync(fd, sizes, 0, 16, 0);
    const headerSize = sizes.readUInt32LE(4), jsonSize = sizes.readUInt32LE(12);
    const json = Buffer.alloc(jsonSize);
    fs.readSync(fd, json, 0, jsonSize, 16);
    let entry = JSON.parse(json.toString('utf8'));
    for (const part of relative.split(/[\\/]/).filter(Boolean)) entry = entry?.files?.[part];
    if (!entry || entry.files) return null;
    if (!contents) return '';
    if (entry.unpacked || !Number.isSafeInteger(Number(entry.offset))) return null;
    const data = Buffer.alloc(entry.size);
    fs.readSync(fd, data, 0, entry.size, 8 + headerSize + Number(entry.offset));
    return data.toString('utf8');
  } catch { return null; } finally { fs.closeSync(fd); } });
}
// Split a path at the archive that contains it; null when it is not inside one. A directory named
// *.asar is not told apart here: exists() finds its files directly, and asarRead fails on it.
// (A trailing-separator check does not work: on Windows "app.asar\\" exists for the file too.)
function inAsar(file) {
  const match = /^(.*?\.asar)[\\/](.+)$/.exec(file);
  return match ? { archive: match[1], relative: match[2] } : null;
}
// A file the runner can load: on disk, or inside app.asar (readable under Electron only).
function exists(file) {

  const packed = inAsar(file);
  if (packed !== null) return withoutAsar(() => fs.existsSync(packed.archive)) && asarRead(packed.archive, packed.relative, false) !== null;
  return withoutAsar(() => fs.existsSync(file));


}
function packageName(app) {
  try { if (app.endsWith('.asar')) return String(JSON.parse(asarRead(app, 'package.json', true) || '{}').name || ''); } catch { return ''; }
  try { return withoutAsar(() => JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).name || ''); } catch { return ''; }

}
function layout(executable, platform = process.platform) {
  const resources = platform === 'darwin' ? path.resolve(path.dirname(executable), '../Resources') : path.join(path.dirname(executable), 'resources');
  const unpacked = path.join(resources, 'app'), packed = path.join(resources, 'app.asar');
  const app = fs.existsSync(path.join(unpacked, 'package.json')) ? unpacked : packed;
  const name = packageName(app);
  const host = path.join(app, 'dsh');
  return { resources, app, name, host, bootstrap: path.join(host, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'), pnpm: path.join(resources, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs') };
}
function prepare({ executable, home, env = process.env, platform = process.platform }) {
  if (!executable || !home) throw Error('请先安装官方 DeepSeek Harness，并指定安装目录');
  const paths = layout(executable, platform);
  if (paths.name !== OFFICIAL) throw Error('桌面版仅支持官方 DeepSeek Harness：' + executable
    + '（读到的应用包名：' + (paths.name || '无法读取') + '，应用目录：' + paths.app + '）');
  const bootstrap = paths.bootstrap;
  for (const file of [bootstrap, paths.pnpm]) if (!exists(file)) throw Error('桌面运行时不完整：' + file);
  const runner = executable;
  const dshRunner = runner, pnpmRunner = runner;
  const runnerOf = name => name === 'dsh' ? dshRunner : name === 'pnpm' ? pnpmRunner : runner;
  const variableOf = name => name === 'dsh' ? 'DSH_DESKTOP_DSH_RUNNER' : name === 'pnpm' ? 'DSH_DESKTOP_PNPM_RUNNER' : 'DSH_DESKTOP_NODE_EXECUTABLE';
  const bin = path.join(home, 'tools', 'official-desktop', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  for (const [name, entry] of [['node', null], ['pnpm', paths.pnpm], ['dsh', bootstrap]]) {
    const file = path.join(bin, name + (platform === 'win32' ? '.cmd' : ''));
    const text = platform === 'win32'
      ? '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%' + variableOf(name) + '%" --expose-internals ' + (entry ? '"%' + (name === 'dsh' ? 'DSH_DESKTOP_DSH_BOOTSTRAP' : 'DSH_DESKTOP_PNPM_ENTRY') + '%" ' : '') + '%*\r\nexit /b %errorlevel%\r\n'
      : '#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ' + quote(runnerOf(name)) + ' --expose-internals ' + (entry ? quote(entry) + ' ' : '') + '"$@"\n';
    fs.writeFileSync(file, text, { mode: 0o755 });
  }
  const key = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  // NODE_EXECUTABLE runs installer code and `node`; PNPM_RUNNER runs pnpm; DSH_RUNNER runs the DSH entry.
  return { DSH_HOME: path.resolve(home), DSH_DESKTOP_NODE_EXECUTABLE: runner, DSH_DESKTOP_APP_EXECUTABLE: executable,
    DSH_DESKTOP_PNPM_RUNNER: pnpmRunner, DSH_DESKTOP_DSH_RUNNER: dshRunner, DSH_DESKTOP_DSH_BOOTSTRAP: bootstrap, DSH_DESKTOP_PNPM_ENTRY: paths.pnpm,
    DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: path.join(paths.host, 'package.json'),
    [key]: bin + (platform === 'win32' ? ';' : ':') + (env[key] || '') };
}
function discover(env = process.env, platform = process.platform) {
  // A standalone node executable is not a desktop host.
  const node = env.DSH_DESKTOP_NODE_EXECUTABLE && !/^node(\.exe)?$/i.test(path.basename(env.DSH_DESKTOP_NODE_EXECUTABLE)) ? env.DSH_DESKTOP_NODE_EXECUTABLE : undefined;
  const candidates = [env.DSH_DESKTOP_APP_EXECUTABLE, node, env === process.env && process.versions.electron ? process.execPath : undefined];
  for (const app of APP_NAMES) {
    if (platform === 'darwin') candidates.push(`/Applications/${app}.app/Contents/MacOS/${app}`, path.join(require('node:os').homedir(), `Applications/${app}.app/Contents/MacOS/${app}`));
    if (platform === 'win32') for (const root of [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles]) if (root) candidates.push(path.join(root, app, app + '.exe'));
  }
  const executable = candidates.find(file => file && fs.existsSync(file));
  if (!executable) throw Error('找不到官方 DeepSeek Harness；请先安装，或用 DSH_DESKTOP_APP_EXECUTABLE 指定程序路径');
  return executable;
}
// Installer code always runs under the official app's Electron.
function runner(executable) { return executable; }
module.exports = { layout, prepare, discover, runner, APP_NAMES };
if (require.main === module) {
  try {
    const result = prepare({ executable: process.versions.electron ? process.execPath : discover(), home: process.argv[2] });
    if (process.argv.includes('--shell')) for (const [key, value] of Object.entries(result)) console.log('export ' + key + "='" + value.replaceAll("'", "'\\''") + "'");
    else console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
