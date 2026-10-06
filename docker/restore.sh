#!/bin/sh
# Restores a backup into the database. Test this before go-live (NFR-16).
# Usage (from the host):
#   docker compose run --rm backup /restore.sh /backups/innovcare_2026-10-05_0200.sql.gz.gpg
# The target database should be empty (e.g. a fresh volume or a scratch database set via PGDATABASE).
set -eu
FILE="$1"
gpg --batch --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -d "$FILE" | gunzip | psql -v ON_ERROR_STOP=1 --quiet
echo "restored $FILE into $PGDATABASE"
