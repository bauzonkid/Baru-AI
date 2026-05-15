"""Multipart upload endpoint.

Saves files to ``<BARU_USER_DATA>/uploads/<batch_uuid>/`` (or
``cwd/uploads/`` in dev) and returns the absolute disk paths so the
caller can hand them to the video generator (``assets``,
``character_assets``, etc.). The pipeline reads from these paths
directly — they're not served back over HTTP after upload.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException, UploadFile
from loguru import logger


router = APIRouter(prefix="/uploads", tags=["Uploads"])

# Single shared uploads dir so dev / packaged / portable all land in
# the same place. userData when Electron is hosting, else cwd-relative.
def _uploads_root() -> Path:
    base = os.environ.get("BARU_USER_DATA")
    root = Path(base) if base else Path.cwd()
    return root / "uploads"


# Per-file ceiling. The video pipeline isn't designed for huge raw
# uploads — anything beyond this is likely the user picking the
# wrong file by accident.
_MAX_FILE_BYTES = 200 * 1024 * 1024  # 200 MB


@router.post("")
async def upload_files(files: List[UploadFile]) -> dict:
    """Save uploaded files to a per-batch subdirectory.

    Returns ``{paths: [<abs path>, ...]}`` — the order matches the
    request's file list. Filenames are kept as-is for readability;
    duplicate names get a numeric suffix.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files supplied")

    batch_id = uuid.uuid4().hex[:12]
    target = _uploads_root() / batch_id
    target.mkdir(parents=True, exist_ok=True)

    saved: List[str] = []
    try:
        for f in files:
            if not f.filename:
                raise HTTPException(status_code=400, detail="File missing filename")
            # Strip any path component the client put in (defence
            # against ``../../etc/passwd``-style filenames).
            name = Path(f.filename).name
            dest = target / name
            counter = 1
            while dest.exists():
                stem = dest.stem
                suffix = dest.suffix
                dest = target / f"{stem}_{counter}{suffix}"
                counter += 1

            size = 0
            with open(dest, "wb") as out:
                while chunk := await f.read(1024 * 1024):
                    size += len(chunk)
                    if size > _MAX_FILE_BYTES:
                        out.close()
                        dest.unlink(missing_ok=True)
                        raise HTTPException(
                            status_code=413,
                            detail=f"{name}: vượt giới hạn 200MB",
                        )
                    out.write(chunk)

            saved.append(str(dest.resolve()))
            logger.info(f"[uploads] saved {dest} ({size // 1024} KB)")
    except HTTPException:
        # Cleanup partial batch on failure.
        for p in saved:
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass
        try:
            target.rmdir()
        except OSError:
            pass
        raise

    return {"paths": saved, "batch_id": batch_id}
