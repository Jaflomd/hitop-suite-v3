# HiTOP Suite v3

Beta interna autocontenida para exploracion dimensional HiTOP + neurodesarrollo.

## App

- Webapp publicada (GitHub Pages, solo `index.html`): https://jaflomd.github.io/hitop-suite-v3/
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
- Datos: `Patient`, `PatientPortalAccess`, `AssessmentSession`, `AssessmentResult`, `AuditLog`, `BackupRun`.
- Portal paciente: `http://127.0.0.1:8000/paciente/`.
- Research intake: `http://127.0.0.1:8000/research/`.
- Dashboard clinico: `http://127.0.0.1:8000/clinico/`.
- Acceso paciente: codigo HCL/Yachay + DNI inicial; se guardan hashes, no DNI plano.
- Backups: `backend/scripts/backup_local.sh`, cifrado con OpenSSL y excluido de Git.

Arranque:

```bash
cp .env.example .env
docker compose up --build
docker compose exec web python manage.py migrate
docker compose exec web python manage.py seed_local_setup
docker compose exec web python manage.py createsuperuser
```

## Verificacion

```bash
npm test
npm run check:syntax
npm run check:webapp
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
- La clave local del HTML unico sigue siendo solo una barrera de beta; el portal paciente usa auth server-side.
- No usar con datos identificables fuera del entorno local controlado hasta completar consentimiento, privacidad, auditoria formal y gobierno de datos.
- Ver `PRODUCTION_READINESS.md` antes de cualquier uso clinico real.
