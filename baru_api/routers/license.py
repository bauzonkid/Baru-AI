"""License gate — auth-only.

Ported from Baru-YTB ``settings_routes.py`` (license section, simplified
since Pixelle doesn't need a Claude token; license is purely a gate that
flips a module-level validity flag the middleware checks on every
``/api/*`` call).

License flow:
  1. User pastes a key in LicenseGate.
  2. ``POST /api/license`` hits ``GET {LICENSE_SERVER}/api/baru/license/{key}``
     with the device_id query param.
  3. On ``ok`` → persist key + label to ``<userData>/.env``, flip
     ``_LICENSE_VALID = True``.
  4. Middleware in ``baru_api/main.py`` blocks all pipeline endpoints
     with 451 when the flag is False — even if a saved key was once
     valid (server-down after install must NOT let the tool keep
     running).
  5. ``refresh_license_at_startup()`` re-checks on every boot so admin
     key rotation / revoke propagates without user action.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field


router = APIRouter(prefix="/license", tags=["license"])


# Yohomin license server. Override via env for dev/staging.
LICENSE_SERVER_BASE = os.environ.get(
    "BARU_LICENSE_SERVER", "https://yohomin.com"
).rstrip("/")

_LICENSE_FETCH_TIMEOUT_S = 8.0


# ─── Persistence helpers ────────────────────────────────────────────────────


def _user_env_path() -> Optional[Path]:
    """Path to ``<BARU_USER_DATA>/.env``. Returns None in bare dev runs."""
    user_data = os.environ.get("BARU_USER_DATA")
    if not user_data:
        return None
    return Path(user_data) / ".env"


def _read_env(p: Path) -> dict[str, str]:
    """Parse a tiny KEY=value dotenv. No quoting / no escapes — internal use only."""
    out: dict[str, str] = {}
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    except Exception as e:
        logger.warning(f"[license] read .env failed: {e}")
    return out


def _write_env(p: Path, env: dict[str, str]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(f"{k}={v}" for k, v in env.items()) + "\n"
    p.write_text(body, encoding="utf-8")


def _device_id() -> str:
    """Per-machine UUID, persisted to ``<userData>/device_id``.

    Generated once and reused across reinstalls. Server uses this to
    bind a license to a single device. Empty string when
    BARU_USER_DATA is unset (bare dev) — server tolerates that.
    """
    user_data = os.environ.get("BARU_USER_DATA")
    if not user_data:
        return ""
    p = Path(user_data) / "device_id"
    if p.exists():
        try:
            existing = p.read_text(encoding="utf-8").strip()
            if existing:
                return existing
        except Exception:
            pass
    new_id = str(uuid.uuid4())
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(new_id, encoding="utf-8")
    except Exception:
        # If we can't persist, return in-memory value. Next process restart
        # gets a different id → user sees device_mismatch. Acceptable.
        pass
    return new_id


def _cache_get(key: str) -> Optional[str]:
    p = _user_env_path()
    if p is None or not p.exists():
        return None
    return _read_env(p).get(key)


def _persist_license(key: Optional[str], label: Optional[str] = None) -> None:
    """Write license_key + label to .env AND mirror to process env so
    ``BARU_LICENSE_KEY`` is visible to in-process services
    (e.g. imagen_yohomin reads it as the fallback when
    ``comfyui.image.imagen.license_key`` is blank).

    ``key=None`` deletes both .env entries + clears process env.
    """
    p = _user_env_path()
    if p is None:
        raise HTTPException(
            status_code=503,
            detail="BARU_USER_DATA env not set — restart through Electron.",
        )
    env = _read_env(p) if p.exists() else {}
    if key is None:
        env.pop("BARU_LICENSE_KEY", None)
        env.pop("BARU_LICENSE_LABEL", None)
        os.environ.pop("BARU_LICENSE_KEY", None)
        os.environ.pop("BARU_LICENSE_LABEL", None)
    else:
        env["BARU_LICENSE_KEY"] = key
        os.environ["BARU_LICENSE_KEY"] = key
    if label is not None and key is not None:
        env["BARU_LICENSE_LABEL"] = label
        os.environ["BARU_LICENSE_LABEL"] = label
    if env:
        _write_env(p, env)
    elif p.exists():
        p.unlink(missing_ok=True)


# ─── Yohomin license server probe ───────────────────────────────────────────


def _fetch_license_status(
    key: str,
) -> tuple[str, Optional[str], Optional[str]]:
    """Hit ``yohomin /api/baru/license/<key>?device_id=<uuid>``.

    Returns ``(status, label, error_message)``. Status is one of
    ``ok`` / ``revoked`` / ``not_found`` / ``device_mismatch`` /
    ``unreachable`` / ``unknown``. We ignore the ``token`` field
    Baru-YTB used to read — license is gate-only for Pixelle.
    """
    qs = urllib.parse.urlencode({"device_id": _device_id()})
    url = (
        f"{LICENSE_SERVER_BASE}/api/baru-pixelle/license/"
        f"{urllib.parse.quote(key)}?{qs}"
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Baru-Pixelle/license-client"},
    )
    try:
        with urllib.request.urlopen(req, timeout=_LICENSE_FETCH_TIMEOUT_S) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            data = json.loads(body) if body else {}
            if not data.get("ok"):
                return "unknown", None, data.get("error") or "server returned not-ok"
            return "ok", data.get("label"), None
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")
            data = json.loads(body) if body else {}
        except Exception:
            data = {}
        err = data.get("error") or f"http_{e.code}"
        if e.code == 404 or err == "license_not_found":
            return "not_found", None, err
        if "device_mismatch" in err:
            bound = data.get("bound_prefix")
            detail = err if not bound else f"{err} (bound to {bound}…)"
            return "device_mismatch", None, detail
        if e.code == 403 or "revoked" in err:
            return "revoked", None, err
        # 5xx + Cloudflare 520-527/530 = transient infra error.
        if 500 <= e.code < 600:
            return "unreachable", None, err
        return "unknown", None, err
    except urllib.error.URLError as e:
        return "unreachable", None, str(getattr(e, "reason", e))
    except Exception as e:
        return "unknown", None, str(e)[:200]


# ─── Module-level validity flag (read by middleware) ────────────────────────

_LICENSE_VALID: bool = False
_LICENSE_LAST_STATUS: str = "unknown"
_LICENSE_LAST_ERROR: Optional[str] = None


def get_license_validity() -> tuple[bool, str, Optional[str]]:
    return _LICENSE_VALID, _LICENSE_LAST_STATUS, _LICENSE_LAST_ERROR


def _set_license_validity(
    valid: bool, status: str, error: Optional[str]
) -> None:
    global _LICENSE_VALID, _LICENSE_LAST_STATUS, _LICENSE_LAST_ERROR
    _LICENSE_VALID = valid
    _LICENSE_LAST_STATUS = status
    _LICENSE_LAST_ERROR = error


def refresh_license_at_startup() -> None:
    """Called from FastAPI lifespan. Sets module-level validity flag.

    Decision matrix:
      ok                                  → valid=True
      revoked / not_found / device_mismatch → valid=False, wipe local key
      unreachable / unknown               → valid=False, keep local key
                                            (user retries when server up)
    """
    key = _cache_get("BARU_LICENSE_KEY")
    if not key:
        _set_license_validity(False, "not_configured", None)
        return
    # Mirror the saved key to process env immediately so services that
    # read BARU_LICENSE_KEY (imagen_yohomin) see it even before the
    # yohomin probe finishes. If the probe ends up wiping the key
    # below, _persist_license(None) will also pop the env var.
    os.environ["BARU_LICENSE_KEY"] = key
    cached_label = _cache_get("BARU_LICENSE_LABEL")
    if cached_label:
        os.environ["BARU_LICENSE_LABEL"] = cached_label
    status, label, err = _fetch_license_status(key)
    if status == "ok":
        try:
            _persist_license(key, label)
        except HTTPException:
            pass
        _set_license_validity(True, "ok", None)
        logger.info(f"[license] revalidated (label={label})")
        return
    if status in ("revoked", "not_found", "device_mismatch"):
        try:
            _persist_license(None)
        except HTTPException:
            pass
        _set_license_validity(False, status, err)
        logger.warning(
            f"[license] server says key is {status} — wiped local key."
        )
        return
    # Transient — keep key for retry.
    _set_license_validity(False, status, err)
    logger.warning(
        f"[license] revalidate failed: status={status} err={err}. "
        "Tool gated until yohomin reachable again."
    )


# ─── API schemas ────────────────────────────────────────────────────────────


class LicenseStatus(BaseModel):
    configured: bool = Field(description="True if a license key is on disk.")
    masked_key: Optional[str] = Field(
        default=None, description="First 8 chars + '…' of the key."
    )
    label: Optional[str] = Field(
        default=None, description="Human-friendly label from server."
    )
    last_status: Literal[
        "active", "revoked", "not_found", "device_mismatch",
        "unreachable", "ok", "unknown",
    ] = Field(default="unknown")
    last_error: Optional[str] = None


class SetLicenseRequest(BaseModel):
    key: str = Field(min_length=8, description="License key (UUID v4).")


def _mask_key(key: str) -> str:
    return key[:8] + "…" if len(key) > 8 else key


# ─── Endpoints ──────────────────────────────────────────────────────────────


@router.get("-status", response_model=LicenseStatus)
async def license_status() -> LicenseStatus:
    """Whether a key is configured + last yohomin check outcome."""
    p = _user_env_path()
    if p is None:
        return LicenseStatus(
            configured=False, last_status="unknown",
            last_error="BARU_USER_DATA not set",
        )
    env = _read_env(p) if p.exists() else {}
    key = env.get("BARU_LICENSE_KEY")
    if not key:
        return LicenseStatus(configured=False, last_status="unknown")
    _valid, status, error = get_license_validity()
    normalised = status if status != "not_configured" else "unknown"
    return LicenseStatus(
        configured=True,
        masked_key=_mask_key(key),
        label=env.get("BARU_LICENSE_LABEL") or None,
        last_status=normalised,  # type: ignore[arg-type]
        last_error=error,
    )


@router.post("", response_model=LicenseStatus)
async def set_license(req: SetLicenseRequest) -> LicenseStatus:
    """Validate key against yohomin and persist."""
    key = req.key.strip()
    status, label, err = _fetch_license_status(key)

    if status == "ok":
        _persist_license(key, label)
        _set_license_validity(True, "ok", None)
        return LicenseStatus(
            configured=True, masked_key=_mask_key(key),
            label=label, last_status="ok",
        )

    if status == "unreachable":
        # Persist anyway so startup-revalidate can succeed later.
        _persist_license(key, _cache_get("BARU_LICENSE_LABEL"))
        _set_license_validity(False, "unreachable", err)
        return LicenseStatus(
            configured=True, masked_key=_mask_key(key),
            last_status="unreachable", last_error=err,
        )

    # Hard fail — don't persist a bad key.
    _set_license_validity(False, status, err)
    raise HTTPException(
        status_code=400,
        detail={"status": status, "error": err or status},
    )


@router.post("/refresh", response_model=LicenseStatus)
async def refresh_license() -> LicenseStatus:
    key = _cache_get("BARU_LICENSE_KEY")
    if not key:
        raise HTTPException(status_code=404, detail="no_license_configured")
    status, label, err = _fetch_license_status(key)
    if status != "ok":
        _set_license_validity(False, status, err)
        return LicenseStatus(
            configured=True, masked_key=_mask_key(key),
            last_status=status, last_error=err,
        )
    _persist_license(key, label)
    _set_license_validity(True, "ok", None)
    return LicenseStatus(
        configured=True, masked_key=_mask_key(key),
        label=label, last_status="ok",
    )


@router.delete("", response_model=LicenseStatus)
async def delete_license() -> LicenseStatus:
    """Forget the license key."""
    _persist_license(None)
    _set_license_validity(False, "not_configured", None)
    return LicenseStatus(configured=False, last_status="unknown")
