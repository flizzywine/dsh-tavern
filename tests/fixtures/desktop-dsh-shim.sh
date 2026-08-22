#!/bin/sh

set -eu

: "${DSH_DESKTOP_APP:?missing DSH_DESKTOP_APP}"
: "${DSH_DESKTOP_CLI:?missing DSH_DESKTOP_CLI}"

ELECTRON_RUN_AS_NODE=1 exec "${DSH_DESKTOP_APP}" --expose-internals "${DSH_DESKTOP_CLI}" "$@"
