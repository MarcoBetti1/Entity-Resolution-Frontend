"""Centralised configuration for the AML UI backend."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

DEFAULT_REPORT_CHECKS = [
    "shared tax id",
    "rapid transfer chain",
    "circular flow",
    "high velocity counterparties",
    "mismatched jurisdiction",
]


@dataclass(frozen=True)
class AppPaths:
    """Resolved filesystem locations used by the service."""

    base_dir: Path
    artifacts_dir: Path
    entities_dir: Path
    summary_file: Path
    snapshots_file: Path
    reports_file: Path
    settings_file: Path


@dataclass(frozen=True)
class AppSettings:
    """Runtime configurable settings sourced from JSON."""

    title: str
    default_highlight_reported: bool
    default_show_summaries: bool
    report_checks: List[str]

    @classmethod
    def from_payload(cls, payload: Dict[str, Any]) -> "AppSettings":
        ui = payload.get("ui", {}) if isinstance(payload, dict) else {}
        reporting = payload.get("reporting", {}) if isinstance(payload, dict) else {}
        title = str(ui.get("title") or "Entity Resolution Explorer")
        highlight = bool(ui.get("defaultHighlightReported", True))
        show_summaries = bool(ui.get("defaultShowSummaries", True))
        raw_checks = reporting.get("checks") if isinstance(reporting, dict) else None
        if isinstance(raw_checks, list) and all(isinstance(item, str) for item in raw_checks):
            checks = [item.strip() for item in raw_checks if item.strip()]
            if not checks:
                checks = DEFAULT_REPORT_CHECKS
        else:
            checks = DEFAULT_REPORT_CHECKS
        return cls(
            title=title,
            default_highlight_reported=highlight,
            default_show_summaries=show_summaries,
            report_checks=checks,
        )


@dataclass(frozen=True)
class AppConfig:
    """Aggregated application configuration."""

    paths: AppPaths
    settings: AppSettings


def _resolve_base_dir() -> Path:
    override = os.getenv("AML_UI_BASE_DIR")
    if override:
        candidate = Path(override).expanduser().resolve()
        if candidate.exists():
            return candidate
        logger.warning("AML_UI_BASE_DIR=%s does not exist; falling back to package root", candidate)
    return Path(__file__).resolve().parent.parent


def _load_json(path: Path) -> Dict[str, Any]:
    if not path.exists() or path.stat().st_size == 0:
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[return-value]
    except json.JSONDecodeError:
        logger.warning("Unable to parse JSON settings file at %s", path)
        return {}


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    """Return the memoised application configuration."""

    base_dir = _resolve_base_dir()
    artifacts_dir = base_dir / "artifacts"
    paths = AppPaths(
        base_dir=base_dir,
        artifacts_dir=artifacts_dir,
        entities_dir=artifacts_dir / "entities",
        summary_file=artifacts_dir / "summary.json",
        snapshots_file=artifacts_dir / "snapshots.json",
        reports_file=base_dir / "reports.json",
        settings_file=base_dir / "config" / "app_settings.json",
    )
    settings_payload = _load_json(paths.settings_file)
    settings = AppSettings.from_payload(settings_payload)
    return AppConfig(paths=paths, settings=settings)
