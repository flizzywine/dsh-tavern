#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
WORK="${TAVERN_APK_WORK:-${ROOT}/output/android-apk-020}"
# 内置快照来源：默认本仓库；测试版指向另一个分支的工作树，产物与正式版并存。
SOURCE_ROOT="${TAVERN_APK_SOURCE_ROOT:-$ROOT}"
# 变体：空 = 正式版；canary = 测试版（独立包名、名称与版本号，可与正式版同时安装）。
VARIANT="${TAVERN_APK_VARIANT:-}"
SUFFIX=''
APP_ID='io.github.flizzywine.dshtavern.standalone'
APP_NAME='DSH Tavern'
case "$VARIANT" in
  '') ;;
  canary)
    SUFFIX='-canary'
    APP_ID='io.github.flizzywine.dshtavern.standalone.canary'
    APP_NAME='DSH Tavern 测试版'
    ;;
  *) echo "TAVERN_APK_VARIANT 只能为空或 canary（当前：$VARIANT）" >&2; exit 1 ;;
esac
# 分支名写进安装器：测试版后续更新仍取这个分支，不会被 main 覆盖。
SOURCE_REF="${TAVERN_APK_SOURCE_REF:-}"
if [ -z "$SOURCE_REF" ]; then
  SOURCE_REF="$(git -C "$SOURCE_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [ "$SOURCE_REF" = HEAD ]; then SOURCE_REF=''; fi
  SOURCE_REF="${SOURCE_REF:-main}"
fi
VERSION_BASE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$SOURCE_ROOT/package.json")"
IFS=. read -r V_MAJOR V_MINOR V_PATCH <<<"${VERSION_BASE%%-*}"
VERSION_CODE="${TAVERN_APK_VERSION_CODE:-$(( V_MAJOR * 10000 + V_MINOR * 100 + V_PATCH ))}"
if [ "$VARIANT" = canary ] && [ -z "${TAVERN_APK_VERSION_CODE:-}" ]; then
  VERSION_CODE=$(( VERSION_CODE + 1 ))
fi
VERSION_NAME="${TAVERN_APK_VERSION_NAME:-$VERSION_BASE}"
if [ "$VARIANT" = canary ] && [ -z "${TAVERN_APK_VERSION_NAME:-}" ]; then
  VERSION_NAME="${VERSION_BASE}-canary.$(git -C "$SOURCE_ROOT" rev-parse --short=7 HEAD)"
fi
VERSION=v0.2.0-rc2
COMMIT=8362bba747fcf84c19e436c3dbb594a0fc388a67
mkdir -p "$WORK"
if [ ! -d "$WORK/dsha/.git" ]; then
  git clone --depth 1 --branch "$VERSION" https://github.com/DSH-APP/DSHA.git "$WORK/dsha"
fi
[ "$(git -C "$WORK/dsha" rev-parse HEAD)" = "$COMMIT" ] || { echo 'DSHA 版本不匹配' >&2; exit 1; }
# 官方 DSHA 只是构建输入，和可安装的酒馆交付包分开放，避免点错。
APK="$WORK/inputs/dsha-0.2.0-rc2.apk"
if [ ! -f "$APK" ]; then
  curl -fL --retry 2 "https://github.com/DSH-APP/DSHA/releases/download/${VERSION}/dsha-0.2.0-rc2.apk" -o "$APK.part"
  mv "$APK.part" "$APK"
fi
: "${JAVA_HOME:?请设置 JDK 17 或更新版本的 JAVA_HOME}"
: "${ANDROID_HOME:?请设置 Android SDK 的 ANDROID_HOME}"
BUILD="$(mktemp -d "${WORK}/build.XXXXXX")"
rmdir "$BUILD"
npm ci --prefix "$WORK/dsha/tools/web-compat" --ignore-scripts --no-audit --no-fund
# 首装离线包：与即将发布的源码同一个提交，首装才不必联网下载依赖。
OFFLINE_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
OFFLINE_PKG="${TAVERN_OFFLINE_PKG:-$WORK/tavern-offline${SUFFIX}-${OFFLINE_COMMIT:0:12}.tar.gz}"
if [ "${TAVERN_APK_OFFLINE:-1}" = 0 ]; then
  echo 'TAVERN_APK_OFFLINE=0：生成本次安装包不带依赖（首装回到联网下载）。' >&2
  OFFLINE_ARG=()
else
  if [ -n "$(git -C "$SOURCE_ROOT" status --porcelain --untracked-files=no)" ]; then
    echo "警告：$SOURCE_ROOT 有未提交改动，离线包只含已提交内容。" >&2
  fi
  bash "$SOURCE_ROOT/android/apk/build-offline-bundle.sh" "$OFFLINE_COMMIT" "$OFFLINE_PKG"
  OFFLINE_ARG=(--offline "$OFFLINE_PKG")
