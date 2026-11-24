#!/usr/bin/env bash
# MWA 설치 스크립트 — tar.gz 를 푼 폴더 안에서 실행합니다.  사용법: bash install.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
VER="$(node -p "require('$SRC/package.json').version" 2>/dev/null || true)"
[ -z "$VER" ] && { echo "❌ Node.js 20 이상이 필요합니다. (WSL/Ubuntu: https://nodejs.org 또는 nvm 사용)"; exit 1; }
DEST="${MWA_HOME:-$HOME/.local/share/mwa}/$VER"
BIN="${MWA_BIN:-$HOME/.local/bin}"
if [ -d "$DEST" ]; then
  read -r -p "이미 $DEST 에 설치되어 있습니다. 덮어쓸까요? [y/N] " a
  [[ "$a" =~ ^[Yy]$ ]] || { echo "설치를 취소했습니다."; exit 0; }
  rm -rf "$DEST"
fi
mkdir -p "$DEST" "$BIN"
cp -R "$SRC/bin" "$SRC/office" "$SRC/docs" "$SRC/package.json" "$SRC/README.md" "$DEST/"
chmod +x "$DEST/bin/mwa.js"
ln -sf "$DEST/bin/mwa.js" "$BIN/mwa"
echo "✅ mwa $VER 설치 완료 → $BIN/mwa"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "ℹ️  PATH 에 $BIN 을 추가하세요:  echo 'export PATH=\"$BIN:\$PATH\"' >> ~/.bashrc && source ~/.bashrc";; esac
"$BIN/mwa" doctor || true
