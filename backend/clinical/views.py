import csv
import json
from functools import wraps
from io import StringIO

from django.contrib.auth import authenticate, login, logout
from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .audit import log_event
from .batteries import DEFAULT_BATTERIES, SCALE_LABELS
from .crypto import lookup_hash, normalize_lookup
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
    TabletAccessToken,
)


PATIENT_SESSION_KEY = "patient_portal_access_id"


def api_login_required(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"ok": False, "error": "Authentication required."}, status=401)
        return view_func(request, *args, **kwargs)

    return wrapped


def user_has_role(user, roles):
    if not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return user.groups.filter(name__in=roles).exists()


def role_required(*roles):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped(request, *args, **kwargs):
            if not user_has_role(request.user, roles):
                return JsonResponse({"ok": False, "error": "Permission denied."}, status=403)
            return view_func(request, *args, **kwargs)

        return api_login_required(wrapped)

    return decorator


def patient_access_from_request(request):
    access_id = request.session.get(PATIENT_SESSION_KEY)
    if not access_id:
        return None
    return (
        PatientPortalAccess.objects.select_related("patient")
        .filter(pk=access_id, is_active=True, patient__is_active=True)
        .first()
    )


def patient_login_required(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        access = patient_access_from_request(request)
        if not access:
            return JsonResponse({"ok": False, "error": "Patient authentication required."}, status=401)
        request.patient_access = access
        return view_func(request, *args, **kwargs)

    return wrapped


def json_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return None


def bad_request(message, status=400):
    return JsonResponse({"ok": False, "error": message}, status=status)


def patient_payload(patient):
    return {
        "id": patient.id,
        "subject_id": patient.subject_id,
        "is_active": patient.is_active,
        "created_at": patient.created_at.isoformat(),
    }


def session_payload(session):
    return {
        "id": session.id,
        "session_id": str(session.session_id),
        "patient_id": session.patient_id,
        "subject_id": session.patient.subject_id,
        "status": session.status,
        "started_at": session.started_at.isoformat(),
        "closed_at": session.closed_at.isoformat() if session.closed_at else None,
    }


def result_payload(result):
    return {
        "id": result.id,
        "session_id": str(result.session.session_id),
        "assignment_id": result.assignment_id,
        "scale_id": result.scale_id,
        "scale_label": result.scale_label,
        "scoring_version": result.scoring_version,
        "raw_value": result.raw_value,
        "max_value": result.max_value,
        "percentile": result.percentile,
        "severity": result.severity,
        "administration_mode": result.administration_mode,
        "administered_by": result.administered_by.username if result.administered_by else None,
        "payload": result.payload,
        "created_at": result.created_at.isoformat(),
    }


def patient_safe_payload(patient):
    return {
        "id": patient.id,
        "subject_id": patient.subject_id,
        "is_active": patient.is_active,
    }


def template_payload(template):
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "is_active": template.is_active,
        "scales": [
            {
                "scale_id": scale.scale_id,
                "scale_label": scale.scale_label,
                "order": scale.order,
                "required": scale.required,
                "role_visible_to": scale.role_visible_to,
            }
            for scale in template.scales.order_by("order")
        ],
    }


def assignment_progress(assignment):
    scales = list(assignment.template.scales.order_by("order"))
    done_ids = set(assignment.results.values_list("scale_id", flat=True))
    total = len([s for s in scales if s.required])
    done = len([s for s in scales if s.required and s.scale_id in done_ids])
    return {
        "done": done,
        "total": total,
        "percent": round(done / total * 100) if total else 0,
        "pending": [s.scale_id for s in scales if s.required and s.scale_id not in done_ids],
    }


def assignment_payload(assignment, include_scales=True):
    progress = assignment_progress(assignment)
    return {
        "id": assignment.id,
        "patient_id": assignment.patient_id,
        "subject_id": assignment.patient.subject_id,
        "session_id": str(assignment.session.session_id),
        "template_id": assignment.template_id,
        "template_name": assignment.template.name,
        "status": assignment.status,
        "administration_mode": assignment.administration_mode,
        "assigned_at": assignment.assigned_at.isoformat(),
        "due_at": assignment.due_at.isoformat() if assignment.due_at else None,
        "progress": progress,
        "scales": template_payload(assignment.template)["scales"] if include_scales else [],
    }


