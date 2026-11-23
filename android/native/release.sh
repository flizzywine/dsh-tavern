#!/usr/bin/env bash
# 发布原生版安装包（正式签名）：导出 HEAD 源码 → 隔离安装 → 打包 → 核对 → 上传到酒馆 Release
# → 下载回来再核对 → 本地提交 android/native/latest.json。
#   bash android/native/release.sh <versionCode> <versionName> <酒馆 Release 标签>
#   例：bash android/native/release.sh 8 1.0.0-beta.3 v3.5
# 不推送。latest.json 一推到 main，启动页就会提示新版，所以只在上传和核对都通过后才提交；
# 推送按 AGENTS.md「分支与推送」手动做。
# 可选环境变量：
#   RELEASE_NOTES      弹窗里的更新内容
#   MIN_VERSION_CODE   低于它的版本强制更新（默认 0）
#   SKIP_BUILD=1       复用 OUT 里已打好的 APK（上传中断后续跑）
#   NO_UPLOAD=1        只打包和核对，不上传、不提交
#   FORCE=1            跳过「versionCode 必须大于 latest.json」的检查
#   EXPECT_SIGNER      发布证书 SHA-256（默认取 latest.json 的 signer；换了签名已安装的用户就无法覆盖升级）
#   OUT                产物目录（默认 output/native-proto/release-<versionName>）
#   SIGNING_DIR        发布密钥目录（默认 ~/.config/dsh-tavern-android，含 release.jks、release.pass）
#   GH_REPO            默认 flizzywine/dsh-tavern
#   HOST_NODE、PNPM_CJS 打包机的 node 与 pnpm.cjs（隔离安装不经过本机的 pnpm 包装脚本，它在隔离 HOME 下会失败）
set -euo pipefail
die() { echo "release.sh: $*" >&2; exit 1; }
warn() { echo "注意: $*" >&2; }
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
REPO=$(cd -- "$HERE/../.." && pwd)
[ $# -eq 3 ] || { sed -n '4,5p' "$0" >&2; exit 2; }
CODE=$1; NAME=$2; TAG=$3
[[ $CODE =~ ^[0-9]+$ ]] || die "versionCode 必须是整数：$CODE"
[[ $NAME =~ ^[0-9A-Za-z.+-]+$ ]] || die "versionName 含不支持的字符：$NAME"

GH_REPO=${GH_REPO:-flizzywine/dsh-tavern}
P=$REPO/output/native-proto
OUT=${OUT:-$P/release-$NAME}
FAKEHOME=${FAKEHOME:-$P/fakehome}
SIGNING_DIR=${SIGNING_DIR:-$HOME/.config/dsh-tavern-android}
SDK=${ANDROID_HOME:-$HOME/Android/Sdk}
BT=${BUILD_TOOLS:-$SDK/build-tools/36.0.0}
PKG=io.github.flizzywine.dshtavern.bionic
LATEST=$HERE/latest.json
APK_NAME=dsh-tavern-beta-$NAME.apk
APK=$OUT/$APK_NAME
INFO=$OUT/dsh-tavern-native.json
APK_URL=https://github.com/$GH_REPO/releases/download/$TAG/$APK_NAME
PAGE=https://github.com/$GH_REPO/releases/tag/$TAG
json_get() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))' "$1" "$2"; }

# ---- 预检
echo "== 预检"
command -v gh >/dev/null || die "缺少 gh"
for t in aapt2 apksigner; do [ -x "$BT/$t" ] || die "缺少 $BT/$t"; done
[ -f "$SIGNING_DIR/release.jks" ] && [ -f "$SIGNING_DIR/release.pass" ] || die "发布密钥不在 $SIGNING_DIR（release.jks、release.pass）"
git -C "$REPO" diff --quiet HEAD -- || die "有未提交的改动；打包只取 HEAD，先提交或暂存"
BRANCH=$(git -C "$REPO" rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = main ] || warn "当前在 $BRANCH，不在 main；latest.json 要进 main 才生效"
gh release view "$TAG" -R "$GH_REPO" --json tagName >/dev/null 2>&1 || die "$GH_REPO 没有 Release $TAG，先发布酒馆版本"
LATEST_TAG=$(gh api "repos/$GH_REPO/releases/latest" --jq .tag_name 2>/dev/null || true)
[ "$LATEST_TAG" = "$TAG" ] || warn "最新 Release 是 ${LATEST_TAG:-（无）}，不是 $TAG；1.0.0-beta.1 只读最新 Release 里的 dsh-tavern-native.json，看不到这次更新"
if [ -f "$LATEST" ]; then
  PREV_CODE=$(json_get "$LATEST" versionCode)
  if [ "${FORCE:-0}" != 1 ] && [ "$CODE" -le "${PREV_CODE:-0}" ]; then
    die "versionCode $CODE 不大于 latest.json 的 $PREV_CODE（FORCE=1 跳过）"
  fi
  EXPECT_SIGNER=${EXPECT_SIGNER:-$(json_get "$LATEST" signer)}
