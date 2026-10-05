#!/usr/bin/env bash
# Builds Lighter's official WASM signer (github.com/elliottech/lighter-go, ./wasm) into public/lighter/.
# wasm_exec.js is copied from the same Go toolchain, as the docs require. To upgrade, change LIGHTER_GO_COMMIT,
# run this script and commit public/lighter/ (the build is reproducible: same commit + Go version = same sha256).
set -euo pipefail

LIGHTER_GO_REPO="https://github.com/elliottech/lighter-go"
LIGHTER_GO_COMMIT="9d38261d1a4cc5c7211b383ba07a4d6e41604708"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/lighter"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$LIGHTER_GO_REPO" "$WORK/lighter-go"
git -C "$WORK/lighter-go" checkout --quiet "$LIGHTER_GO_COMMIT"

(cd "$WORK/lighter-go" && GOOS=js GOARCH=wasm go build -trimpath -o "$WORK/lighter-signer.wasm" ./wasm/)

GLUE="$(go env GOROOT)/lib/wasm/wasm_exec.js"
[ -f "$GLUE" ] || GLUE="$(go env GOROOT)/misc/wasm/wasm_exec.js"

mkdir -p "$OUT"
cp "$WORK/lighter-signer.wasm" "$OUT/lighter-signer.wasm"
cp "$GLUE" "$OUT/wasm_exec.js"
# lighter-go is Apache-2.0: ship its license with the binary.
cp "$WORK/lighter-go/LICENSE" "$OUT/LICENSE-lighter-go"

cat > "$OUT/VERSION" <<EOF
lighter-go $LIGHTER_GO_COMMIT
$(go version)
sha256 $(sha256sum "$OUT/lighter-signer.wasm" | cut -d' ' -f1)  lighter-signer.wasm
sha256 $(sha256sum "$OUT/wasm_exec.js" | cut -d' ' -f1)  wasm_exec.js
EOF

cat "$OUT/VERSION"