def ensure_default_batteries():
    for name, spec in DEFAULT_BATTERIES.items():
        template, _ = BatteryTemplate.objects.update_or_create(
            name=name,
            defaults={"description": spec["description"], "is_active": True},
        )
        for order, scale_id in enumerate(spec["scales"], start=1):
            BatteryTemplateScale.objects.update_or_create(
                template=template,
                scale_id=scale_id,
                defaults={
                    "scale_label": SCALE_LABELS.get(scale_id, scale_id),
                    "order": order,
                    "required": True,
                    "role_visible_to": BatteryTemplateScale.RoleVisibleTo.ALL,
                },
            )
    return BatteryTemplate.objects.filter(is_active=True).order_by("name")


def patient_hcl_hint(patient):
    try:
        return patient.portal_access.hcl_code_hint
    except PatientPortalAccess.DoesNotExist:
        return ""


@require_GET
def health(request):
    return JsonResponse({"ok": True, "service": "hitop-backend"})


@require_GET
@ensure_csrf_cookie
def patient_portal(request):
    return render(request, "clinical/patient_portal.html")


@require_GET
@ensure_csrf_cookie
def research_portal(request):
    return render(request, "clinical/research_portal.html")


@require_GET
@ensure_csrf_cookie
def clinician_portal(request):
    return render(request, "clinical/clinician_portal.html")


@require_GET
@ensure_csrf_cookie
def csrf(request):
    return JsonResponse({"ok": True, "csrfToken": get_token(request)})


@require_POST
def login_view(request):
    body = json_body(request)
    if body is None:
        return bad_request("Invalid JSON.")
    username = body.get("username", "")
    password = body.get("password", "")
    user = authenticate(request, username=username, password=password)
    if not user:
        log_event(request, "auth.login_failed", metadata={"username": username})
        return bad_request("Invalid credentials.", status=401)
    login(request, user)
    log_event(request, "auth.login", metadata={"username": username})
    return JsonResponse({"ok": True, "user": {"id": user.id, "username": user.username}})


@require_POST
@api_login_required
def logout_view(request):
    log_event(request, "auth.logout")
    logout(request)
    return JsonResponse({"ok": True})


@require_GET
def me(request):
    user = request.user
    if not user.is_authenticated:
        return JsonResponse({"ok": True, "authenticated": False})
    return JsonResponse({"ok": True, "authenticated": True, "user": {"id": user.id, "username": user.username}})


@require_POST
def patient_login_view(request):
    body = json_body(request)
    if body is None:
        return bad_request("Invalid JSON.")

    hcl_code = body.get("hcl_code", "")
    dni = body.get("dni", "")
    hcl_hint = normalize_lookup(hcl_code)[-4:]
    if not hcl_code or not dni:
        return bad_request("Codigo HCL/Yachay and DNI are required.")

    access = (
        PatientPortalAccess.objects.select_related("patient")
        .filter(hcl_code_hash=lookup_hash(hcl_code, "patient-hcl"), is_active=True, patient__is_active=True)
        .first()
    )
    if not access:
        log_event(request, "patient_auth.login_failed", metadata={"hcl_hint": hcl_hint, "reason": "unknown_code"})
        return bad_request("Invalid credentials.", status=401)
    if not access.check_dni_password(dni):
        access.mark_login_failed()
        log_event(request, "patient_auth.login_failed", entity=access.patient, metadata={"hcl_hint": hcl_hint, "reason": "bad_secret"})
        return bad_request("Invalid credentials.", status=401)

    request.session[PATIENT_SESSION_KEY] = access.pk
    request.session.modified = True
    access.mark_login_success()
    log_event(request, "patient_auth.login", entity=access.patient, metadata={"hcl_hint": access.hcl_code_hint})
    return JsonResponse({"ok": True, "patient": patient_safe_payload(access.patient)})


