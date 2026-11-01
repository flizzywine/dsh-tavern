#!/usr/bin/env node
// 给已安装的 DSH harness 打「会话读写」性能补丁（幂等，可重复执行，支持多份安装）。
//
// 修的是四处写死的常量，都在 @deepseek-ai 的 dist 里，没有配置项可调：
//   1. ZSTD_DECODE_YIELD_INTERVAL_MS 500 -> 40
//      逐帧同步解压时攒满 500ms 才让出一次事件循环；会话日志够大时，打开期间整个
//      宿主的 RPC / 事件推送都在这段里排队。压到 40ms 后单次阻塞降到一两帧。
//   2. COLD_LOG_MEMO_MAX_ENTRIES 2 -> 16
//      冷会话「已解码存档」只留 2 份，来回切三个会话就开始反复整份解码。
//   3. preparedSessionCacheSize 默认 5 -> 16
//   4. SessionObservationReader 默认容量 5 -> 16
//      会话观察结果只留 5 份，第 6 个会话必冷读（配合上层 2~4 次 getSession 尤其亏）。
//
// 用法：
//   node scripts/patch-harness-perf.mjs            # 自动发现并打补丁
//   node scripts/patch-harness-perf.mjs --check    # 只看状态
//   node scripts/patch-harness-perf.mjs --revert   # 还原 .dsh-perf.bak
//   node scripts/patch-harness-perf.mjs --base /path/to/@deepseek-ai
//
// 应用/运行时升级会覆盖这些文件，升级后重新执行一次即可。

import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SEARCH_ROOTS = [
  '/home/hh/.local/opt',
  '/home/hh/.dsh/runtime',
  '/home/hh/.dsh-tavern/runtime',
  '/home/hh/.dsh-desktop',
];

const EDITS = [
  {
    file: 'dsh-session-persistence-jsonl/lib/index.js',
    label: 'ZSTD_DECODE_YIELD_INTERVAL_MS',
    from: 'const ZSTD_DECODE_YIELD_INTERVAL_MS = 500;',
    to: 'const ZSTD_DECODE_YIELD_INTERVAL_MS = 40;',
  },
  {
    file: 'dsh-session-persistence-jsonl/lib/index.js',
    label: 'COLD_LOG_MEMO_MAX_ENTRIES',
    from: 'const COLD_LOG_MEMO_MAX_ENTRIES = 2;',
    to: 'const COLD_LOG_MEMO_MAX_ENTRIES = 16;',
  },
  {
    file: 'dsh-session-query/lib/index.js',
    label: 'preparedSessionCacheSize',
    from: 'const preparedSessionCacheSize = config.preparedSessionCacheSize ?? 5;',
    to: 'const preparedSessionCacheSize = config.preparedSessionCacheSize ?? 16;',
  },
  {
    file: 'dsh-session-query/lib/index.js',
    label: 'SessionObservationReader capacity',
    from: 'constructor(ctx, cacheCapacity = 5) {',
    to: 'constructor(ctx, cacheCapacity = 16) {',
  },
];

function parseArgs(argv) {
  const out = { base: '', revert: false, check: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') out.base = argv[++i] || '';
    else if (arg === '--revert') out.revert = true;
    else if (arg === '--check') out.check = true;
  }
  return out;
}

/** 找出所有装着 persistence 包的 @deepseek-ai 目录（不同发行版的目录层级不同）。 */
function discoverBases() {
  const found = new Set();
  const check = (candidate) => {
    try {
      if (readdirSync(candidate).includes('dsh-session-persistence-jsonl')) found.add(candidate);
    } catch {
      /* 目录不存在或不可读：忽略 */
    }
  };
  for (const root of SEARCH_ROOTS) {
    const direct = [
      `${root}/node_modules/@deepseek-ai`,
      `${root}/resources/app/node_modules/@deepseek-ai`,
      `${root}/runtime/lib/node_modules/@deepseek-ai`,
      `${root}/lib/node_modules/@deepseek-ai`,
      `${root}/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`,
      `${root}/profiles/node_modules/@deepseek-ai`,
    ];
    for (const candidate of direct) check(candidate);
    // 桌面版带版本号目录：~/.dsh/runtime 之外还可能存在 ...-app-<ver>
    try {
      for (const entry of readdirSync(root)) {
        check(`${root}/${entry}/resources/app/node_modules/@deepseek-ai`);
        check(`${root}/${entry}/lib/node_modules/@deepseek-ai`);
        check(`${root}/${entry}/node_modules/@deepseek-ai`);
        check(`${root}/${entry}/runtime/lib/node_modules/@deepseek-ai`);
      }
    } catch {
      /* 根目录不存在：忽略 */
    }
  }
  return [...found];
}

function patchBase(base, args) {
  console.log(`harness: ${base}`);
  const cache = new Map();
  let changed = 0;
  let already = 0;
  let skipped = 0;

  for (const edit of EDITS) {
    const path = join(base, edit.file);
    if (!existsSync(path)) {
      console.log(`  跳过 ${edit.label}: 缺文件 ${edit.file}`);
      skipped += 1;
      continue;
    }
    if (!cache.has(edit.file)) cache.set(edit.file, readFileSync(path, 'utf8'));
    let text = cache.get(edit.file);

    if (args.revert) {
      const bak = `${path}.dsh-perf.bak`;
      if (existsSync(bak)) {
        copyFileSync(bak, path);
        cache.delete(edit.file);
        changed += 1;
        console.log(`  还原 ${edit.label}`);
      }
      continue;
    }

    const hasTarget = text.includes(edit.to);
    const hasSource = text.includes(edit.from);
    if (hasTarget && !hasSource) {
      already += 1;
      console.log(`  已生效 ${edit.label}`);
      continue;
    }
    if (!hasSource) {
      console.log(`  跳过 ${edit.label}: 与已知版本签名不符（版本可能已变）`);
      skipped += 1;
      continue;
    }
    text = text.replace(edit.from, edit.to);
    cache.set(edit.file, text);
    changed += 1;
    console.log(`  打补丁 ${edit.label}`);
  }

  if (!args.check) {
    for (const [rel, text] of cache) {
      const path = join(base, rel);
      if (!existsSync(`${path}.dsh-perf.bak`)) copyFileSync(path, `${path}.dsh-perf.bak`);
      writeFileSync(path, text);
    }
  }
  return { changed, already, skipped };
}

function main() {
  const args = parseArgs(process.argv);
  const bases = args.base ? [args.base] : discoverBases();
  if (bases.length === 0) throw new Error('没有发现已安装的 @deepseek-ai 目录，请用 --base 指定');
  let changed = 0;
  for (const base of bases) {
    const result = patchBase(base, args);
    changed += result.changed;
  }
  console.log(`\n共 ${bases.length} 份安装，改动 ${changed} 处。`);
  if (changed > 0 && !args.revert && !args.check) {
    console.log('重启对应进程后生效（DSH Desktop 直接退出重开；Tavern 用 npm run restart:tavern）。');
  }
}

main();
