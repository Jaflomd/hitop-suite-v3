# Backend Local SPEC

```yaml
spec_level: SPEC
status: implemented-local
risk: high
sensitivity: pseudonymized-health-data
pillars:
  - precision-psychiatry
  - ai-enhancement
  - research
pillar_role:
  primary: precision-psychiatry
  secondary:
    - ai-enhancement
    - research
```

## Objetivo

Crear backend local de costo cero para HiTOP Suite v3 usando Django + PostgreSQL en Docker, con autenticacion server-side, pacientes/sesiones/evaluaciones separadas, auditoria append-only y backups locales cifrados.

## Alcance

- Django server-side auth con sesiones.
- PostgreSQL local via Docker Compose.
- SQLite solo para tests locales sin Docker.
- Pacientes pseudonimizados (`SUBJ-001`).
- Identificadores opcionales separados y cifrados.
- Evaluaciones separadas por sesion.
- Export CSV desde backend sin identificadores.
- Audit log de login, creacion de paciente/sesion/resultado, cierre de sesion y export.
- Script local de backup cifrado con OpenSSL.

## Fuera De Alcance

- PHI en produccion.
- Exposicion publica del servidor local.
- MFA.
- Integracion frontend-backend completa.
- Restauracion automatica de backup.
- BAA/compliance cloud.

## Done

- `docker-compose.yml` define `web` y `db`.
- Modelos Django implementados.
- API minima implementada.
- Tests backend pasan.
- Backup script existe y queda fuera de Git.
- Documentacion de arranque existe.