@require_POST
@patient_login_required
def patient_logout_view(request):
    log_event(request, "patient_auth.logout", entity=request.patient_access.patient)
    request.session.pop(PATIENT_SESSION_KEY, None)
    request.session.modified = True
    return JsonResponse({"ok": True})


@require_GET
def patient_me(request):
    access = patient_access_from_request(request)
    if not access:
        return JsonResponse({"ok": True, "authenticated": False})
    return JsonResponse({"ok": True, "authenticated": True, "patient": patient_safe_payload(access.patient)})


@require_POST
def patient_token_login_view(request):
    body = json_body(request)
    if body is None:
        return bad_request("Invalid JSON.")
    token = body.get("token") or request.GET.get("token")
    if not token:
        return bad_request("token is required.")
    tablet = TabletAccessToken.find_valid(token)
    if not tablet:
        log_event(request, "patient_auth.token_failed", metadata={"reason": "invalid_or_expired"})
        return bad_request("Invalid token.", status=401)
    tablet.mark_used()
    request.session["tablet_assignment_id"] = tablet.assignment_id
    try:
        request.session[PATIENT_SESSION_KEY] = tablet.assignment.patient.portal_access.pk
    except PatientPortalAccess.DoesNotExist:
        request.session.pop(PATIENT_SESSION_KEY, None)
    request.session.modified = True
    log_event(request, "patient_auth.token_login", entity=tablet.assignment.patient, metadata={"assignment_id": tablet.assignment_id})
    return JsonResponse({"ok": True, "patient": patient_safe_payload(tablet.assignment.patient), "assignment": assignment_payload(tablet.assignment)})


def current_patient_assignments(request):
    tablet_assignment_id = request.session.get("tablet_assignment_id")
    if tablet_assignment_id:
        qs = BatteryAssignment.objects.select_related("patient", "session", "template").filter(pk=tablet_assignment_id)
        return qs
    access = patient_access_from_request(request)
    if not access:
        return BatteryAssignment.objects.none()
    return BatteryAssignment.objects.select_related("patient", "session", "template").filter(patient=access.patient).exclude(status=BatteryAssignment.Status.CANCELLED)


@require_GET
def patient_assignments(request):
    qs = current_patient_assignments(request)
    if not qs.exists():
        return JsonResponse({"ok": False, "error": "Patient authentication required."}, status=401)
    return JsonResponse({"ok": True, "assignments": [assignment_payload(a) for a in qs.order_by("-assigned_at")]})


@require_GET
def patient_assignment_next(request, assignment_id):
    assignment = get_object_or_404(current_patient_assignments(request), pk=assignment_id)
    progress = assignment_progress(assignment)
    next_scale_id = progress["pending"][0] if progress["pending"] else None
    scale = assignment.template.scales.filter(scale_id=next_scale_id).first() if next_scale_id else None
    return JsonResponse(
        {
            "ok": True,
            "assignment": assignment_payload(assignment),
            "next_scale": {
                "scale_id": scale.scale_id,
                "scale_label": scale.scale_label,
            }
            if scale
            else None,
        }
    )


def save_result_for_assignment(request, assignment, body, actor=None):
    if assignment.status == BatteryAssignment.Status.CANCELLED:
        return None, bad_request("Assignment is cancelled.", status=409)
    if assignment.session.status != AssessmentSession.Status.OPEN:
        return None, bad_request("Session is closed.", status=409)
    if not body.get("scale_id") or not body.get("scale_label"):
        return None, bad_request("scale_id and scale_label are required.")

    mode = body.get("administration_mode") or assignment.administration_mode
    result, created = AssessmentResult.objects.update_or_create(
        session=assignment.session,
        assignment=assignment,
        scale_id=body["scale_id"],
        scoring_version=body.get("scoring_version", "webapp-js"),
        defaults={
            "scale_label": body["scale_label"],
            "raw_value": str(body.get("raw_value", "")),
            "max_value": str(body.get("max_value", "")),
            "percentile": body.get("percentile"),
            "severity": body.get("severity", ""),
            "payload": body.get("payload") or {},
            "administration_mode": mode,
            "administered_by": actor if mode != AssessmentSession.AdministrationMode.SELF_REPORT else None,
            "created_by": actor,
        },
    )
    assignment.refresh_status()
    log_event(
        request,
        "assignment_result.create" if created else "assignment_result.update",
        entity=result,
        metadata={"subject_id": assignment.patient.subject_id, "scale_id": result.scale_id, "assignment_id": assignment.id, "mode": mode},
    )
    return result, None


