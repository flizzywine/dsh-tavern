#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
expected_sha=3550e05773e7ed84c6411ebd182e87d68e7eb2b692c34e117f09ceb520a71b02
build_root=$(mktemp -d "${TMPDIR:-/tmp}/dsh-mvu-host-build.XXXXXX")

cleanup() {
  rm -rf -- "$build_root"
}
trap cleanup EXIT HUP INT TERM

cp -R "$vendor_dir/upstream/." "$build_root/"
node "$script_dir/prepare-host-build.mjs" "$build_root/webpack.config.ts"

(
  cd "$build_root"
  corepack yarn install --immutable
  CI=true corepack yarn build
)

actual_sha=$(shasum -a 256 "$build_root/artifact/bundle.js" | awk '{ print $1 }')
if [ "$actual_sha" != "$expected_sha" ]; then
  echo "官方 MVU 宿主产物哈希不一致：期望 ${expected_sha}，实际 ${actual_sha}" >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  output_dir=$1
  mkdir -p "$output_dir"
  cp "$build_root/artifact/bundle.js" "$output_dir/bundle.js"
  cp "$build_root/artifact/bundle.js.LICENSE.txt" "$output_dir/bundle.js.LICENSE.txt"
else
  cmp "$build_root/artifact/bundle.js" "$script_dir/artifact/bundle.js"
  cmp "$build_root/artifact/bundle.js.LICENSE.txt" "$script_dir/artifact/bundle.js.LICENSE.txt"
fi

echo "官方 MVU 宿主产物验证通过：${actual_sha}"
