"""
Rate-limiting helpers para endpoints de autenticación (brute-force protection).

Usa django.core.cache (LocMemCache por defecto en despliegue local).
No requiere dependencias externas.

Estrategia de llaves:
  rl:<scope>:<key>   → contador de fallos (int)
  rl_ts:<scope>:<key> → timestamp de primer fallo en la ventana (float, epoch)

Se implementa ventana deslizante simple: si han pasado más de `window_seconds`
desde el primer fallo registrado, la ventana se reinicia automáticamente.
"""

import time

from django.core.cache import cache

# Prefijos de llaves de caché
_PREFIX_COUNT = "rl:"
_PREFIX_TS = "rl_ts:"


def _count_key(scope: str, key: str) -> str:
    return f"{_PREFIX_COUNT}{scope}:{key}"


def _ts_key(scope: str, key: str) -> str:
    return f"{_PREFIX_TS}{scope}:{key}"


def register_failure(scope: str, key: str, window_seconds: int = 900) -> int:
    """
    Registra un intento fallido para (scope, key).
    Devuelve el número total de fallos en la ventana actual.
    Si la ventana ha expirado, reinicia el contador.
    """
    ck = _count_key(scope, key)
    tk = _ts_key(scope, key)

    now = time.time()
    first_failure_ts = cache.get(tk)

    if first_failure_ts is None or (now - first_failure_ts) >= window_seconds:
        # Ventana nueva o expirada: reiniciar
        cache.set(tk, now, timeout=window_seconds)
        cache.set(ck, 1, timeout=window_seconds)
        return 1

    # Dentro de la ventana activa: incrementar
    # add() falla si ya existe; usamos incr() de forma segura
    try:
        count = cache.incr(ck)
    except ValueError:
        # La llave expiró entre el get de ts y el incr; reiniciar
        cache.set(tk, now, timeout=window_seconds)
        cache.set(ck, 1, timeout=window_seconds)
        count = 1

    return count


def clear_failures(scope: str, key: str) -> None:
    """Limpia los contadores de fallos para (scope, key). Llamar en login exitoso."""
    cache.delete(_count_key(scope, key))
    cache.delete(_ts_key(scope, key))


def is_rate_limited(scope: str, key: str, limit: int, window_seconds: int = 900) -> bool:
    """
    Devuelve True si el contador de fallos para (scope, key) alcanzó o superó `limit`
    dentro de la ventana activa.
    No incrementa el contador; solo consulta.
    """
    ck = _count_key(scope, key)
    tk = _ts_key(scope, key)

    now = time.time()
    first_failure_ts = cache.get(tk)

    if first_failure_ts is None:
        return False
    if (now - first_failure_ts) >= window_seconds:
        # Ventana expirada → no bloqueado
        return False

    count = cache.get(ck, default=0)
    return int(count) >= limit