fi
python3 "$ROOT/android/apk/prepare.py" --source "$WORK/dsha" --apk "$APK" --output "$BUILD" \
  --repo-root "$SOURCE_ROOT" --source-ref "$SOURCE_REF" \
  --application-id "$APP_ID" --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --app-name "$APP_NAME" "${OFFLINE_ARG[@]}"
node "$ROOT/android/apk/build-web-compat.mjs" "$WORK/dsha" "$BUILD/app/src/tavern/assets"
cd "$BUILD"
MODE="${TAVERN_APK_MODE:-Debug}"
# AGP 会在 user.home/.android 建调试密钥；沙箱里 $HOME 只读，换到构建目录。
USER_HOME="$WORK/.user-home"
mkdir -p "$USER_HOME/.android"
[ -f "$HOME/.android/debug.keystore" ] && cp -f "$HOME/.android/debug.keystore" "$USER_HOME/.android/" || true
case "$MODE" in
  Debug)
    TASKS=(":app:assembleStandardDebug")
    [ "${TAVERN_APK_SKIP_TESTS:-0}" = 1 ] || TASKS+=(":app:testStandardDebugUnitTest")
    ./gradlew "${TASKS[@]}" --console=plain \
      --dependency-verification=lenient -Duser.home="$USER_HOME"
    SOURCE="$BUILD/app/build/outputs/apk/standard/debug/app-standard-debug.apk"
    ;;
  Release)
    : "${DSHA_KEYSTORE:?发布包必须指定独立的酒馆签名密钥 DSHA_KEYSTORE}"
    : "${DSHA_KEYSTORE_PASSWORD:?缺少 DSHA_KEYSTORE_PASSWORD}"
    : "${DSHA_KEY_ALIAS:?缺少 DSHA_KEY_ALIAS}"
    : "${DSHA_KEY_PASSWORD:?缺少 DSHA_KEY_PASSWORD}"
    # 上游的 verifyPublishCertificate 只认 DSHA 历史 E7E3 证书；酒馆包先用未签名变体
    # 打包，再用自己的长期密钥签名，避免伪造或改动上游的证书校验。
    TASKS=(":app:assembleStandardRelease")
    # 上游没有 release 变体的单测任务（只有 testStandardDebugUnitTest），
    # 断言照样要跑：补丁改过启动流程的 profile 与安装步骤。
    [ "${TAVERN_APK_SKIP_TESTS:-0}" = 1 ] || TASKS+=(":app:testStandardDebugUnitTest")
    ./gradlew -Pdsha.unsignedPackage=true "${TASKS[@]}" --console=plain \
      --dependency-verification=lenient -Duser.home="$USER_HOME"
    UNSIGNED="$BUILD/app/build/outputs/apk/standard/release/app-standard-release-unsigned.apk"
    [ -f "$UNSIGNED" ] || { echo "找不到未签名产物：$UNSIGNED" >&2; exit 1; }
    TOOLS="$ANDROID_HOME/build-tools/37.0.0"
    ALIGNED="$BUILD/app-standard-release-aligned.apk"
    SIGNED="$BUILD/app-standard-release-signed.apk"
    "$TOOLS/zipalign" -p -f 4 "$UNSIGNED" "$ALIGNED"
    "$TOOLS/apksigner" sign --ks "$DSHA_KEYSTORE" --ks-pass env:DSHA_KEYSTORE_PASSWORD \
      --ks-key-alias "$DSHA_KEY_ALIAS" --key-pass env:DSHA_KEY_PASSWORD \
      --out "$SIGNED" "$ALIGNED"
    "$TOOLS/apksigner" verify --print-certs "$SIGNED" >/dev/null
    SOURCE="$SIGNED"
    ;;
  *) echo 'TAVERN_APK_MODE 只能为 Debug 或 Release' >&2; exit 1 ;;
esac
python3 - "$SOURCE" "$WORK" "$MODE" "$SUFFIX" <<'PY'
import hashlib, pathlib, shutil, sys
source, work, mode = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3].lower()
suffix = sys.argv[4] if len(sys.argv) > 4 else ''
if not source.is_file():
    raise SystemExit(f'找不到构建产物：{source}')
target = work / f'dsh-tavern-android-{mode}{suffix}.apk'
shutil.copyfile(source, target)
target.with_suffix('.apk.sha256').write_text(hashlib.sha256(target.read_bytes()).hexdigest() + '  ' + target.name + '\n')
print(target)
PY
