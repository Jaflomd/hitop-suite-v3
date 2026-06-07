from django.contrib import admin
from django import forms

from .models import (
    AssessmentResult,
    AssessmentSession,
    AuditLog,
    BackupRun,
    BatteryAssignment,
    BatteryTemplate,
    BatteryTemplateScale,
    ConsentRecord,
    Patient,
    PatientIdentifier,
    PatientPortalAccess,
    ScaleVersion,
    TabletAccessToken,
)


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = ("subject_id", "is_active", "created_by", "created_at")
    search_fields = ("subject_id",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(PatientIdentifier)
class PatientIdentifierAdmin(admin.ModelAdmin):
    list_display = ("patient", "updated_by", "updated_at")
    readonly_fields = ("created_at", "updated_at")


class PatientPortalAccessForm(forms.ModelForm):
    hcl_code = forms.CharField(label="Codigo HCL/Yachay", required=False)
    dni = forms.CharField(label="DNI inicial", required=False, widget=forms.PasswordInput(render_value=False))

    class Meta:
        model = PatientPortalAccess
        fields = ("patient", "is_active", "hcl_code", "dni")

    def clean(self):
        cleaned = super().clean()
        if not self.instance.pk:
            if not cleaned.get("hcl_code"):
                self.add_error("hcl_code", "Requerido para crear el acceso.")
            if not cleaned.get("dni"):
                self.add_error("dni", "Requerido para crear el acceso.")
        return cleaned

    def save(self, commit=True):
        obj = super().save(commit=False)
        if self.cleaned_data.get("hcl_code"):
            obj.set_hcl_code(self.cleaned_data["hcl_code"])
        if self.cleaned_data.get("dni"):
            obj.set_dni_password(self.cleaned_data["dni"])
        if commit:
            obj.save()
            self.save_m2m()
        return obj


@admin.register(PatientPortalAccess)
class PatientPortalAccessAdmin(admin.ModelAdmin):
    form = PatientPortalAccessForm
    list_display = ("patient", "hcl_code_hint", "is_active", "last_login_at", "failed_login_count", "created_by", "updated_at")
    search_fields = ("patient__subject_id", "hcl_code_hint")
    readonly_fields = ("hcl_code_hint", "last_login_at", "failed_login_count", "created_at", "updated_at")

    def save_model(self, request, obj, form, change):
        if not obj.created_by_id:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(ScaleVersion)
class ScaleVersionAdmin(admin.ModelAdmin):
    list_display = ("scale_id", "version", "label", "is_active")
    search_fields = ("scale_id", "label")


class BatteryTemplateScaleInline(admin.TabularInline):
    model = BatteryTemplateScale
    extra = 0
    ordering = ("order",)


@admin.register(BatteryTemplate)
class BatteryTemplateAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active", "created_by", "created_at")
    search_fields = ("name", "description")
    inlines = [BatteryTemplateScaleInline]


@admin.register(BatteryAssignment)
class BatteryAssignmentAdmin(admin.ModelAdmin):
    list_display = ("patient", "template", "status", "administration_mode", "assigned_by", "assigned_at", "due_at")
    search_fields = ("patient__subject_id", "template__name")
    list_filter = ("status", "administration_mode", "template")


@admin.register(ConsentRecord)
class ConsentRecordAdmin(admin.ModelAdmin):
    list_display = ("patient", "consent_type", "status", "recorded_by", "recorded_at")
    search_fields = ("patient__subject_id", "notes")
    list_filter = ("consent_type", "status")


@admin.register(AssessmentSession)
class AssessmentSessionAdmin(admin.ModelAdmin):
    list_display = ("session_id", "patient", "clinician", "status", "source", "administration_mode", "started_at", "closed_at")
    search_fields = ("session_id", "patient__subject_id")
    list_filter = ("status", "source", "administration_mode")


@admin.register(AssessmentResult)
class AssessmentResultAdmin(admin.ModelAdmin):
    list_display = ("session", "assignment", "scale_id", "raw_value", "max_value", "percentile", "severity", "administration_mode", "created_at")
    search_fields = ("scale_id", "session__patient__subject_id")
    list_filter = ("administration_mode", "severity")


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


@admin.register(TabletAccessToken)
class TabletAccessTokenAdmin(admin.ModelAdmin):
    list_display = ("assignment", "expires_at", "used_at", "is_active", "created_by", "created_at")
    search_fields = ("assignment__patient__subject_id", "assignment__template__name")
    list_filter = ("is_active",)
    readonly_fields = ("token_hash", "created_at", "updated_at")
