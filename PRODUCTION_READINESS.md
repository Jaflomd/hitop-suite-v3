# HiTOP Suite v3 - Production Readiness SPEC

```yaml
spec_level: SPEC
status: beta-interna
risk: high
sensitivity: restricted-health-data
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

## Decision

La app no esta lista para uso clinico con datos identificables. Si se usa hoy, debe ser solo beta interna, sin PHI/PII, con pacientes pseudonimizados y supervision directa de un clinico. Para clinica real necesita backend seguro, control de acceso, auditoria, validacion clinimetrica y definicion regulatoria.

## Scope Seguro V0

- Permitido: administrar escalas, calcular puntajes transparentes, exportar CSV pseudonimizado.
- No permitido: diagnostico automatico, recomendaciones terapeuticas, triage de riesgo, almacenamiento de identificadores, uso como historia clinica.
- Regla de producto: si no se midio, se muestra `s/d`. No hay puntajes simulados ni pacientes demo.

## Bloqueadores Antes De Clinica

1. Seguridad y privacidad
   - Autenticacion real; eliminar clave hardcodeada del cliente.
   - Roles: clinico, admin, auditor.
   - Cifrado en transito y reposo.
   - Auditoria inmutable: login, paciente visto, escala completada, exportacion.
   - Politica de retencion, borrado y respaldo.

2. Datos clinicos
   - Modelo de paciente pseudonimizado con separacion de identificadores.
   - Consentimiento/documento de informacion para uso de datos de salud.
   - Registro de fuente, version y fecha de cada escala.
   - Licencias/verificacion de instrumentos antes de distribucion.

3. Validez y seguridad clinica
   - Tests unitarios de scoring para cada escala.
   - Validacion por casos conocidos y revision psiquiatrica.
   - Mensajes de limite: cribado/dimensional, no diagnostico final.
   - Protocolo de manejo si aparece riesgo suicida o item critico.

4. Ingenieria
   - Migrar de HTML unico a app con backend: API, base de datos, sesiones.
   - CI/CD con lint, tests, escaneo de dependencias y deploy controlado.
   - Versionado semantico y changelog clinico.
   - Observabilidad: errores, disponibilidad, logs no sensibles.

5. Regulacion y gobierno
   - Definir intended use por escrito.
   - Determinar si es CDS no-dispositivo, SaMD o herramienta administrativa.
   - Aprobar DPIA/analisis de impacto de datos personales.
   - Tener responsable de seguridad y responsable clinico del producto.

## Ruta Recomendada

### Sprint 1 - Beta clinica sin PHI
- [x] Mantener app local/pseudonimizada.
- [x] Agregar tests automaticos de scoring.
- [x] Crear checklist de revision clinica por escala.
- [x] Export CSV sin datos identificables.

Artefactos Sprint 1:

- `index.html`: un solo paciente local no identificable y export CSV con `subject_id`.
- `tests/scoring.test.js`: tests automaticos de scoring.
- `CLINICAL_REVIEW_CHECKLIST.md`: checklist clinico por escala.
- `package.json`: comandos `npm test` y `npm run check:syntax`.

### Sprint 2 - Backend seguro
- [x] Autenticacion server-side local.
- [x] Base de datos local Docker/Postgres preparada; identificadores opcionales cifrados por campo.
- [x] Pacientes, sesiones y evaluaciones separadas.
- [x] Auditoria append-only y backups locales cifrados.
- [x] Portal paciente local con codigo HCL/Yachay + DNI inicial hasheado.
- [ ] Hardening para produccion real: MFA, TLS obligatorio, RLS/roles DB, restauracion probada, retencion, deploy bajo BAA.

Artefactos Sprint 2 local:

- `BACKEND_LOCAL_SPEC.md`: alcance y limites.
- `backend/`: Django app.
- `docker-compose.yml`: Postgres + web local.
- `backend/scripts/backup_local.sh`: backup local cifrado.
- `http://127.0.0.1:8000/paciente/`: portal paciente local.

### Sprint 3 - Validacion clinica
- Piloto con casos pseudonimizados.
- Comparar scoring manual vs app.
- Usabilidad con 2-3 clinicos.
- Registro de incidentes y cambios.

### Sprint 4 - Uso clinico controlado
- Consentimiento y politica de privacidad.
- SOP de riesgo.
- Deployment institucional.
- Revision legal/regulatoria antes de datos reales.

## Fuentes Normativas Revisadas

- Peru: Ley 29733 de Proteccion de Datos Personales, ANPD/gob.pe: https://www.gob.pe/institucion/anpd/normas-legales/2018427-29733-2011
- Peru: Reglamento Ley 29733, DS 016-2024-JUS, ANPD/gob.pe: https://www.gob.pe/institucion/anpd/normas-legales/6554453-n-016-2024-jus
- Peru: inscripcion de bancos de datos personales, ANPD/gob.pe: https://www.gob.pe/8060-inscribir-informacion-en-el-registro-nacional-de-proteccion-de-datos-personales
- Peru: Ley 30024, Registro Nacional de Historias Clinicas Electronicas, MINSA/gob.pe: https://www.gob.pe/institucion/minsa/normas-legales/240527-30024
- Peru: Decreto Legislativo 1490 sobre telesalud, gob.pe: https://www.gob.pe/institucion/presidencia/normas-legales/575965-1490
- FDA: Clinical Decision Support Software guidance/FAQ: https://www.fda.gov/medical-devices/software-medical-device-samd/clinical-decision-support-software-frequently-asked-questions-faqs
- HHS: HIPAA Security Rule overview: https://www.hhs.gov/hipaa/for-professionals/security/index.html
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/

## Done Para Declarar "Production Ready"

- No PHI en frontend sin backend seguro.
- Cero datos demo.
- Cero puntajes simulados.
- Tests de scoring verdes.
- Seguridad revisada contra OWASP ASVS.
- Consentimiento, privacidad, auditoria y backups implementados.
- Intended use aprobado.
- Revision legal/regulatoria documentada.
- Piloto clinico completado sin incidentes criticos.
