#!/usr/bin/env bash
# Dekripsi arsip backup mingguan AssetFlow (.tar.gz.enc) hasil GitHub Actions.
# Pemakaian:
#   BACKUP_ENCRYPTION_KEY="..." ./scripts/decrypt-backup.sh assetflow-backup-2026-11-29_1900Z.tar.gz.enc [folder-tujuan]
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Pemakaian: BACKUP_ENCRYPTION_KEY='...' $0 <file.tar.gz.enc> [folder-tujuan]" >&2
  exit 1
fi

ENC_FILE="$1"
DEST_DIR="${2:-.}"

if [ ! -f "$ENC_FILE" ]; then
  echo "File tidak ditemukan: $ENC_FILE" >&2
  exit 1
fi

if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  read -r -s -p "Masukkan BACKUP_ENCRYPTION_KEY: " BACKUP_ENCRYPTION_KEY
  echo ""
  export BACKUP_ENCRYPTION_KEY
fi

SHA_FILE="${ENC_FILE}.sha256"
if [ -f "$SHA_FILE" ]; then
  echo "Memeriksa checksum SHA-256..."
  (cd "$(dirname "$ENC_FILE")" && sha256sum -c "$(basename "$SHA_FILE")")
fi

mkdir -p "$DEST_DIR"
echo "Mendekripsi & mengekstrak ke $DEST_DIR ..."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$ENC_FILE" \
  -pass env:BACKUP_ENCRYPTION_KEY | tar -C "$DEST_DIR" -xzf -

echo "Selesai! Isi arsip berhasil diekstrak ke: $DEST_DIR"
