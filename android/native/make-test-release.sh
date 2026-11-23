#!/usr/bin/env bash
# 本地造一个「发布」：运行清单 + runtime.zip + 原生 APK 发布信息，按 jsDelivr 的路径布局放好，供更新测试用。
#   bash android/native/make-test-release.sh <源码树> <releaseSequence> <输出目录> [apk 文件 versionCode versionName]
# 产物：
#   <out>/repo@runtime-archive-main/dsh-tavern-runtime.json   （DSH_TAVERN_CDN_METADATA_URL）
#   <out>/repo@<archive-commit>/runtime.zip                     （DSH_TAVERN_CDN_ROOT_URL=<base>/repo）
#   <out>/native/dsh-tavern-native.json + apk                   （DSH_NATIVE_APK_FEED）
set -euo pipefail
TREE=$(realpath "$1"); SEQ=$2; OUT=$(realpath -m "$3"); APK=${4:-}; CODE=${5:-}; NAME=${6:-}
REPO=$(cd -- "$(dirname -- "$0")/../.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp -a "$TREE/." "$WORK/"
rm -rf "$WORK/.github"; cp -a "$REPO/.github" "$WORK/.github"
REV=$(printf 'test-release-%s-%s' "$SEQ" "$(date +%s%N)" | sha1sum | cut -c1-40)
ARCHIVE_COMMIT=$(printf 'archive-%s' "$REV" | sha1sum | cut -c1-40)
( cd "$WORK" && node .github/scripts/write-runtime-manifest.mjs "$REV" "$SEQ" >/dev/null )
python3 - "$WORK" <<'PY'
import json, sys, zipfile, os
root = sys.argv[1]
files = json.load(open(os.path.join(root, 'dsh-tavern-runtime.json')))['files']
with zipfile.ZipFile(os.path.join(root, 'runtime.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files: z.write(os.path.join(root, f['path']), f['path'])
PY
( cd "$WORK" && node .github/scripts/attach-runtime-archive.mjs "$ARCHIVE_COMMIT" runtime.zip )
mkdir -p "$OUT/repo@runtime-archive-main" "$OUT/repo@$ARCHIVE_COMMIT"
cp "$WORK/dsh-tavern-runtime.json" "$OUT/repo@runtime-archive-main/"
cp "$WORK/runtime.zip" "$OUT/repo@$ARCHIVE_COMMIT/"
if [ -n "$APK" ]; then
  mkdir -p "$OUT/native"
  cp "$APK" "$OUT/native/dsh-tavern-native.apk"
  python3 - "$OUT/native" "$CODE" "$NAME" <<'PY'
import hashlib, json, os, sys
d, code, name = sys.argv[1], int(sys.argv[2]), sys.argv[3]
apk = os.path.join(d, 'dsh-tavern-native.apk')
data = open(apk, 'rb').read()
json.dump({'versionCode': code, 'versionName': name, 'url': 'dsh-tavern-native.apk', 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)},
          open(os.path.join(d, 'dsh-tavern-native.json'), 'w'), indent=2)
PY
fi
echo "revision=$REV sequence=$SEQ archive=$ARCHIVE_COMMIT"
