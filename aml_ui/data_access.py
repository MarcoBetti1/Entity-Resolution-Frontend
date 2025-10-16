"""Filesystem helpers for reading and writing artifact data."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)


def parse_iso_datetime(raw: Optional[str]) -> Optional[datetime]:
    """Return a timezone-aware datetime if the value can be parsed."""

    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        logger.debug("Unable to parse timestamp %s", raw)
        return None


def _safe_read_json(path: Path) -> Optional[Any]:
    if not path.exists() or path.stat().st_size == 0:
        logger.debug("Skipping empty or missing file at %s", path)
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        logger.warning("Unable to parse JSON payload from %s", path)
        return None


def load_group_payloads(directory: Path) -> List[Dict[str, Any]]:
    """Load raw group JSON blobs from the artifacts directory."""

    items: List[Dict[str, Any]] = []
    if not directory.exists():
        logger.warning("Group directory %s does not exist", directory)
        return items
    for path in sorted(directory.glob("*.json")):
        payload = _safe_read_json(path)
        if isinstance(payload, dict):
            payload = dict(payload)
            payload["_source_path"] = str(path)
            items.append(payload)
    return items


def load_summary(path: Path) -> Dict[str, Any]:
    payload = _safe_read_json(path)
    return payload if isinstance(payload, dict) else {}


def load_snapshots(path: Path) -> List[Dict[str, Any]]:
    payload = _safe_read_json(path)
    return payload if isinstance(payload, list) else []


def load_reports(path: Path) -> List[Dict[str, Any]]:
    payload = _safe_read_json(path)
    if isinstance(payload, list):
        return payload
    return []


def write_reports(path: Path, reports: Sequence[Dict[str, Any]]) -> None:
    path.write_text(json.dumps(list(reports), indent=2), encoding="utf-8")


def ensure_reports_file(path: Path) -> None:
    if not path.exists():
        path.write_text("[]\n", encoding="utf-8")
