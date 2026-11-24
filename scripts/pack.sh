#!/usr/bin/env bash
# 배포용 설치 파일 office/release/mwa-<버전>.tar.gz 를 만듭니다.
set -euo pipefail
cd "$(dirname "$0")/.."
VER="$(node -p "require('./package.json').version")"
OUT="office/release"; NAME="mwa-$VER"
mkdir -p "$OUT"; TMP="$(mktemp -d)"; mkdir "$TMP/$NAME"
cp -R bin office docs package.json README.md install.sh "$TMP/$NAME/"
rm -rf "$TMP/$NAME/office/release" "$TMP/$NAME/office/test"
tar -czf "$OUT/$NAME.tar.gz" -C "$TMP" "$NAME"
rm -rf "$TMP"
echo "$OUT/$NAME.tar.gz"
