#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${ROOT_DIR}/backups"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
OUT="${BACKUP_DIR}/hitop_${TIMESTAMP}.sql.enc"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

if [[ -z "${HITOP_BACKUP_PASSPHRASE:-}" ]]; then
  echo "HITOP_BACKUP_PASSPHRASE is required." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

cd "${ROOT_DIR}"

docker compose exec -T db pg_dump \
  --username "${POSTGRES_USER:-hitop}" \
  --dbname "${POSTGRES_DB:-hitop}" \
  --format plain \
  --no-owner \
  --no-privileges \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:HITOP_BACKUP_PASSPHRASE -out "${OUT}"

CHECKSUM="$(shasum -a 256 "${OUT}" | awk '{print $1}')"

docker compose exec -T web python manage.py record_backup \
  --path "/backups/$(basename "${OUT}")" \
  --checksum "${CHECKSUM}" \
  --status success

echo "${OUT}"
echo "${CHECKSUM}"
