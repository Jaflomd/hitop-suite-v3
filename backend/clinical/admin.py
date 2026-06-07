from django.contrib import admin

from .models import AssessmentResult, AssessmentSession, AuditLog, BackupRun, Patient, PatientIdentifier, ScaleVersion


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = ("subject_id", "is_active", "created_by", "created_at")
    search_fields = ("subject_id",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(PatientIdentifier)
class PatientIdentifierAdmin(admin.ModelAdmin):
    list_display = ("patient", "updated_by", "updated_at")
    readonly_fields = ("created_at", "updated_at")


@admin.register(ScaleVersion)
class ScaleVersionAdmin(admin.ModelAdmin):
    list_display = ("scale_id", "version", "label", "is_active")
    search_fields = ("scale_id", "label")


@admin.register(AssessmentSession)
class AssessmentSessionAdmin(admin.ModelAdmin):
    list_display = ("session_id", "patient", "clinician", "status", "started_at", "closed_at")
    search_fields = ("session_id", "patient__subject_id")


@admin.register(AssessmentResult)
class AssessmentResultAdmin(admin.ModelAdmin):
    list_display = ("session", "scale_id", "raw_value", "max_value", "percentile", "severity", "created_at")
    search_fields = ("scale_id", "session__patient__subject_id")


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "action", "entity_type", "entity_id", "ip_address")
    search_fields = ("action", "entity_type", "entity_id", "actor__username")
    readonly_fields = ("actor", "action", "entity_type", "entity_id", "ip_address", "user_agent", "metadata", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(BackupRun)
class BackupRunAdmin(admin.ModelAdmin):
    list_display = ("started_at", "finished_at", "status", "destination_path", "checksum_sha256")
    search_fields = ("destination_path", "checksum_sha256")
