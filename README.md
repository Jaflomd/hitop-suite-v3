# HiTOP Suite v3

Beta interna autocontenida para exploracion dimensional HiTOP + neurodesarrollo.

## App

- `index.html`: app local en HTML unico.
- No requiere assets externos: CSS, datos, items y logica estan embebidos en el HTML.
- Abrir directamente en navegador o servir la carpeta con un servidor local simple.

## Sprint 1

- App local/pseudonimizada: un solo `Paciente nuevo`, sin datos demo.
- Export CSV usa `subject_id` generado (`SUBJ-001`) y no exporta nombres, iniciales ni fechas de nacimiento.
- Checklist clinico por escala: `CLINICAL_REVIEW_CHECKLIST.md`.
- Tests automaticos de scoring: `npm test`.

## Backend Local

- Stack: Django + PostgreSQL local via Docker Compose.
- Carpeta: `backend/`.
- SPEC: `BACKEND_LOCAL_SPEC.md`.
- Auth: sesiones server-side de Django.
- Datos: `Patient`, `AssessmentSession`, `AssessmentResult`, `AuditLog`, `BackupRun`.
- Backups: `backend/scripts/backup_local.sh`, cifrado con OpenSSL y excluido de Git.

Arranque:

```bash
cp .env.example .env
docker compose up --build
docker compose exec web python manage.py migrate
docker compose exec web python manage.py createsuperuser
```

## Verificacion

```bash
npm test
npm run check:syntax
python backend/manage.py check
python backend/manage.py test clinical
```

## Estado

- Ubicacion de trabajo: `2-wip/HiTOP Suite v3/`.
- Pacientes demo eliminados.
- Puntajes derivados/simulados eliminados: si no hay escala completada, el dominio queda `s/d`.
- Fecha de traslado inicial: 2026-06-07.

## Notas de riesgo

- Beta interna, no herramienta clinica validada.
- La clave de acceso esta en cliente y no constituye seguridad real.
- No usar con datos identificables de pacientes hasta implementar backend seguro, control de acceso, auditoria, consentimiento y gobierno de datos.
- Ver `PRODUCTION_READINESS.md` antes de cualquier uso clinico real.
