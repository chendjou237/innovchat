#!/bin/sh
# Daily encrypted database backup, kept 30 days (NFR-16).
# Runs inside the "backup" container; needs PG* variables and BACKUP_PASSPHRASE.
set -eu
STAMP=$(date +%Y-%m-%d_%H%M)
FILE="/backups/innovcare_${STAMP}.sql.gz.gpg"
pg_dump --no-owner --format=plain | gzip | gpg --batch --yes --pinentry-mode loopback \
  --symmetric --cipher-algo AES256 --passphrase "$BACKUP_PASSPHRASE" -o "$FILE"
echo "$(date -Iseconds) backup written: $FILE ($(du -h "$FILE" | cut -f1))"
find /backups -name 'innovcare_*.sql.gz.gpg' -mtime +30 -delete