fi
EXPECT_SIGNER=$(printf '%s' "${EXPECT_SIGNER:-}" | tr 'A-F' 'a-f')
[ -n "$EXPECT_SIGNER" ] || warn "没有可比对的发布证书指纹（EXPECT_SIGNER / latest.json），本次只记录不核对"
echo "versionCode $CODE / versionName $NAME → $TAG（$GH_REPO），源码 $(git -C "$REPO" rev-parse --short HEAD)"

mkdir -p "$OUT"
LOG=$OUT/release.log
exec > >(tee -a "$LOG") 2>&1
echo "== $(date '+%F %T') 日志 $LOG"

# ---- 打包
if [ "${SKIP_BUILD:-0}" = 1 ]; then
  [ -f "$APK" ] && [ -f "$INFO" ] || die "SKIP_BUILD=1 但 $OUT 里没有 $APK_NAME 与 dsh-tavern-native.json"
  echo "== 复用已打好的 $APK_NAME"
else
  HOST_NODE=${HOST_NODE:-$(readlink -f "$(command -v node)")}
  [ -x "$HOST_NODE" ] || die "找不到 node（HOST_NODE）"
  PNPM_VER=$("$HOST_NODE" -p "require('$REPO/package.json').packageManager.split('@')[1]")
  PNPM_CJS=${PNPM_CJS:-${COREPACK_HOME:-$HOME/.cache/node/corepack}/v1/pnpm/$PNPM_VER/bin/pnpm.cjs}
  [ -f "$PNPM_CJS" ] || die "找不到 pnpm $PNPM_VER（$PNPM_CJS）；先 corepack install，或设 PNPM_CJS"
  SHIM=$OUT/host-bin; mkdir -p "$SHIM"
  printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$HOST_NODE" "$PNPM_CJS" > "$SHIM/pnpm"; chmod +x "$SHIM/pnpm"
  ln -sf "$HOST_NODE" "$SHIM/node"

  SRC=$OUT/src
  echo "== 导出源码 → $SRC"
  rm -rf "$SRC"; mkdir -p "$SRC"; git -C "$REPO" archive HEAD | tar -x -C "$SRC"

  echo "== 隔离安装（HOME=$FAKEHOME）"
  mkdir -p "$FAKEHOME"
  (
    cd "$SRC"
    export PATH=$SHIM:/usr/bin:/bin HOME=$FAKEHOME DSH_HOME=$FAKEHOME/.dsh-tavern DSH_TAVERN_CLI_HOME=$FAKEHOME/.dsh-tavern \
      DSH_TAVERN_RUNTIME_HOST=cli DSH_TAVERN_NO_OPEN=1 DSH_TAVERN_MOBILE_LAYOUT=1 \
      npm_config_ignore_scripts=true pnpm_config_ignore_scripts=true
    pnpm install --prod --frozen-lockfile --ignore-scripts --reporter=append-only | tail -3
    node bin/dsh-tavern.mjs install --host cli | tail -8
  )
  [ -f "$SRC/.dsh-tavern-local.json" ] || die "隔离安装没有生成 .dsh-tavern-local.json"

  echo "== 打包"
  rm -f "$APK" "$APK.sha256" "$INFO"
  PATH=$SHIM:$PATH RELEASE=1 RELEASE_KEYSTORE=$SIGNING_DIR/release.jks RELEASE_KEY_ALIAS=dsh-tavern \
    RELEASE_KEY_PASS_FILE=$SIGNING_DIR/release.pass VERSION_CODE=$CODE VERSION_NAME=$NAME \
    APK_URL=$APK_URL RELEASE_PAGE=$PAGE RELEASE_NOTES=${RELEASE_NOTES:-} MIN_VERSION_CODE=${MIN_VERSION_CODE:-0} \
    OUT=$OUT bash "$HERE/build-apk.sh" "$SRC" "$FAKEHOME/.dsh-tavern"
fi
# build-apk.sh 写的 .sha256 带绝对路径；上传用的只留文件名，下载后才能 sha256sum -c。
(cd "$OUT" && sha256sum "$APK_NAME" > "$APK_NAME.sha256")

