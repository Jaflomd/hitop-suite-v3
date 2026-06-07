import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from .crypto import decrypt_json, encrypt_json


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Patient(TimestampedModel):
    subject_id = models.CharField(max_length=32, unique=True, db_index=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    def save(self, *args, **kwargs):
        if not self.subject_id:
            last_id = Patient.objects.count() + 1
            self.subject_id = f"SUBJ-{last_id:03d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return self.subject_id


class PatientIdentifier(TimestampedModel):
    patient = models.OneToOneField(Patient, related_name="identifier", on_delete=models.CASCADE)
    encrypted_payload = models.TextField(blank=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    def set_payload(self, payload):
        self.encrypted_payload = encrypt_json(payload)

    def get_payload(self):
        return decrypt_json(self.encrypted_payload)

    def __str__(self):
        return f"Identifier<{self.patient.subject_id}>"


class ScaleVersion(TimestampedModel):
    scale_id = models.CharField(max_length=64, db_index=True)
    version = models.CharField(max_length=64, default="local")
    label = models.CharField(max_length=160)
    source = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["scale_id", "version"], name="unique_scale_version"),
        ]

    def __str__(self):
        return f"{self.scale_id}@{self.version}"


class AssessmentSession(TimestampedModel):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        CLOSED = "closed", "Closed"

    session_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    patient = models.ForeignKey(Patient, related_name="sessions", on_delete=models.CASCADE)
    clinician = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    started_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(null=True, blank=True)

    def close(self):
        self.status = self.Status.CLOSED
        self.closed_at = timezone.now()
        self.save(update_fields=["status", "closed_at", "updated_at"])

    def __str__(self):
        return f"{self.patient.subject_id}/{self.session_id}"


class AssessmentResult(TimestampedModel):
    session = models.ForeignKey(AssessmentSession, related_name="results", on_delete=models.CASCADE)
    scale_id = models.CharField(max_length=64, db_index=True)
    scale_label = models.CharField(max_length=160)
    scoring_version = models.CharField(max_length=64, default="local-js")
    raw_value = models.CharField(max_length=64, blank=True)
    max_value = models.CharField(max_length=64, blank=True)
    percentile = models.IntegerField(null=True, blank=True)
    severity = models.CharField(max_length=32, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["session", "scale_id", "scoring_version"], name="unique_session_scale_result"),
        ]

    def __str__(self):
        return f"{self.session.patient.subject_id}/{self.scale_id}"


class AuditLog(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=96, db_index=True)
    entity_type = models.CharField(max_length=96, blank=True)
    entity_id = models.CharField(max_length=96, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValueError("AuditLog is append-only")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("AuditLog is append-only")

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M:%S} {self.action}"


class BackupRun(models.Model):
    class Status(models.TextChoices):
        STARTED = "started", "Started"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"

    run_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    started_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.STARTED)
    destination_path = models.TextField(blank=True)
    checksum_sha256 = models.CharField(max_length=128, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"{self.status}:{self.destination_path}"
