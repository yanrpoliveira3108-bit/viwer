#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Viewer — Sistema oficial de atualização
# Uso: ./update.sh [--dry-run] [--force]
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[VIEWER] Node.js não encontrado. Instale o Node.js LTS (20+)."
  exit 1
fi

exec node scripts/update.js "$@"
