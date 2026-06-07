import csv
import json
from functools import wraps
from io import StringIO

from django.contrib.auth import authenticate, login, logout
from django.db import IntegrityError
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .audit import log_event
from .crypto import lookup_hash, normalize_lookup
from .models import AssessmentResult, AssessmentSession, AuditLog, BackupRun, Patient, PatientPortalAccess


PATIENT_SESSION_KEY = "patient_portal_access_id"


def api_login_required(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"ok": False, "error": "Authentication required."}, status=401)
        return view_func(request, *args, **kwargs)

    return wrapped


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
        "scale_id": result.scale_id,
        "scale_label": result.scale_label,
        "scoring_version": result.scoring_version,
        "raw_value": result.raw_value,
        "max_value": result.max_value,
        "percentile": result.percentile,
        "severity": result.severity,
        "payload": result.payload,
        "created_at": result.created_at.isoformat(),
    }


def patient_safe_payload(patient):
    return {
        "subject_id": patient.subject_id,
        "is_active": patient.is_active,
    }


@require_GET
def health(request):
    return JsonResponse({"ok": True, "service": "hitop-backend"})


@require_GET
@ensure_csrf_cookie
def patient_portal(request):
    return render(request, "clinical/patient_portal.html")


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
