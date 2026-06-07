import json

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import Client, TestCase

from .models import AssessmentResult, AssessmentSession, AuditLog, BackupRun, Patient, PatientIdentifier


class ClinicalBackendTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="clinician", password="safe-test-password")
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