@require_http_methods(["GET", "POST"])
def patient_assignment_results(request, assignment_id):
    assignment = get_object_or_404(current_patient_assignments(request), pk=assignment_id)
    if request.method == "GET":
        qs = assignment.results.select_related("session").order_by("scale_id")
        return JsonResponse({"ok": True, "results": [result_payload(r) for r in qs]})

    body = json_body(request)
    if body is None:
        return bad_request("Invalid JSON.")
    result, error = save_result_for_assignment(request, assignment, body, actor=None)
    if error:
        return error
    return JsonResponse({"ok": True, "result": result_payload(result), "assignment": assignment_payload(assignment)}, status=201)


@require_GET
@role_required("research_assistant", "clinician", "admin")
def research_templates(request):
    qs = ensure_default_batteries()
    return JsonResponse({"ok": True, "templates": [template_payload(t) for t in qs]})


def create_assignment(patient, template, user, mode, source=AssessmentSession.Source.RESEARCH_INTAKE):
    session = AssessmentSession.objects.create(
        patient=patient,
        clinician=user if user and user.is_authenticated else None,
        source=source,
        administration_mode=mode,
        administered_by=user if mode != AssessmentSession.AdministrationMode.SELF_REPORT else None,
    )
    return BatteryAssignment.objects.create(
        patient=patient,
        session=session,
        template=template,
        assigned_by=user if user and user.is_authenticated else None,
        administration_mode=mode,
    )


@require_POST
@role_required("research_assistant", "clinician", "admin")
def research_enroll(request):
    body = json_body(request)
    if body is None:
        return bad_request("Invalid JSON.")
    hcl_code = body.get("hcl_code", "")
    dni = body.get("dni", "")
    if not hcl_code or not dni:
        return bad_request("hcl_code and dni are required.")

    ensure_default_batteries()
    template_id = body.get("battery_template_id")
    template_name = body.get("battery_template_name") or "Research Intake Breve"
    template = BatteryTemplate.objects.filter(pk=template_id, is_active=True).first() if template_id else None
    if template is None:
        template = get_object_or_404(BatteryTemplate, name=template_name, is_active=True)

    hcl_hash = lookup_hash(hcl_code, "patient-hcl")
    if PatientPortalAccess.objects.filter(hcl_code_hash=hcl_hash).exists():
        return bad_request("hcl_code already exists.", status=409)

    mode = body.get("administration_mode") or AssessmentSession.AdministrationMode.SELF_REPORT
    consent_type = body.get("consent_type") or ConsentRecord.ConsentType.RESEARCH
    consent_status = body.get("consent_status") or ConsentRecord.Status.ACCEPTED

    with transaction.atomic():
        patient = Patient.objects.create(subject_id=(body.get("subject_id") or "").strip(), created_by=request.user)
        access = PatientPortalAccess(patient=patient, created_by=request.user, is_active=True)
        access.set_hcl_code(hcl_code)
        access.set_dni_password(dni)
        access.save()
        identifier = PatientIdentifier(patient=patient, updated_by=request.user)
        identifier.set_payload({"hcl_hint": access.hcl_code_hint})
        identifier.save()
        consent = ConsentRecord.objects.create(
            patient=patient,
            consent_type=consent_type,
            status=consent_status,
            recorded_by=request.user,
            notes=body.get("consent_notes", ""),
        )
        assignment = create_assignment(patient, template, request.user, mode)

    log_event(request, "research.enroll", entity=patient, metadata={"subject_id": patient.subject_id, "hcl_hint": access.hcl_code_hint, "assignment_id": assignment.id})
    log_event(request, "consent.record", entity=consent, metadata={"subject_id": patient.subject_id, "status": consent.status})
    return JsonResponse(
        {
            "ok": True,
            "patient": patient_payload(patient),
            "access": {"hcl_hint": access.hcl_code_hint, "is_active": access.is_active},
            "assignment": assignment_payload(assignment),
        },
        status=201,
    )


