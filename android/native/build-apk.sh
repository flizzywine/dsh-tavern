#!/usr/bin/env bash
# 不用 Gradle 打出原生原型 APK：javac + d8 + aapt2 + zipalign + apksigner。
#   bash android/native/build-apk.sh <src> <dsh-home>
# <src> 与 <dsh-home> 的准备方式见 README（git archive + 隔离的命令行版安装）。
# 产物：output/native-proto/apk/dsh-tavern-bionic-debug.apk（含 arm64-v8a 与 x86_64）。
set -euo pipefail
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
REPO=$(cd -- "$HERE/../.." && pwd)
SRC=$1; DSH_HOME=$2
OUT=${OUT:-$REPO/output/native-proto/apk}
SDK=${ANDROID_HOME:-$HOME/Android/Sdk}
BT=${BUILD_TOOLS:-$SDK/build-tools/36.0.0}
JAR=${ANDROID_JAR:-$SDK/platforms/android-36/android.jar}
JDK=${JAVA_HOME:-$HOME/devtools/jdk-17.0.20.1+1}
PKG=io.github.flizzywine.dshtavern.bionic
DEVICE_ROOT=/data/user/0/$PKG/files/t
VERSION_CODE=${VERSION_CODE:-4}
VERSION_NAME=${VERSION_NAME:-0.4.0-proto+$(git -C "$REPO" rev-parse --short HEAD)}
TERMUX=$REPO/output/native-proto
mkdir -p "$OUT"

# 1) Termux 的 node（每个 ABI 一份），改名进 jniLibs
rm -rf "$OUT/jniLibs"
for pair in aarch64:arm64-v8a x86_64:x86_64; do
  arch=${pair%%:*}; abi=${pair#*:}
  [ -x "$TERMUX/termux-$arch/usr/bin/node" ] || python3 "$HERE/fetch-termux-node.py" --arch "$arch" --out "$TERMUX/termux-$arch"
  python3 "$HERE/pack-jnilibs.py" "$TERMUX/termux-$arch/usr" "$OUT/jniLibs/$abi" >/dev/null
done

# 2) 载荷：DSH 运行时 + profile + 源码，路径改写到应用数据目录
# REUSE_PAYLOAD=1：只改了 Java/清单时跳过最慢的这一步。
if [ "${REUSE_PAYLOAD:-0}" = 1 ] && [ -f "$OUT/payload/payload.tar.gz" ]; then echo "复用已有载荷"; else
PAYLOAD_SKIP_NATIVE=1 PAYLOAD_MOBILE_LAYOUT=${PAYLOAD_MOBILE_LAYOUT:-$REPO/node_modules/dsh-web-mobile} bash "$HERE/stage-payload.sh" "$TERMUX/termux-x86_64/usr" "$SRC" "$DSH_HOME" "$OUT/payload" "$DEVICE_ROOT"
fi

# 3) Java → dex
rm -rf "$OUT/classes" "$OUT/dex"; mkdir -p "$OUT/classes" "$OUT/dex"
"$JDK/bin/javac" -nowarn -encoding UTF-8 -source 11 -target 11 -classpath "$JAR" -d "$OUT/classes" \
  $(find "$HERE/app/src" -name '*.java') 2>&1 | grep -v -E 'bootstrap class path|^1 warning$|source value 11|target value 11|To suppress warnings' || true
"$BT/d8" --min-api 30 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

# 4) 清单 → 基础包；再用 zip 加 dex、jniLibs、载荷（载荷不压缩：已是 gzip，且 openFd 要求 STORED）
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest "$HERE/app/AndroidManifest.xml" \
  --min-sdk-version 30 --target-sdk-version 35 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME"
python3 - "$OUT" <<'PY'
import os, shutil, sys, zipfile
out = sys.argv[1]
shutil.copyfile(f'{out}/base.apk', f'{out}/unsigned.apk')
with zipfile.ZipFile(f'{out}/unsigned.apk', 'a') as z:
    z.write(f'{out}/dex/classes.dex', 'classes.dex', zipfile.ZIP_DEFLATED)
    for abi in sorted(os.listdir(f'{out}/jniLibs')):
        for name in sorted(os.listdir(f'{out}/jniLibs/{abi}')):
            z.write(f'{out}/jniLibs/{abi}/{name}', f'lib/{abi}/{name}', zipfile.ZIP_DEFLATED)
    z.write(f'{out}/payload/payload.tar.gz', 'assets/payload.bin', zipfile.ZIP_STORED)
    z.write(f'{out}/payload/payload-source.json', 'assets/payload-source.json', zipfile.ZIP_DEFLATED)
PY

# 5) 对齐 + 调试签名
"$BT/zipalign" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
KS=${DEBUG_KEYSTORE:-$HOME/.android/debug.keystore}
APK="$OUT/dsh-tavern-bionic-debug.apk"
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey --out "$APK" "$OUT/aligned.apk"
rm -f "$OUT/unsigned.apk" "$OUT/aligned.apk" "$OUT/base.apk" "$APK.idsig"
sha256sum "$APK" | tee "$APK.sha256"
# 发布信息：随 APK 一起上传到 GitHub Release（资产名 dsh-tavern-native.json），启动页据此发现新版安装包。
python3 - "$APK" "$VERSION_CODE" "$VERSION_NAME" > "$OUT/dsh-tavern-native.json" <<'PY'
import hashlib, json, os, sys
apk, code, name = sys.argv[1], int(sys.argv[2]), sys.argv[3]
data = open(apk, 'rb').read()
print(json.dumps({'versionCode': code, 'versionName': name, 'url': os.path.basename(apk), 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}, indent=2))
PY
du -h "$APK"
