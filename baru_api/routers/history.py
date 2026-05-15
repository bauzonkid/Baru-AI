"""History endpoints — list / inspect / delete completed video tasks.

Backed by ``baru_pixelle.services.history_manager.HistoryManager``,
which scans the on-disk ``output/<task_id>/`` directories (each with
``metadata.json``, ``storyboard.json``, ``final.mp4``). Persistent
across app restarts, unlike the in-memory ``task_manager.list_tasks``.

UI: powers the "Workspace" page that lists all videos sếp đã render.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from loguru import logger

from baru_api.dependencies import PixelleVideoDep


router = APIRouter(prefix="/history", tags=["History"])


@router.get("")
async def list_history(
    request: Request,
    pixelle_video: PixelleVideoDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    status: Optional[str] = Query(None),
) -> dict[str, Any]:
    """Paginated list of past video tasks, newest first.

    Each item carries the topic ("input.text"), duration, status,
    timestamps, and — when status=="completed" — a ready-to-load
    ``video_url`` pointing at ``/api/files/.../final.mp4`` so the
    frontend can render a thumbnail/<video> without a second round-trip.
    """
    data = await pixelle_video.history.get_task_list(
        page=page,
        page_size=page_size,
        status=status,
    )

    # Inject video_url for completed tasks. The index serialises tasks
    # in a flat shape — ``video_path``, ``title``, ``duration`` sit at
    # the top of each item, not under nested ``result``.
    base_url = str(request.base_url).rstrip("/")
    for item in data.get("tasks", []):
        video_path = (item or {}).get("video_path") or ""
        if video_path:
            # Strip the leading project root so /api/files serves it.
            # Persistence writes absolute paths like
            #   D:\uSubaru\Baru-Pixelle\output\<task>\final.mp4
            # We want the path relative to project root ("output/<task>/final.mp4").
            from pathlib import Path
            try:
                rel = Path(video_path).resolve().relative_to(Path.cwd().resolve())
                item["video_url"] = f"{base_url}/api/files/{rel.as_posix()}"
            except (ValueError, OSError):
                # Path is outside cwd (rare — manual import?). Fall
                # back to absolute path with the original separator;
                # /api/files may still resolve depending on its config.
                item["video_url"] = f"{base_url}/api/files/{video_path.replace(chr(92), '/')}"
        else:
            item["video_url"] = None

    return data


@router.get("/{task_id}")
async def get_history_detail(
    task_id: str,
    pixelle_video: PixelleVideoDep,
) -> dict[str, Any]:
    """Full metadata + storyboard for one task."""
    detail = await pixelle_video.history.get_task_detail(task_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")
    return detail


@router.delete("/{task_id}")
async def delete_history(
    task_id: str,
    pixelle_video: PixelleVideoDep,
) -> dict[str, Any]:
    """Remove a task's output dir from disk. Irreversible."""
    ok = await pixelle_video.history.delete_task(task_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")
    logger.info(f"[history] deleted task {task_id}")
    return {"success": True, "task_id": task_id}


@router.get("-stats")
async def history_stats(pixelle_video: PixelleVideoDep) -> dict[str, Any]:
    """Total / completed / failed counts + aggregate duration. Cheap
    to compute since HistoryManager already walks the dir."""
    return await pixelle_video.history.get_statistics()
