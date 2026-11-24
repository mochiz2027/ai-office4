#!/usr/bin/env bash
# API(8000)와 웹(3000)을 함께 실행합니다. Ctrl+C 로 둘 다 종료합니다.
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT
uv run uvicorn app.main:app --app-dir api --reload --port 8000 &
(cd web && npm run dev) &
wait
