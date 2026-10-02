#!/usr/bin/env bash
# Gera dist/nexo-<versão>.zip pronto para enviar à Chrome Web Store.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
OUT="dist/nexo-${VERSION}.zip"
rm -f "$OUT"
zip -r -q "$OUT" manifest.json icons src -x "*.DS_Store"
echo "Pacote gerado: $OUT"