@require_GET
@role_required("research_assistant", "clinician", "admin")
def research_patients(request):
    ensure_default_batteries()
    q = request.GET.get("q", "").strip()
    status = request.GET.get("status", "").strip()
    qs = Patient.objects.filter(is_active=True).order_by("-created_at")
    if q:
        access = PatientPortalAccess.objects.filter(hcl_code_hash=lookup_hash(q, "patient-hcl")).first()
        qs = qs.filter(pk=access.patient_id) if access else qs.none()
    if status:
        qs = qs.filter(battery_assignments__status=status).distinct()
    rows = []
    for patient in qs.select_related("portal_access")[:200]:
        assignment = patient.battery_assignments.select_related("template", "session").order_by("-assigned_at").first()
        rows.append(
            {
                "patient": patient_payload(patient),
                "hcl_hint": patient_hcl_hint(patient),
                "assignment": assignment_payload(assignment, include_scales=False) if assignment else None,
            }
        )
    return JsonResponse({"ok": True, "patients": rows})


@require_POST
@role_required("research_assistant", "clinician", "admin")
def research_assign_patient(request, patient_id):
    body = json_body(request)
    if body is None:
        return bad_request("Invalid JSON.")
    ensure_default_batteries()
    patient = get_object_or_404(Patient, pk=patient_id, is_active=True)
    template = get_object_or_404(BatteryTemplate, pk=body.get("battery_template_id"), is_active=True)
    mode = body.get("administration_mode") or AssessmentSession.AdministrationMode.SELF_REPORT
    assignment = create_assignment(patient, template, request.user, mode)
    log_event(request, "assignment.create", entity=assignment, metadata={"subject_id": patient.subject_id, "template": template.name})
    return JsonResponse({"ok": True, "assignment": assignment_payload(assignment)}, status=201)


@require_POST
@role_required("research_assistant", "clinician", "admin")
def research_tablet_token(request, assignment_id):
    assignment = get_object_or_404(BatteryAssignment.objects.select_related("patient", "session", "template"), pk=assignment_id)
    token, tablet = TabletAccessToken.create_for_assignment(assignment, created_by=request.user)
    url = request.build_absolute_uri(f"/paciente/?token={token}")
    log_event(request, "tablet_token.create", entity=assignment, metadata={"subject_id": assignment.patient.subject_id, "expires_at": tablet.expires_at.isoformat()})
    return JsonResponse({"ok": True, "token": token, "url": url, "expires_at": tablet.expires_at.isoformat()})


@require_GET
@role_required("research_assistant", "clinician", "admin")
def research_assignment_progress(request, assignment_id):
    assignment = get_object_or_404(BatteryAssignment.objects.select_related("patient", "session", "template"), pk=assignment_id)
    return JsonResponse({"ok": True, "assignment": assignment_payload(assignment), "results": [result_payload(r) for r in assignment.results.order_by("scale_id")]})


@require_GET
@role_required("clinician", "admin")
def clinician_patients(request):
    status = request.GET.get("status", "").strip()
    q = request.GET.get("q", "").strip()
    qs = Patient.objects.filter(is_active=True).order_by("-updated_at")
    if q:
        qs = qs.filter(subject_id__icontains=q)
    if status:
        qs = qs.filter(battery_assignments__status=status).distinct()
    rows = []
    for patient in qs[:200]:
        assignments = list(patient.battery_assignments.select_related("template", "session").order_by("-assigned_at")[:3])
        latest = assignments[0] if assignments else None
        rows.append(
            {
                "patient": patient_payload(patient),
                "latest_assignment": assignment_payload(latest, include_scales=False) if latest else None,
                "assignment_count": patient.battery_assignments.count(),
                "result_count": AssessmentResult.objects.filter(session__patient=patient).count(),
            }
        )
    return JsonResponse({"ok": True, "patients": rows})


