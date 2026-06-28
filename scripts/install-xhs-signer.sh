#!/usr/bin/env bash
# Linux: install xhshow signer venv for apps/server/tools/xhs_signer
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$ROOT/apps/server/tools/xhs_signer/.venv"
REQ="$ROOT/apps/server/tools/xhs_signer/requirements.txt"
PY="$VENV_DIR/bin/python"

echo "========================================"
echo " XHS signer dependencies (Linux)"
echo "========================================"
echo "Project: $ROOT"
echo

if [[ ! -f "$REQ" ]]; then
  echo "ERROR: missing $REQ"
  exit 1
fi

if command -v python3.11 >/dev/null 2>&1; then
  PYTHON_BIN=python3.11
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN=python3
else
  echo "ERROR: python3.11 or python3 not found"
  exit 1
fi

if [[ ! -x "$PY" ]]; then
  echo "Creating venv: $VENV_DIR (using $PYTHON_BIN)"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r "$REQ"
"$PY" -c "import xhshow; print('xhshow OK')"

echo
echo "Done. Add to apps/server/.env:"
echo "  XHS_SIGNER_PYTHON=tools/xhs_signer/.venv/bin/python"
echo "  XHS_SIGNER_ENABLED=true"
echo
