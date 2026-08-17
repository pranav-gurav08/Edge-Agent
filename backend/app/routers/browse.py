"""GET /api/v1/browse?path= — list local directories for the folder browser.

The PWA cannot read absolute paths from a browser file picker, so folder
selection is backed by this endpoint running on the agent host. It only lists
directories; it never reads file contents.
"""
from __future__ import annotations

import os
import string

from fastapi import APIRouter, HTTPException, Query

from ..schemas import BrowseEntry, BrowseResponse

router = APIRouter(tags=["browse"])

MAX_ENTRIES = 500


def _list_drives() -> list[BrowseEntry]:
    entries: list[BrowseEntry] = []
    for letter in string.ascii_uppercase:
        root = f"{letter}:\\"
        if os.path.exists(root):
            entries.append(BrowseEntry(name=root, path=root, is_dir=True))
    if not entries:  # POSIX fallback
        entries.append(BrowseEntry(name="/", path="/", is_dir=True))
    return entries


def _list_dir(raw_path: str) -> tuple[str, str | None, list[BrowseEntry]]:
    try:
        normalized = os.path.abspath(os.path.expanduser(raw_path))
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid path: {exc}") from exc
    if not os.path.exists(normalized):
        raise HTTPException(status_code=404, detail=f"path does not exist: {raw_path}")
    if not os.path.isdir(normalized):
        raise HTTPException(status_code=422, detail=f"not a directory: {raw_path}")

    parent = os.path.dirname(normalized)
    if parent == normalized:
        parent = None  # filesystem root has no parent

    try:
        names = os.listdir(normalized)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"cannot read directory: {exc}") from exc

    entries: list[BrowseEntry] = []
    for name in sorted(names, key=lambda n: n.lower()):
        child = os.path.join(normalized, name)
        try:
            is_dir = os.path.isdir(child)
        except OSError:
            continue
        entries.append(BrowseEntry(name=name, path=child, is_dir=is_dir))
        if len(entries) >= MAX_ENTRIES:
            break
    return normalized, parent, entries


@router.get("/browse", response_model=BrowseResponse)
async def browse(path: str | None = Query(default=None, max_length=4096)) -> BrowseResponse:
    if not path:
        return BrowseResponse(current=None, parent=None, entries=_list_drives())
    current, parent, entries = _list_dir(path)
    return BrowseResponse(current=current, parent=parent, entries=entries)
