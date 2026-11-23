'use strict';
// Android（bionic）启动预加载：node --require 本文件。只修平台差异，不改业务逻辑。
//
// 1) link(2)：Android SELinux 拒绝应用进程创建硬链接（EACCES）。DSH 用 link 做「目标不存在才发布」的
//    原子落盘（会话、附件）。回退为：同目录临时副本 → 确认目标不存在 → rename。
//    保留源文件、读者看不到半个文件、不覆盖已有目标；与 link 的差别只在「检查到 rename」之间的
//    窗口，单进程且 DSH 自己按会话串行写入，可接受。正式版应换成 renameat2(RENAME_NOREPLACE) 原生实现。
// 2) Termux 编译的 node 把 shell:true 的默认 shell 写死为 /data/data/com.termux/files/usr/bin/sh。
// 3) 静默 require-builtin 替身取 internalBinding 时 Node 打出的「internal testing only」警告。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');

const LINK_DENIED = new Set(['EACCES', 'EPERM']);
const eexist = (dest) => Object.assign(new Error(`EEXIST: file already exists, link -> '${dest}'`), { code: 'EEXIST', errno: -17, syscall: 'link', dest });
const sibling = (dest) => path.join(path.dirname(dest), `.${path.basename(dest)}.${crypto.randomBytes(6).toString('hex')}.linktmp`);

const original = { link: fs.link, linkSync: fs.linkSync, promisesLink: fs.promises.link };

function linkFallbackSync(src, dest) {
  if (fs.existsSync(dest)) throw eexist(dest);
  const tmp = sibling(dest);
  try {
    fs.copyFileSync(src, tmp, fs.constants.COPYFILE_EXCL);
    const fd = fs.openSync(tmp, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(dest)) throw eexist(dest);
    fs.renameSync(tmp, dest);
  } catch (error) { try { fs.rmSync(tmp, { force: true }); } catch {} throw error; }
}
async function linkFallback(src, dest) {
  const p = fs.promises;
  if (await p.access(dest).then(() => true, () => false)) throw eexist(dest);
  const tmp = sibling(dest);
  try {
    await p.copyFile(src, tmp, fs.constants.COPYFILE_EXCL);
    const handle = await p.open(tmp, 'r'); try { await handle.sync(); } finally { await handle.close(); }
    if (await p.access(dest).then(() => true, () => false)) throw eexist(dest);
    await p.rename(tmp, dest);
  } catch (error) { await p.rm(tmp, { force: true }).catch(() => {}); throw error; }
}

fs.linkSync = function linkSync(src, dest) {
  try { return original.linkSync(src, dest); }
  catch (error) { if (!LINK_DENIED.has(error.code)) throw error; return linkFallbackSync(src, dest); }
};
fs.promises.link = async function link(src, dest) {
  try { return await original.promisesLink(src, dest); }
  catch (error) { if (!LINK_DENIED.has(error.code)) throw error; return linkFallback(src, dest); }
};
fs.link = function link(src, dest, callback) {
  original.link(src, dest, (error) => {
    if (!error || !LINK_DENIED.has(error.code)) return callback(error);
    linkFallback(src, dest).then(() => callback(null), callback);
  });
};

// 2) shell：只在调用方没指定具体 shell 时替换。
const SHELL = process.env.DSH_ANDROID_SHELL || '/system/bin/sh';
const withShell = (options) => {
  if (options && typeof options === 'object' && (options.shell === true)) return { ...options, shell: SHELL };
  return options;
};

