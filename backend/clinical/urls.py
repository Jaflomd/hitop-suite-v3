from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("auth/csrf/", views.csrf, name="csrf"),
    path("auth/login/", views.login_view, name="login"),
    path("auth/logout/", views.logout_view, name="logout"),
    path("auth/me/", views.me, name="me"),
    path("patient/auth/login/", views.patient_login_view, name="patient_login"),
    path("patient/auth/logout/", views.patient_logout_view, name="patient_logout"),
    path("patient/auth/me/", views.patient_me, name="patient_me"),
    path("patient/sessions/", views.patient_sessions, name="patient_sessions"),
    path("patient/sessions/<uuid:session_id>/results/", views.patient_results, name="patient_results"),
    path("patients/", views.patients, name="patients"),
    path("patients/<int:patient_id>/sessions/", views.sessions, name="sessions"),
    path("sessions/<uuid:session_id>/close/", views.close_session, name="close_session"),
    path("sessions/<uuid:session_id>/results/", views.results, name="results"),
    path("audit/", views.audit_logs, name="audit_logs"),
    path("backups/", views.backup_runs, name="backup_runs"),
    path("export/csv/", views.export_csv, name="export_csv"),
]
