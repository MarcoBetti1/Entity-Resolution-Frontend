"""Pydantic models shared across the FastAPI surface."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from pydantic import BaseModel, Field


class RunOptionModel(BaseModel):
    label: str
    value: str
    meta: Dict[str, Any] = Field(default_factory=dict)


class GroupMetrics(BaseModel):
    member_count: int
    transaction_count: int
    total_amount: float
    unique_counterparties: int
    outgoing_ratio: float
    first_seen: Optional[datetime]
    last_seen: Optional[datetime]
    min_transaction_amount: Optional[float]
    max_transaction_amount: Optional[float]
    risk_score: int


class TransactionModel(BaseModel):
    transaction_id: Optional[str]
    direction: Optional[str]
    counterparty_id: Optional[str]
    amount: Optional[float]
    currency: Optional[str]
    timestamp: Optional[datetime]


class MemberModel(BaseModel):
    record_id: Optional[str]
    entity_type: Optional[str]
    attributes: Dict[str, Any] = Field(default_factory=dict)
    normalized_attributes: Dict[str, Any] = Field(default_factory=dict)
    transactions: List[TransactionModel] = Field(default_factory=list)
    signature_history: List[str] = Field(default_factory=list)


class GroupSummary(BaseModel):
    group_id: str
    display_name: Optional[str]
    metrics: GroupMetrics
    source_path: Optional[str]
    reported: bool = False


class GroupDetail(GroupSummary):
    canonical_attributes: Dict[str, Any] = Field(default_factory=dict)
    members: List[MemberModel] = Field(default_factory=list)
    transactions: List[TransactionModel] = Field(default_factory=list)


class SummaryStats(BaseModel):
    min_total_amount: Optional[float]
    max_total_amount: Optional[float]
    min_risk: Optional[int]
    max_risk: Optional[int]
    min_date: Optional[datetime]
    max_date: Optional[datetime]
    min_tx_amount: Optional[float]
    max_tx_amount: Optional[float]


class DatasetSummaryResponse(BaseModel):
    runs: List[RunOptionModel]
    aggregated: SummaryStats
    total_groups: int
    total_records: Optional[int]
    summary_metadata: Dict[str, Any] = Field(default_factory=dict)


class GroupListResponse(BaseModel):
    items: List[GroupSummary]
    total: int
    aggregated: SummaryStats
    reported_ids: List[str]


class GroupDetailResponse(BaseModel):
    group: GroupDetail
    snapshots: List[Dict[str, Any]] = Field(default_factory=list)
    snapshot_count: int = 0


class SnapshotListResponse(BaseModel):
    items: List[Dict[str, Any]] = Field(default_factory=list)
    total: int
    limit: int


class ReportRecord(BaseModel):
    timestamp: str
    group_id: Optional[str]
    reason: str
    checks: List[str] = Field(default_factory=list)
    snapshot: Dict[str, Any] = Field(default_factory=dict)


class ReportCreateRequest(BaseModel):
    group_id: str
    reason: str
    checks: Sequence[str] = Field(default_factory=list)


class ReportCreateResponse(BaseModel):
    record: ReportRecord
    total_reports: int


class NetworkNode(BaseModel):
    id: str
    label: str
    kind: str
    risk_score: Optional[int]
    member_count: Optional[int]
    total_amount: Optional[float]
    highlight: bool = False


class NetworkEdge(BaseModel):
    source: str
    target: str
    amount: float
    count: int
    directions: List[str] = Field(default_factory=list)


class NetworkResponse(BaseModel):
    nodes: List[NetworkNode]
    edges: List[NetworkEdge]


class SettingsResponse(BaseModel):
    title: str
    report_checks: List[str]
    default_highlight_reported: bool
    default_show_summaries: bool
