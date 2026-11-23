'use strict';
// Termux 原生 Node 预加载（scripts/termux/termux-tavern.sh 经 NODE_OPTIONS=--require 传入）。
// 平台差异的处理与 APK 相同（android-preload.cjs）；另外把没有 Android 预编译的原生 addon 在解析阶段
// 重定向到同目录的 JS 替身。这样 pnpm / npm 重装或应用内更新换掉了包里的文件，替身也照样生效。
// 钩子对本进程及其 worker 线程有效；清空了环境变量的子进程拿不到它，脚本另把替身写进已装的包兜底。
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const moduleApi = require('node:module');

require('./android-preload.cjs');

const SHIMS = {
  'node-addon-require-builtin': ['node-addon-require-builtin/lib/index.js', 'commonjs'],
  '@deepseek-ai/node-addon-system/flock': ['node-addon-system/lib/flock.js', 'module'],
};

if (typeof moduleApi.registerHooks === 'function') {
  const targets = new Map(Object.entries(SHIMS).map(([specifier, [file, format]]) =>
    [specifier, { url: pathToFileURL(path.join(__dirname, file)).href, format, shortCircuit: true }]));
  moduleApi.registerHooks({
    resolve(specifier, context, nextResolve) {
      return targets.get(specifier) || nextResolve(specifier, context);
    },
  });
}