@require_GET
@role_required("clinician", "admin")
def clinician_patient_profile(request, patient_id):
    patient = get_object_or_404(Patient, pk=patient_id, is_active=True)
    assignments = patient.battery_assignments.select_related("template", "session").order_by("-assigned_at")
    sessions_qs = patient.sessions.order_by("-started_at")
    results_qs = AssessmentResult.objects.select_related("session", "assignment", "administered_by").filter(session__patient=patient).order_by("-created_at")
    latest_by_scale = {}
    for result in results_qs:
        latest_by_scale.setdefault(result.scale_id, result_payload(result))
    log_event(request, "clinician.profile_view", entity=patient, metadata={"subject_id": patient.subject_id})
    return JsonResponse(
        {
            "ok": True,
            "patient": patient_payload(patient),
            "assignments": [assignment_payload(a) for a in assignments],
            "sessions": [session_payload(s) for s in sessions_qs],
            "results": [result_payload(r) for r in results_qs],
            "profile": {"latest_by_scale": latest_by_scale},
        }
    )


@require_http_methods(["GET", "POST"])
@role_required("clinician", "admin")
def clinician_patient_sessions(request, patient_id):
    patient = get_object_or_404(Patient, pk=patient_id, is_active=True)
    if request.method == "GET":
        return JsonResponse({"ok": True, "sessions": [session_payload(s) for s in patient.sessions.order_by("-started_at")]})
    body = json_body(request) or {}
    session = AssessmentSession.objects.create(
        patient=patient,
        clinician=request.user,
        source=AssessmentSession.Source.CLINICIAN_DASHBOARD,
        administration_mode=body.get("administration_mode") or AssessmentSession.AdministrationMode.CLINICIAN_ADMINISTERED,
        administered_by=request.user,
    )
    log_event(request, "clinician_session.create", entity=session, metadata={"subject_id": patient.subject_id})
    return JsonResponse({"ok": True, "session": session_payload(session)}, status=201)


@require_POST
@role_required("clinician", "admin")
def clinician_session_result(request, session_id):
    session = get_object_or_404(AssessmentSession.objects.select_related("patient"), session_id=session_id)
    body = json_body(request)
    if body is None:
        return bad_request("Invalid JSON.")
    if not body.get("scale_id") or not body.get("scale_label"):
        return bad_request("scale_id and scale_label are required.")
    assignment = BatteryAssignment.objects.filter(pk=body.get("assignment_id"), session=session).first() if body.get("assignment_id") else None
    mode = body.get("administration_mode") or AssessmentSession.AdministrationMode.CLINICIAN_ADMINISTERED
    result, created = AssessmentResult.objects.update_or_create(
        session=session,
        assignment=assignment,
        scale_id=body["scale_id"],
        scoring_version=body.get("scoring_version", "clinician-webapp-js"),
        defaults={
            "scale_label": body["scale_label"],
            "raw_value": str(body.get("raw_value", "")),
            "max_value": str(body.get("max_value", "")),
            "percentile": body.get("percentile"),
            "severity": body.get("severity", ""),
            "payload": body.get("payload") or {},
            "administration_mode": mode,
            "administered_by": request.user,
            "created_by": request.user,
        },
    )
    if assignment:
        assignment.refresh_status()
    log_event(request, "clinician_result.create" if created else "clinician_result.update", entity=result, metadata={"subject_id": session.patient.subject_id, "scale_id": result.scale_id})
    return JsonResponse({"ok": True, "result": result_payload(result)}, status=201 if created else 200)


