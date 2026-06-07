from django.contrib import admin
from django.urls import include, path
from clinical import views as clinical_views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("paciente/", clinical_views.patient_portal, name="patient_portal"),
    path("research/", clinical_views.research_portal, name="research_portal"),
    path("clinico/", clinical_views.clinician_portal, name="clinician_portal"),
    path("api/", include("clinical.urls")),
]
