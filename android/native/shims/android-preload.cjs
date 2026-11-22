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
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const fn = childProcess[name];
  childProcess[name] = function (file, args, options, ...rest) {
    if (Array.isArray(args)) return fn.call(this, file, args, withShell(options), ...rest);
    return fn.call(this, file, withShell(args), options, ...rest);
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