@require_GET
@role_required("clinician", "admin")
def clinician_export_csv(request):
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["subject_id", "session_id", "assignment_id", "scale_id", "scale_label", "raw_value", "max_value", "percentile", "severity", "administration_mode", "administered_by", "created_at"])
    qs = AssessmentResult.objects.select_related("session__patient", "administered_by").order_by("session__patient__subject_id", "session__started_at", "scale_id")
    for result in qs:
        writer.writerow(
            [
                result.session.patient.subject_id,
                result.session.session_id,
                result.assignment_id or "",
                result.scale_id,
                result.scale_label,
                result.raw_value,
                result.max_value,
                result.percentile if result.percentile is not None else "",
                result.severity,
                result.administration_mode,
                result.administered_by.username if result.administered_by else "",
                result.created_at.isoformat(),
            ]
        )
    log_event(request, "clinician.export.csv", metadata={"rows": qs.count()})
    response = HttpResponse(output.getvalue(), content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="hitop_dimensional_export.csv"'
    return response


@require_http_methods(["GET", "POST"])
@patient_login_required
def patient_sessions(request):
    patient = request.patient_access.patient
    if request.method == "GET":
        qs = patient.sessions.select_related("patient").order_by("-started_at")
        return JsonResponse({"ok": True, "sessions": [session_payload(s) for s in qs]})

    body = json_body(request) or {}
    session = None
    if not body.get("force_new"):
        session = patient.sessions.filter(status=AssessmentSession.Status.OPEN).order_by("-started_at").first()
    if session is None:
        session = AssessmentSession.objects.create(patient=patient, clinician=None)
        log_event(request, "patient_session.create", entity=session, metadata={"subject_id": patient.subject_id})
    else:
        log_event(request, "patient_session.resume", entity=session, metadata={"subject_id": patient.subject_id})
    return JsonResponse({"ok": True, "session": session_payload(session)}, status=201)


@require_http_methods(["GET", "POST"])
@patient_login_required
def patient_results(request, session_id):
    session = get_object_or_404(
        AssessmentSession.objects.select_related("patient"),
        session_id=session_id,
        patient=request.patient_access.patient,
    )
    if request.method == "GET":
        qs = session.results.order_by("scale_id")
        return JsonResponse({"ok": True, "results": [result_payload(r) for r in qs]})
    if session.status != AssessmentSession.Status.OPEN:
        return bad_request("Session is closed.", status=409)

    body = json_body(request)
    if body is None:
        return bad_request("Invalid JSON.")
    required = ["scale_id", "scale_label"]
    if any(not body.get(k) for k in required):
        return bad_request("scale_id and scale_label are required.")

    result, created = AssessmentResult.objects.update_or_create(
        session=session,
        scale_id=body["scale_id"],
        scoring_version=body.get("scoring_version", "patient-js"),
        defaults={
            "scale_label": body["scale_label"],
            "raw_value": str(body.get("raw_value", "")),
            "max_value": str(body.get("max_value", "")),
            "percentile": body.get("percentile"),
            "severity": body.get("severity", ""),
            "payload": body.get("payload") or {},
            "created_by": None,
        },
    )
    log_event(
        request,
        "patient_result.create" if created else "patient_result.update",
        entity=result,
        metadata={"subject_id": session.patient.subject_id, "scale_id": result.scale_id},
    )
    return JsonResponse({"ok": True, "result": result_payload(result)}, status=201 if created else 200)


@require_http_methods(["GET", "POST"])
@api_login_required
def patients(request):
    if request.method == "GET":
        qs = Patient.objects.filter(is_active=True).order_by("subject_id")
        return JsonResponse({"ok": True, "patients": [patient_payload(p) for p in qs]})

    body = json_body(request)
    if body is None:
        return bad_request("Invalid JSON.")
    subject_id = (body.get("subject_id") or "").strip()
    patient = Patient(subject_id=subject_id, created_by=request.user)
    try:
        patient.save()
    except IntegrityError:
        return bad_request("subject_id already exists.", status=409)
    log_event(request, "patient.create", entity=patient)
    return JsonResponse({"ok": True, "patient": patient_payload(patient)}, status=201)


@require_http_methods(["GET", "POST"])
@api_login_required
def sessions(request, patient_id):
    patient = get_object_or_404(Patient, pk=patient_id, is_active=True)
    if request.method == "GET":
        qs = patient.sessions.select_related("patient").order_by("-started_at")
        return JsonResponse({"ok": True, "sessions": [session_payload(s) for s in qs]})

    session = AssessmentSession.objects.create(patient=patient, clinician=request.user)
    log_event(request, "session.create", entity=session, metadata={"subject_id": patient.subject_id})
    return JsonResponse({"ok": True, "session": session_payload(session)}, status=201)


@require_POST
@api_login_required
def close_session(request, session_id):
    session = get_object_or_404(AssessmentSession.objects.select_related("patient"), session_id=session_id)
    session.close()
    log_event(request, "session.close", entity=session, metadata={"subject_id": session.patient.subject_id})
    return JsonResponse({"ok": True, "session": session_payload(session)})


@require_http_methods(["GET", "POST"])
@api_login_required
def results(request, session_id):
    session = get_object_or_404(AssessmentSession.objects.select_related("patient"), session_id=session_id)
    if request.method == "GET":
        qs = session.results.order_by("scale_id")
        return JsonResponse({"ok": True, "results": [result_payload(r) for r in qs]})

    body = json_body(request)
    if body is None:
        return bad_request("Invalid JSON.")
    required = ["scale_id", "scale_label"]
    if any(not body.get(k) for k in required):
        return bad_request("scale_id and scale_label are required.")

    result, created = AssessmentResult.objects.update_or_create(
        session=session,
        scale_id=body["scale_id"],
        scoring_version=body.get("scoring_version", "local-js"),
        defaults={
            "scale_label": body["scale_label"],
            "raw_value": str(body.get("raw_value", "")),
            "max_value": str(body.get("max_value", "")),
            "percentile": body.get("percentile"),
            "severity": body.get("severity", ""),
            "payload": body.get("payload") or {},
            "created_by": request.user,
        },
    )
    log_event(
        request,
        "result.create" if created else "result.update",
        entity=result,
        metadata={"subject_id": session.patient.subject_id, "scale_id": result.scale_id},
    )
    return JsonResponse({"ok": True, "result": result_payload(result)}, status=201 if created else 200)


@require_GET
@api_login_required
def audit_logs(request):
    logs = AuditLog.objects.select_related("actor").order_by("-created_at")[:200]
    return JsonResponse(
        {
            "ok": True,
            "audit_logs": [
                {
                    "created_at": log.created_at.isoformat(),
                    "actor": log.actor.username if log.actor else None,
                    "action": log.action,
                    "entity_type": log.entity_type,
                    "entity_id": log.entity_id,
                    "metadata": log.metadata,
                }
                for log in logs
            ],
        }
    )


@require_GET
@api_login_required
def backup_runs(request):
    runs = BackupRun.objects.order_by("-started_at")[:100]
    return JsonResponse(
        {
            "ok": True,
            "backup_runs": [
                {
                    "run_id": str(run.run_id),
                    "status": run.status,
                    "destination_path": run.destination_path,
                    "checksum_sha256": run.checksum_sha256,
                    "started_at": run.started_at.isoformat(),
                    "finished_at": run.finished_at.isoformat() if run.finished_at else None,
                }
                for run in runs
            ],
        }
    )


@require_GET
@api_login_required
def export_csv(request):
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["subject_id", "session_id", "scale_id", "scale_label", "raw_value", "max_value", "percentile", "severity", "created_at"])
    qs = AssessmentResult.objects.select_related("session__patient").order_by("session__patient__subject_id", "session__started_at", "scale_id")
    for result in qs:
        writer.writerow(
            [
                result.session.patient.subject_id,
                result.session.session_id,
                result.scale_id,
                result.scale_label,
                result.raw_value,
                result.max_value,
                result.percentile if result.percentile is not None else "",
                result.severity,
                result.created_at.isoformat(),
            ]
        )
    log_event(request, "export.csv", metadata={"rows": qs.count()})
    response = HttpResponse(output.getvalue(), content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="hitop_export_backend.csv"'
    return response
