from .models import AuditLog


def client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def log_event(request, action, entity=None, metadata=None):
    actor = request.user if getattr(request, "user", None) and request.user.is_authenticated else None
    entity_type = entity.__class__.__name__ if entity is not None else ""
    entity_id = str(getattr(entity, "pk", "") or getattr(entity, "session_id", "") or "")
    return AuditLog.objects.create(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        ip_address=client_ip(request),
        user_agent=request.META.get("HTTP_USER_AGENT", ""),
        metadata=metadata or {},
    )
