#!/usr/bin/env bash
# MWA 운영실(3F)이 티켓마다 실행하는 테스트 명령입니다. 비대화형으로 끝나야 합니다.
set -euo pipefail
cd "$(dirname "$0")/.."
uv run pytest -q
if [ -d web/node_modules ]; then (cd web && npm run typecheck --silent); else echo "web: node_modules 없음 — 타입 검사 건너뜀 (scripts/setup.sh 실행 필요)"; fi