# ---- 核对：包信息、签名、debuggable、发布信息与文件一致
echo "== 核对"
BADGING=$("$BT/aapt2" dump badging "$APK" 2>/dev/null | head -1)
[[ $BADGING == *"name='$PKG'"* && $BADGING == *"versionCode='$CODE'"* && $BADGING == *"versionName='$NAME'"* ]] \
  || die "包信息不符：$BADGING"
if "$BT/aapt2" dump xmltree --file AndroidManifest.xml "$APK" 2>/dev/null | grep -qiE 'debuggable[^=]*=(true|0xffffffff)'; then
  die "正式包仍是 debuggable"
fi
ACTUAL_SIGNER=$("$BT/apksigner" verify --print-certs "$APK" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1 | tr 'A-F' 'a-f')
[ -n "$ACTUAL_SIGNER" ] || die "apksigner 校验失败"
[ -z "$EXPECT_SIGNER" ] || [ "$ACTUAL_SIGNER" = "$EXPECT_SIGNER" ] || die "签名证书与已发布版本不同，已安装的用户无法覆盖升级"
python3 - "$OUT" "$APK_NAME" "$CODE" "$NAME" "$APK_URL" "$PAGE" "$ACTUAL_SIGNER" "${MIN_VERSION_CODE:-0}" <<'PY'
import hashlib, json, os, sys
d, apk, code, name, url, page, signer, min_code = sys.argv[1:]
info = json.load(open(os.path.join(d, 'dsh-tavern-native.json')))
h = hashlib.sha256()
with open(os.path.join(d, apk), 'rb') as f:
    for c in iter(lambda: f.read(1 << 20), b''): h.update(c)
want = {'versionCode': int(code), 'versionName': name, 'url': url, 'page': page, 'signer': signer,
        'minVersionCode': int(min_code), 'sha256': h.hexdigest(), 'size': os.path.getsize(os.path.join(d, apk))}
bad = [f'{k}: {info.get(k)!r} ≠ {v!r}' for k, v in want.items() if info.get(k) != v]
if int(min_code) > int(code): bad.append(f'minVersionCode {min_code} 大于 versionCode {code}')
if bad: sys.exit('发布信息不符：\n  ' + '\n  '.join(bad))
print(f"发布信息一致：{info['size']} 字节，sha256 {info['sha256']}")
PY
SIZE=$(stat -c %s "$APK")
du -h "$APK"
if [ "${NO_UPLOAD:-0}" = 1 ]; then echo "NO_UPLOAD=1：到此为止，产物在 $OUT"; exit 0; fi

# ---- 上传并下载回来核对
echo "== 上传到 $TAG"
gh release upload "$TAG" -R "$GH_REPO" "$APK" "$APK.sha256" "$INFO" --clobber
D=$(mktemp -d "$OUT/verify.XXXXXX"); trap 'rm -rf "$D"' EXIT
gh release download "$TAG" -R "$GH_REPO" -p "$APK_NAME" -p "$APK_NAME.sha256" -p dsh-tavern-native.json -D "$D"
(cd "$D" && sha256sum -c "$APK_NAME.sha256")
for f in "$APK_NAME" "$APK_NAME.sha256" dsh-tavern-native.json; do cmp -s "$OUT/$f" "$D/$f" || die "Release 上的 $f 与本地不同"; done
# 启动页按 url 下载：按公开地址（会重定向到别的域名）再确认一次字节数。
REMOTE_SIZE=$(curl -fsIL "$APK_URL" | tr -d '\r' | awk 'tolower($1)=="content-length:"{n=$2} END{print n}')
[ "$REMOTE_SIZE" = "$SIZE" ] || die "公开地址 $APK_URL 的字节数 ${REMOTE_SIZE:-?} 与本地 $SIZE 不同"
echo "Release 资产核对通过（字节数、SHA-256、公开地址）"

# ---- 本地提交 latest.json（不推送）
cp "$INFO" "$LATEST"
if git -C "$REPO" diff --quiet -- "$LATEST"; then
  echo "latest.json 没有变化，不提交"
else
  git -C "$REPO" add -- "$LATEST"
  git -C "$REPO" commit -q -m "chore(android-native): 发布 $NAME（versionCode $CODE）的安装包信息

安装包已上传到 $TAG Release，下载回来核对过字节数、SHA-256 与签名指纹。" -- "$LATEST"
  git -C "$REPO" log --oneline -1
fi
echo "完成。推送 main 后启动页开始提示 $NAME。"
