"""API routes for the AML UI backend."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from .models import (
    DatasetSummaryResponse,
    GroupDetailResponse,
    GroupListResponse,
    NetworkResponse,
    ReportCreateRequest,
    ReportCreateResponse,
    ReportRecord,
    SnapshotListResponse,
    SettingsResponse,
)
from .services import GroupFilters, TransactionFilters, get_service

router = APIRouter(prefix="/api")


@router.get("/settings", response_model=SettingsResponse)
def read_settings() -> SettingsResponse:
    return get_service().get_settings()


@router.get("/summary", response_model=DatasetSummaryResponse)
def read_summary() -> DatasetSummaryResponse:
    return get_service().get_dataset_summary()


@router.get("/groups", response_model=GroupListResponse)
def list_groups(
    min_risk: int = Query(0, ge=0, le=100),
    min_total: float = Query(0.0, ge=0.0),
    max_total: float = Query(float("inf"), ge=0.0),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    reported_only: bool = Query(False),
) -> GroupListResponse:
    filters = GroupFilters(
        min_risk=min_risk,
        min_total=min_total,
        max_total=max_total,
        start_date=start_date,
        end_date=end_date,
        reported_only=reported_only,
    )
    return get_service().list_groups(filters)


@router.get("/groups/{group_id}", response_model=GroupDetailResponse)
def read_group(
    group_id: str,
    min_amount: float = Query(0.0, ge=0.0),
    max_amount: float = Query(float("inf"), ge=0.0),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
) -> GroupDetailResponse:
    filters = TransactionFilters(
        min_amount=min_amount,
        max_amount=max_amount,
        start_date=start_date,
        end_date=end_date,
    )
    try:
        return get_service().get_group_detail(group_id, transaction_filters=filters)
    except ValueError as exc:  # pragma: no cover - thin wrapper
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/network", response_model=NetworkResponse)
def read_network(
    min_risk: int = Query(0, ge=0, le=100),
    min_total: float = Query(0.0, ge=0.0),
    max_total: float = Query(float("inf"), ge=0.0),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    reported_only: bool = Query(False),
    highlight_reported: bool = Query(True),
) -> NetworkResponse:
    filters = GroupFilters(
        min_risk=min_risk,
        min_total=min_total,
        max_total=max_total,
        start_date=start_date,
        end_date=end_date,
        reported_only=reported_only,
    )
    return get_service().get_network(filters, highlight_reported=highlight_reported)


@router.get("/reports", response_model=list[ReportRecord])
def read_reports() -> list[ReportRecord]:
    return get_service().list_reports()


@router.post("/reports", response_model=ReportCreateResponse)
def create_report(request: ReportCreateRequest) -> ReportCreateResponse:
    try:
        return get_service().submit_report(request)
    except ValueError as exc:  # pragma: no cover - thin wrapper
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/snapshots", response_model=SnapshotListResponse)
def read_snapshots(limit: int = Query(100, ge=1, le=1000)) -> SnapshotListResponse:
    return get_service().list_snapshots(limit=limit)


@router.post("/actions/refresh", status_code=204)
def refresh_caches() -> None:
    get_service().refresh()
