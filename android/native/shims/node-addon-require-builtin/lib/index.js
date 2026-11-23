'use strict';
// Android（bionic）替身：上游只发布 glibc/musl/darwin/win32 预编译，bionic 上 dlopen 必然失败。
// Node 以 --expose-internals 启动时，内部模块可以直接 require，效果与原生 addon 一致。
// DSH 的 android / 桌面分支本来就带这个参数（bin/launcher-environment.mjs resolveDshInvocation）。
const ALLOWED = /^internal\//;

function isAllowedInternalId(moduleId) {
  return typeof moduleId === 'string' && ALLOWED.test(moduleId);
}

function requireBuiltin(moduleId) {
  if (!isAllowedInternalId(moduleId)) {
    throw Object.assign(new Error(`require-builtin: refused ${moduleId}`), { code: 'ERR_REQUIRE_BUILTIN_REFUSED' });
  }
  try {
    if (moduleId === 'internal/bootstrap/realm') return bootstrapRealm();
    return require(moduleId);
  } catch (error) {
    if (!process.execArgv.includes('--expose-internals')) {
      throw Object.assign(new Error('require-builtin (android shim): Node must run with --expose-internals'), { code: 'ERR_REQUIRE_BUILTIN_NO_INTERNALS', cause: error });
    }
    throw error;
  }
}

// internal/bootstrap/realm 是引导期模块，--expose-internals 下也不可 require。
// 调用方（dsh-hmr）只用其中的 internalBinding；internal/test/binding 暴露的是同一个函数，
// 加载时会发一条 "for internal testing only" 警告，这里静默掉这一条。
let realm;
function bootstrapRealm() {
  if (realm) return realm;
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    if (String(warning && warning.message || warning).includes('internal/test/binding')) return;
    return emitWarning.call(process, warning, ...rest);
  };
  try {
    realm = Object.freeze({ internalBinding: require('internal/test/binding').internalBinding });
  } finally {
    process.emitWarning = emitWarning;
  }
  return realm;
}

function getBindingInfo() {
  return Object.freeze({ variant: 'android-js-shim', platform: process.platform, arch: process.arch, path: __filename });
}

exports.requireBuiltin = requireBuiltin;
exports.isAllowedInternalId = isAllowedInternalId;
exports.getBindingInfo = getBindingInfo;
exports.default = { requireBuiltin, isAllowedInternalId, getBindingInfo };
Object.defineProperty(exports, '__esModule', { value: true });
