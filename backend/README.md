# HiTOP Backend Local

Django + PostgreSQL local para Sprint 2. Disenado para beta pseudonimizada, no para PHI en produccion.

## Arranque Con Docker

1. Instalar Docker Desktop.
2. Copiar `.env.example` a `.env`.
3. Cambiar `POSTGRES_PASSWORD`, `DJANGO_SECRET_KEY`, `FIELD_ENCRYPTION_KEY` y `HITOP_BACKUP_PASSPHRASE`.
4. Levantar servicios:

```bash
docker compose up --build
```

5. Migrar y crear usuario:

```bash
docker compose exec web python manage.py migrate
docker compose exec web python manage.py createsuperuser
```

API local:

- `GET http://127.0.0.1:8000/api/health/`
- `POST http://127.0.0.1:8000/api/auth/login/`
- `POST http://127.0.0.1:8000/api/patient/auth/login/`
- `GET http://127.0.0.1:8000/api/patient/sessions/`
- `GET http://127.0.0.1:8000/api/patients/`
- `GET http://127.0.0.1:8000/api/export/csv/`

Portal paciente:

- `GET http://127.0.0.1:8000/paciente/`
- Credencial inicial: codigo HCL/Yachay + DNI.
- El codigo HCL se guarda como hash HMAC para busqueda.
- El DNI se guarda como hash de password Django, nunca plano.

Para enrolar un paciente desde admin:

1. Crear o ubicar `Patient`.
2. Crear `Patient portal access`.
3. Escribir codigo HCL/Yachay y DNI inicial una sola vez.

## Backups Locales Cifrados

```bash
backend/scripts/backup_local.sh
```

El dump se guarda en `backups/*.sql.enc`, queda ignorado por Git y se registra en `BackupRun`.

## Verificacion Local Sin Docker

```bash
python -m venv /tmp/hitop_backend_venv
/tmp/hitop_backend_venv/bin/pip install -r backend/requirements.txt
/tmp/hitop_backend_venv/bin/python backend/manage.py check
/tmp/hitop_backend_venv/bin/python backend/manage.py test clinical
```

## Modelo De Datos

- `Patient`: pseudonimo (`SUBJ-001`), sin identificadores.
- `PatientIdentifier`: payload opcional cifrado, separado de `Patient`.
- `PatientPortalAccess`: HCL hasheado + DNI hasheado para login paciente local.
- `AssessmentSession`: sesion por paciente.
- `AssessmentResult`: resultado por escala/version.
- `AuditLog`: append-only para acciones criticas.
- `BackupRun`: registro de backups cifrados.

## Limite

Este backend todavia no es produccion clinica. Falta MFA, politicas de retencion, restauracion probada, hardening OWASP ASVS, revision legal/regulatoria y deploy bajo BAA si se almacenara PHI.
