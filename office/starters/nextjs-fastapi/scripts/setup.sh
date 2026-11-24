#!/usr/bin/env bash
# 최초 1회 의존성 설치
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
command -v uv >/dev/null || { echo "uv 설치: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
uv sync
(cd web && npm install)
echo "✅ 설치 완료"
