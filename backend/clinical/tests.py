import json

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.core.management import call_command
from django.test import Client, TestCase, override_settings

from .models import AssessmentResult, AssessmentSession, AuditLog, BackupRun, BatteryAssignment, BatteryTemplate, ConsentRecord, Patient, PatientIdentifier, PatientPortalAccess, TabletAccessToken

# Configuración de caché aislada para tests de rate-limiting
_TEST_CACHE = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "hitop-test-rate-limit",
    }
}


class ClinicalBackendTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="clinician", password="safe-test-password")
        for group_name in ["clinician", "research_assistant"]:
            group, _ = Group.objects.get_or_create(name=group_name)
            self.user.groups.add(group)
        self.client = Client()

    def login(self):
        response = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"username": "clinician", "password": "safe-test-password"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_requires_auth_for_patient_api(self):
        response = self.client.get("/api/patients/")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "Authentication required.")

    def test_patient_session_result_and_audit_flow(self):
        self.login()

        patient_response = self.client.post("/api/patients/", data="{}", content_type="application/json")
        self.assertEqual(patient_response.status_code, 201)
        patient = patient_response.json()["patient"]
        self.assertEqual(patient["subject_id"], "SUBJ-001")

        session_response = self.client.post(f"/api/patients/{patient['id']}/sessions/")
        self.assertEqual(session_response.status_code, 201)
        session = session_response.json()["session"]

        result_response = self.client.post(
            f"/api/sessions/{session['session_id']}/results/",
            data=json.dumps(
                {
                    "scale_id": "EFECO-21",
                    "scale_label": "EFECO-21",
                    "raw_value": "21",
                    "max_value": "63",
                    "percentile": 33,
                    "severity": "mid",
                    "payload": {"dimensions": [{"name": "Inhibicion", "total": 3}]},
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(result_response.status_code, 201)

        self.assertEqual(Patient.objects.count(), 1)
        self.assertEqual(AssessmentSession.objects.count(), 1)
        self.assertEqual(AssessmentResult.objects.count(), 1)
        self.assertGreaterEqual(AuditLog.objects.count(), 3)

    def test_patient_identifier_is_encrypted(self):
        patient = Patient.objects.create(subject_id="SUBJ-123", created_by=self.user)
        identifier = PatientIdentifier(patient=patient, updated_by=self.user)
        identifier.set_payload({"name": "Nombre Real", "document": "12345678"})
        identifier.save()

        self.assertNotIn("Nombre Real", identifier.encrypted_payload)
        self.assertNotIn("12345678", identifier.encrypted_payload)
        self.assertEqual(identifier.get_payload()["document"], "12345678")

    def test_patient_portal_access_hashes_hcl_and_dni(self):
        patient = Patient.objects.create(subject_id="SUBJ-321", created_by=self.user)
        access = PatientPortalAccess(patient=patient, created_by=self.user)
        access.set_hcl_code("YCH-000321")
        access.set_dni_password("12345678")
        access.save()

        self.assertEqual(access.hcl_code_hint, "0321")
        self.assertNotIn("YCH-000321", access.hcl_code_hash)
        self.assertNotIn("12345678", access.dni_password_hash)
        self.assertTrue(access.check_dni_password("12345678"))

    def test_patient_portal_login_session_and_result_flow(self):
        patient = Patient.objects.create(subject_id="SUBJ-654", created_by=self.user)
        access = PatientPortalAccess(patient=patient, created_by=self.user)
        access.set_hcl_code("YCH-000654")
        access.set_dni_password("87654321")
        access.save()

        login_response = self.client.post(
            "/api/patient/auth/login/",
            data=json.dumps({"hcl_code": "YCH-000654", "dni": "87654321"}),
            content_type="application/json",
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertEqual(login_response.json()["patient"]["subject_id"], "SUBJ-654")

        session_response = self.client.post("/api/patient/sessions/", data="{}", content_type="application/json")
        self.assertEqual(session_response.status_code, 201)
        session_id = session_response.json()["session"]["session_id"]

        result_response = self.client.post(
            f"/api/patient/sessions/{session_id}/results/",
            data=json.dumps(
                {
                    "scale_id": "GAD-7",
                    "scale_label": "GAD-7",
                    "raw_value": "12",
                    "max_value": "21",
                    "percentile": 57,
                    "severity": "mid",
                    "payload": {"source": "patient"},
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(result_response.status_code, 201)
        self.assertEqual(AssessmentSession.objects.filter(patient=patient).count(), 1)
        self.assertEqual(AssessmentResult.objects.filter(session__patient=patient, scale_id="GAD-7").count(), 1)
        self.assertGreaterEqual(AuditLog.objects.filter(action__startswith="patient_").count(), 2)

    def test_patient_portal_rejects_wrong_dni_without_leaking_code(self):
        patient = Patient.objects.create(subject_id="SUBJ-999", created_by=self.user)
        access = PatientPortalAccess(patient=patient, created_by=self.user)
        access.set_hcl_code("YCH-000999")
        access.set_dni_password("11112222")
        access.save()

        response = self.client.post(
            "/api/patient/auth/login/",
            data=json.dumps({"hcl_code": "YCH-000999", "dni": "00000000"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "Invalid credentials.")
        access.refresh_from_db()
        self.assertEqual(access.failed_login_count, 1)
        self.assertFalse(any("YCH-000999" in str(log.metadata) for log in AuditLog.objects.all()))

    def test_audit_log_is_append_only(self):
        log = AuditLog.objects.create(actor=self.user, action="test.action")
        log.action = "tamper"
        with self.assertRaises(ValueError):
            log.save()
        with self.assertRaises(ValueError):
            log.delete()

    def test_export_csv_uses_subject_id_only(self):
        self.login()
        patient = Patient.objects.create(subject_id="SUBJ-777", created_by=self.user)
        session = AssessmentSession.objects.create(patient=patient, clinician=self.user)
        AssessmentResult.objects.create(
            session=session,
            scale_id="SWLS",
            scale_label="SWLS",
            raw_value="20",
            max_value="35",
            percentile=57,
            severity="mid",
            payload={"private_note": "not exported"},
            created_by=self.user,
        )

        response = self.client.get("/api/export/csv/")
        self.assertEqual(response.status_code, 200)
        csv_text = response.content.decode("utf-8")
        self.assertIn("subject_id", csv_text)
        self.assertIn("SUBJ-777", csv_text)
        self.assertNotIn("Paciente", csv_text)
        self.assertNotIn("private_note", csv_text)

    def test_record_backup_command(self):
        call_command("record_backup", path="/backups/hitop_test.sql.enc", checksum="abc123", status="success")
        run = BackupRun.objects.get()
        self.assertEqual(run.destination_path, "/backups/hitop_test.sql.enc")
        self.assertEqual(run.checksum_sha256, "abc123")
        self.assertEqual(run.status, BackupRun.Status.SUCCESS)

    def test_research_enroll_creates_patient_access_consent_session_assignment(self):
        self.login()
        call_command("seed_local_setup")
        template = BatteryTemplate.objects.get(name="Research Intake Breve")

        response = self.client.post(
            "/api/research/enroll/",
            data=json.dumps(
                {
                    "hcl_code": "jaflo1",
                    "dni": "12345678",
                    "battery_template_id": template.id,
                    "administration_mode": "self_report",
                    "consent_status": "accepted",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Patient.objects.count(), 1)
        self.assertEqual(PatientPortalAccess.objects.count(), 1)
        self.assertEqual(ConsentRecord.objects.count(), 1)
        self.assertEqual(AssessmentSession.objects.count(), 1)
        self.assertEqual(BatteryAssignment.objects.count(), 1)
        self.assertEqual(response.json()["assignment"]["progress"]["total"], 6)

        login_response = self.client.post(
            "/api/patient/auth/login/",
            data=json.dumps({"hcl_code": "jaflo1", "dni": "12345678"}),
            content_type="application/json",
        )
        self.assertEqual(login_response.status_code, 200)

        assignments_response = self.client.get("/api/patient/assignments/")
        self.assertEqual(assignments_response.status_code, 200)
        self.assertEqual(len(assignments_response.json()["assignments"]), 1)

    def test_research_enroll_rejects_duplicate_hcl(self):
        self.login()
        call_command("seed_local_setup")
        template = BatteryTemplate.objects.get(name="Research Intake Breve")
        payload = {"hcl_code": "jaflo1", "dni": "12345678", "battery_template_id": template.id}
        first = self.client.post("/api/research/enroll/", data=json.dumps(payload), content_type="application/json")
        second = self.client.post("/api/research/enroll/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 409)

    def test_tablet_token_login_and_assignment_result_flow(self):
        self.login()
        call_command("seed_local_setup")
        template = BatteryTemplate.objects.get(name="Research Intake Breve")
        enroll = self.client.post(
            "/api/research/enroll/",
            data=json.dumps({"hcl_code": "tab1", "dni": "22223333", "battery_template_id": template.id}),
            content_type="application/json",
        )
        assignment_id = enroll.json()["assignment"]["id"]

        token_response = self.client.post(f"/api/research/assignments/{assignment_id}/tablet-token/", data="{}", content_type="application/json")
        self.assertEqual(token_response.status_code, 200)
        self.client.post("/api/auth/logout/")

        token_login = self.client.post(
            "/api/patient/auth/token-login/",
            data=json.dumps({"token": token_response.json()["token"]}),
            content_type="application/json",
        )
        self.assertEqual(token_login.status_code, 200)
        self.assertEqual(TabletAccessToken.objects.get().used_at is not None, True)

        result = self.client.post(
            f"/api/patient/assignments/{assignment_id}/results/",
            data=json.dumps(
                {
                    "scale_id": "ASRS-18",
                    "scale_label": "ASRS-18",
                    "raw_value": "9",
                    "max_value": "72",
                    "percentile": 13,
                    "severity": "low",
                    "payload": {"answers": [0, 1]},
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(result.status_code, 201)
        assignment = BatteryAssignment.objects.get()
        self.assertEqual(assignment.status, BatteryAssignment.Status.IN_PROGRESS)
        self.assertEqual(AssessmentResult.objects.get().assignment_id, assignment_id)

    def test_clinician_profile_and_export_are_pseudonymous(self):
        self.login()
        call_command("seed_local_setup")
        template = BatteryTemplate.objects.get(name="Research Intake Breve")
        enroll = self.client.post(
            "/api/research/enroll/",
            data=json.dumps({"hcl_code": "export1", "dni": "44445555", "battery_template_id": template.id}),
            content_type="application/json",
        )
        patient_id = enroll.json()["patient"]["id"]
        assignment_id = enroll.json()["assignment"]["id"]
        session_id = enroll.json()["assignment"]["session_id"]
        self.client.post(
            f"/api/clinician/sessions/{session_id}/results/",
            data=json.dumps(
                {
                    "assignment_id": assignment_id,
                    "scale_id": "SWLS",
                    "scale_label": "SWLS",
                    "raw_value": "20",
                    "max_value": "35",
                    "percentile": 57,
                    "severity": "mid",
                    "administration_mode": "interviewer_assisted",
                }
            ),
            content_type="application/json",
        )

        profile = self.client.get(f"/api/clinician/patients/{patient_id}/profile/")
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json()["results"][0]["administration_mode"], "interviewer_assisted")

        export = self.client.get("/api/clinician/export/csv/")
        text = export.content.decode("utf-8")
        self.assertIn("SUBJ-", text)
        self.assertNotIn("export1", text)
        self.assertNotIn("44445555", text)


@override_settings(CACHES=_TEST_CACHE)
class RateLimitTests(TestCase):
    """
    Tests de rate-limiting para los tres endpoints de autenticación.
    Se usa override_settings + cache.clear() en setUp para aislar cada test.
    """

    def setUp(self):
        cache.clear()
        # Paciente de prueba para los tests de patient_login
        self.user = get_user_model().objects.create_user(username="rl_staff", password="rl-safe-password")
        patient = Patient.objects.create(subject_id="SUBJ-RL", created_by=self.user)
        access = PatientPortalAccess(patient=patient, created_by=self.user)
        access.set_hcl_code("YCH-RL001")
        access.set_dni_password("rl123456")
        access.save()
        self.client = Client()

    def _patient_login(self, hcl_code="YCH-RL001", dni="rl123456"):
        return self.client.post(
            "/api/patient/auth/login/",
            data=json.dumps({"hcl_code": hcl_code, "dni": dni}),
            content_type="application/json",
        )

    def _staff_login(self, username="rl_staff", password="wrong"):
        return self.client.post(
            "/api/auth/login/",
            data=json.dumps({"username": username, "password": password}),
            content_type="application/json",
        )

    def _token_login(self, token="bad-token"):
        return self.client.post(
            "/api/patient/auth/token-login/",
            data=json.dumps({"token": token}),
            content_type="application/json",
        )

    # ------------------------------------------------------------------
    # (a) El 6º intento fallido de login paciente devuelve 429
    # ------------------------------------------------------------------
    def test_patient_login_sixth_attempt_returns_429(self):
        """Cinco fallos seguidos deben agotar el límite; el 6º retorna 429."""
        for i in range(5):
            resp = self._patient_login(hcl_code="YCH-RL001", dni="wrong_dni")
            self.assertEqual(resp.status_code, 401, f"Intento {i+1} debería ser 401")

        sixth = self._patient_login(hcl_code="YCH-RL001", dni="wrong_dni")
        self.assertEqual(sixth.status_code, 429)
        data = sixth.json()
        self.assertFalse(data["ok"])
        self.assertIn("Espera", data["error"])
        # Verificar que el evento de auditoría se registró
        self.assertTrue(AuditLog.objects.filter(action="auth.rate_limited").exists())

    # ------------------------------------------------------------------
    # (b) Login correcto tras 2 fallos funciona y resetea el contador
    # ------------------------------------------------------------------
    def test_patient_login_success_after_failures_resets_counter(self):
        """Dos fallos seguidos de un login correcto deben funcionar y limpiar el contador."""
        # Dos intentos fallidos
        self._patient_login(hcl_code="YCH-RL001", dni="wrong1")
        self._patient_login(hcl_code="YCH-RL001", dni="wrong2")

        # Login correcto
        resp = self._patient_login(hcl_code="YCH-RL001", dni="rl123456")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["ok"])

        # Después del login correcto los contadores deben estar limpios:
        # se pueden hacer 5 nuevos intentos fallidos sin bloqueo inmediato
        for i in range(5):
            r = self._patient_login(hcl_code="YCH-RL001", dni="wrong_again")
            self.assertEqual(r.status_code, 401, f"Tras reset, intento {i+1} debería ser 401, no bloqueado")

    # ------------------------------------------------------------------
    # (c) Rate limit del token-login
    # ------------------------------------------------------------------
    def test_token_login_rate_limited_after_threshold(self):
        """
        El endpoint de token-login aplica rate-limit por IP.
        El límite secundario es 20/15min; usamos tokens inválidos para agotar el
        contador y verificar que la respuesta cambia a 429.
        """
        # Agotamos los 20 intentos permitidos por IP
        for i in range(20):
            resp = self._token_login(token=f"invalid-token-{i}")
            self.assertEqual(resp.status_code, 401, f"Intento {i+1} debería ser 401")

        # El intento 21 debe estar bloqueado
        resp_blocked = self._token_login(token="invalid-token-extra")
        self.assertEqual(resp_blocked.status_code, 429)
        data = resp_blocked.json()
        self.assertFalse(data["ok"])
        self.assertIn("Espera", data["error"])
        self.assertTrue(AuditLog.objects.filter(action="auth.rate_limited", metadata__scope="token_login").exists())