// 2b) 应用数据目录里的 Node 脚本（如 runtime/bin/dsh → bin.js）：Android 禁止执行应用自己写出的文件，
//     改为 `node --expose-internals 脚本`。node 命令本身直接换成当前可执行文件。
const PNPM_CLI = process.env.DSH_ANDROID_PNPM_CLI || path.join(__dirname, 'pnpm', 'bin', 'pnpm.cjs');
const nodeScripts = new Map();
function nodeScript(file, env) {
  if (typeof file !== 'string' || file === '') return null;
  let candidates;
  if (file.includes('/')) candidates = [path.resolve(file)];
  else {
    const dirs = String((env && env.PATH) || process.env.PATH || '').split(':').filter(Boolean);
    candidates = dirs.map((dir) => path.join(dir, file));
  }
  for (const candidate of candidates) {
    if (nodeScripts.has(candidate)) return nodeScripts.get(candidate);
    let resolved = null;
    try {
      const real = fs.realpathSync(candidate);
      if (fs.statSync(real).isFile()) {
        const fd = fs.openSync(real, 'r');
        const head = Buffer.alloc(128);
        const n = fs.readSync(fd, head, 0, 128, 0);
        fs.closeSync(fd);
        const line = head.subarray(0, n).toString('utf8').split('\n')[0];
        resolved = line.startsWith('#!') && /\bnode\b/.test(line) ? real : false;
      }
    } catch {
      continue; // 该候选不存在：继续找 PATH 里的下一个
    }
    nodeScripts.set(candidate, resolved);
    return resolved;
  }
  return null;
}
function rewrite(file, args, options) {
  if (file === 'node' || file === process.execPath) {
    // 直接用 node 跑 DSH（如安装器的版本探测）：bionic 替身要求 --expose-internals，又不能放进 NODE_OPTIONS。
    const list = args || [];
    const at = list.findIndex((a) => !String(a).startsWith('-'));
    if (at >= 0 && /[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/.test(String(list[at])) && !list.includes('--expose-internals')) {
      return [process.execPath, [...list.slice(0, at), '--expose-internals', ...list.slice(at)]];
    }
    return [process.execPath, list];
  }
  if (file === 'pnpm') return [process.execPath, [PNPM_CLI, ...(args || [])]];
  // 安装器用 `sh -c 'command -v node'` 检查命令：两者在 APK 里不在 PATH 上（也不能放可执行文件），由上面的映射提供。
  if ((file === 'sh' || file === SHELL) && args && args[0] === '-c' && /^command -v (node|pnpm)$/.test(String(args[1]))) {
    return [file, ['-c', 'true']];
  }
  // DSH 的 bash 工具固定执行 `bash -c 命令`，APK 不带 bash：PATH 上没有 bash 时改用系统 sh（mksh + toybox）。
  if (file === 'bash' && !onPath('bash', options && options.env)) {
    return [SHELL, (args || []).filter((a) => a !== '--noprofile' && a !== '--norc')];
  }
  const script = nodeScript(file, options && options.env);
  if (script) return [process.execPath, ['--expose-internals', script, ...(args || [])]];
  return [file, args];
}
function onPath(name, env) {
  return String((env && env.PATH) || process.env.PATH || '').split(':').filter(Boolean)
    .some((dir) => { try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); return true; } catch { return false; } });
}
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const fn = childProcess[name];
  childProcess[name] = function (file, args, options, ...rest) {
    if (Array.isArray(args)) {
      const [f, a] = options && options.shell ? [file, args] : rewrite(file, args, options);
      return fn.call(this, f, a, withShell(options), ...rest);
    }
    const [f, a] = args && args.shell ? [file, []] : rewrite(file, [], args);
    return a.length ? fn.call(this, f, a, withShell(args), options, ...rest) : fn.call(this, f, withShell(args), options, ...rest);
  };
}
for (const name of ['exec', 'execSync']) {
  const fn = childProcess[name];
  childProcess[name] = function (command, options, ...rest) {
    if (typeof options === 'function' || options == null) return fn.call(this, command, { shell: SHELL }, ...(typeof options === 'function' ? [options] : []), ...rest);
    return fn.call(this, command, typeof options.shell === 'string' ? options : { ...options, shell: SHELL }, ...rest);
  };
}

syncBuiltinESMExports();

// 3) 警告：替换默认的 warning 打印器，过滤这一条，其余照常输出。
const listeners = process.listeners('warning');
if (listeners.length) {
  process.removeAllListeners('warning');
  process.on('warning', (warning) => {
    if (String(warning && warning.message).includes('internal/test/binding')) return;
    for (const listener of listeners) listener.call(process, warning);
  });
}
