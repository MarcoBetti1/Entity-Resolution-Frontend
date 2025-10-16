"""Core business logic for the AML UI backend."""

from __future__ import annotations

import math
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .config import AppConfig, get_config
from .data_access import (
    ensure_reports_file,
    load_group_payloads,
    load_reports,
    load_snapshots,
    load_summary,
    parse_iso_datetime,
    write_reports,
)
from .models import (
    DatasetSummaryResponse,
    GroupDetail,
    GroupDetailResponse,
    GroupListResponse,
    GroupMetrics,
    GroupSummary,
    MemberModel,
    NetworkEdge,
    NetworkNode,
    NetworkResponse,
    ReportCreateRequest,
    ReportCreateResponse,
    ReportRecord,
    RunOptionModel,
    SnapshotListResponse,
    SettingsResponse,
    SummaryStats,
    TransactionModel,
)


@dataclass(frozen=True)
class GroupFilters:
    min_risk: int = 0
    min_total: float = 0.0
    max_total: float = float("inf")
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    reported_only: bool = False


@dataclass(frozen=True)
class TransactionFilters:
    min_amount: float = 0.0
    max_amount: float = float("inf")
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


def compute_risk_score(
    member_count: int,
    transaction_count: int,
    total_amount: float,
    unique_counterparties: int,
    outgoing_ratio: float,
) -> int:
    exposure = math.log1p(total_amount) if total_amount > 0 else 0.0
    exposure_scale = (exposure / math.log1p(250000.0)) * 55.0 if exposure else 0.0
    structural = member_count * 4.5 + transaction_count * 2.2 + unique_counterparties * 1.5
    directionality = outgoing_ratio * 18.0
    raw_score = structural + exposure_scale + directionality
    return int(max(1.0, min(99.0, round(raw_score))))


def enrich_group(raw_group: Dict[str, Any]) -> Dict[str, Any]:
    group = deepcopy(raw_group)
    members = group.get("members") or []
    transactions = group.get("transactions") or []
    parsed_transactions: List[Dict[str, Any]] = []
    total_amount = 0.0
    unique_counterparties = set()
    outgoing_count = 0
    timestamps: List[datetime] = []
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None

    for tx in transactions:
        tx_amount = tx.get("amount")
        if isinstance(tx_amount, (int, float)):
            amount_value = float(tx_amount)
            total_amount += amount_value
            min_amount = amount_value if min_amount is None else min(min_amount, amount_value)
            max_amount = amount_value if max_amount is None else max(max_amount, amount_value)
        counterparty = tx.get("counterparty_id")
        if counterparty:
            unique_counterparties.add(counterparty)
        normalized_direction = (tx.get("direction") or "").lower()
        if normalized_direction in {"out", "outgoing", "debit"}:
            outgoing_count += 1
        ts = parse_iso_datetime(tx.get("timestamp"))
        if ts:
            timestamps.append(ts)
        parsed = dict(tx)
        parsed["parsed_timestamp"] = ts
        parsed_transactions.append(parsed)

    transaction_count = len(transactions)
    outgoing_ratio = outgoing_count / transaction_count if transaction_count else 0.0
    risk_score = compute_risk_score(
        member_count=len(members),
        transaction_count=transaction_count,
        total_amount=total_amount,
        unique_counterparties=len(unique_counterparties),
        outgoing_ratio=outgoing_ratio,
    )
    first_seen = min(timestamps) if timestamps else None
    last_seen = max(timestamps) if timestamps else None

    group["_metrics"] = {
        "member_count": len(members),
        "transaction_count": transaction_count,
        "total_amount": round(total_amount, 2),
        "unique_counterparties": len(unique_counterparties),
        "outgoing_ratio": outgoing_ratio,
        "first_seen": first_seen,
        "last_seen": last_seen,
        "min_transaction_amount": min_amount,
        "max_transaction_amount": max_amount,
        "risk_score": risk_score,
    }
    group["_transactions"] = parsed_transactions
    canonical = group.get("canonical_attributes") or {}
    group["_display_name"] = canonical.get("name") or group.get("group_id")
    return group


def summarize_groups(groups: Sequence[Dict[str, Any]]) -> SummaryStats:
    if not groups:
        return SummaryStats(
            min_total_amount=None,
            max_total_amount=None,
            min_risk=None,
            max_risk=None,
            min_date=None,
            max_date=None,
            min_tx_amount=None,
            max_tx_amount=None,
        )
    totals = [g["_metrics"]["total_amount"] for g in groups]
    risks = [g["_metrics"]["risk_score"] for g in groups]
    tx_min_values: List[float] = []
    tx_max_values: List[float] = []
    dates = []
    for g in groups:
        metrics = g["_metrics"]
        tx_min = metrics.get("min_transaction_amount")
        tx_max = metrics.get("max_transaction_amount")
        if tx_min is not None:
            tx_min_values.append(float(tx_min))
        if tx_max is not None:
            tx_max_values.append(float(tx_max))
        if metrics.get("first_seen"):
            dates.append(metrics["first_seen"])
        if metrics.get("last_seen"):
            dates.append(metrics["last_seen"])
    return SummaryStats(
        min_total_amount=min(totals),
        max_total_amount=max(totals),
        min_risk=min(risks),
        max_risk=max(risks),
        min_date=min(dates) if dates else None,
        max_date=max(dates) if dates else None,
        min_tx_amount=min(tx_min_values) if tx_min_values else None,
        max_tx_amount=max(tx_max_values) if tx_max_values else None,
    )


def filter_groups(
    groups: Sequence[Dict[str, Any]],
    *,
    filters: GroupFilters,
    reported_ids: Iterable[str],
) -> List[Dict[str, Any]]:
    reported_set = set(reported_ids)
    filtered: List[Dict[str, Any]] = []
    for group in groups:
        metrics = group["_metrics"]
        if metrics["risk_score"] < filters.min_risk:
            continue
        total_amount = metrics["total_amount"]
        if total_amount < filters.min_total or total_amount > filters.max_total:
            continue
        if filters.reported_only and group.get("group_id") not in reported_set:
            continue
        if filters.start_date or filters.end_date:
            group_start = metrics.get("first_seen")
            group_end = metrics.get("last_seen")
            if filters.start_date and (not group_end or group_end < filters.start_date):
                continue
            if filters.end_date and (not group_start or group_start > filters.end_date):
                continue
        filtered.append(group)
    return filtered


def build_network_payload(
    groups: Sequence[Dict[str, Any]],
    *,
    reported_ids: Iterable[str],
    highlight_reported: bool,
) -> NetworkResponse:
    reported_set = set(reported_ids)
    nodes: Dict[str, NetworkNode] = {}
    edges: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for group in groups:
        group_id = group.get("group_id")
        if not group_id:
            continue
        metrics = group["_metrics"]
        nodes[group_id] = NetworkNode(
            id=group_id,
            label=group.get("_display_name") or group_id,
            kind="group",
            risk_score=metrics.get("risk_score"),
            member_count=metrics.get("member_count"),
            total_amount=metrics.get("total_amount"),
            highlight=highlight_reported and group_id in reported_set,
        )
        for tx in group.get("_transactions") or []:
            counterparty = tx.get("counterparty_id")
            if not counterparty:
                continue
            if counterparty not in nodes:
                nodes[counterparty] = NetworkNode(
                    id=counterparty,
                    label=counterparty[:24],
                    kind="counterparty",
                    risk_score=None,
                    member_count=None,
                    total_amount=None,
                    highlight=False,
                )
            amount = float(tx.get("amount") or 0.0)
            direction = (tx.get("direction") or "").lower()
            if direction in {"in", "incoming", "credit"}:
                src, dst = counterparty, group_id
            else:
                src, dst = group_id, counterparty
            key = (src, dst)
            entry = edges.setdefault(
                key,
                {
                    "amount": 0.0,
                    "count": 0,
                    "directions": set(),
                },
            )
            entry["amount"] += amount
            entry["count"] += 1
            if direction:
                entry["directions"].add(direction)

    edge_models = [
        NetworkEdge(
            source=src,
            target=dst,
            amount=round(data["amount"], 2),
            count=data["count"],
            directions=sorted(data["directions"]),
        )
        for (src, dst), data in edges.items()
    ]
    return NetworkResponse(nodes=list(nodes.values()), edges=edge_models)


def _convert_transactions(raw_transactions: Sequence[Dict[str, Any]]) -> List[TransactionModel]:
    converted: List[TransactionModel] = []
    for tx in raw_transactions:
        timestamp = tx.get("parsed_timestamp") or parse_iso_datetime(tx.get("timestamp"))
        converted.append(
            TransactionModel(
                transaction_id=tx.get("transaction_id"),
                direction=tx.get("direction"),
                counterparty_id=tx.get("counterparty_id"),
                amount=float(tx.get("amount")) if isinstance(tx.get("amount"), (int, float)) else None,
                currency=tx.get("currency"),
                timestamp=timestamp,
            )
        )
    return converted


def _convert_members(raw_members: Sequence[Dict[str, Any]]) -> List[MemberModel]:
    members: List[MemberModel] = []
    for member in raw_members:
        transactions = member.get("transactions") or []
        members.append(
            MemberModel(
                record_id=member.get("record_id"),
                entity_type=member.get("entity_type"),
                attributes=dict(member.get("attributes") or {}),
                normalized_attributes=dict(member.get("normalized_attributes") or {}),
                transactions=_convert_transactions(transactions),
                signature_history=list(member.get("signature_history") or []),
            )
        )
    return members


class GroupService:
    """Facade coordinating artifact access and domain logic."""

    def __init__(self, config: Optional[AppConfig] = None) -> None:
        self._config = config or get_config()
        self._groups_cache: Optional[List[Dict[str, Any]]] = None
        self._summary_cache: Optional[Dict[str, Any]] = None
        self._snapshots_cache: Optional[List[Dict[str, Any]]] = None
        self._reports_cache: Optional[List[Dict[str, Any]]] = None

    @property
    def config(self) -> AppConfig:
        return self._config

    def _load_groups(self) -> List[Dict[str, Any]]:
        if self._groups_cache is None:
            raw_groups = load_group_payloads(self._config.paths.entities_dir)
            self._groups_cache = [enrich_group(group) for group in raw_groups]
        return self._groups_cache

    def _load_summary(self) -> Dict[str, Any]:
        if self._summary_cache is None:
            self._summary_cache = load_summary(self._config.paths.summary_file)
        return self._summary_cache

    def _load_snapshots(self) -> List[Dict[str, Any]]:
        if self._snapshots_cache is None:
            self._snapshots_cache = load_snapshots(self._config.paths.snapshots_file)
        return self._snapshots_cache

    def _load_reports(self) -> List[Dict[str, Any]]:
        if self._reports_cache is None:
            ensure_reports_file(self._config.paths.reports_file)
            self._reports_cache = load_reports(self._config.paths.reports_file)
        return self._reports_cache

    def _update_reports_cache(self, reports: List[Dict[str, Any]]) -> None:
        self._reports_cache = reports
        write_reports(self._config.paths.reports_file, reports)

    def get_settings(self) -> SettingsResponse:
        settings = self._config.settings
        return SettingsResponse(
            title=settings.title,
            report_checks=settings.report_checks,
            default_highlight_reported=settings.default_highlight_reported,
            default_show_summaries=settings.default_show_summaries,
        )

    def get_dataset_summary(self) -> DatasetSummaryResponse:
        groups = self._load_groups()
        summary_payload = self._load_summary()
        aggregated = summarize_groups(groups)
        runs: List[RunOptionModel] = []
        if isinstance(summary_payload.get("runs"), list):
            for entry in summary_payload["runs"]:
                if isinstance(entry, dict):
                    run_id = str(entry.get("run_id") or "run")
                    label = entry.get("label") or run_id
                    runs.append(RunOptionModel(label=label, value=run_id, meta=entry))
        elif summary_payload:
            run_id = str(summary_payload.get("run_id") or "current_run")
            label = summary_payload.get("label") or run_id
            runs.append(RunOptionModel(label=label, value=run_id, meta=summary_payload))
        if not runs:
            runs.append(RunOptionModel(label="Current dataset", value="current_run", meta={}))
        total_records = summary_payload.get("total_records") if isinstance(summary_payload, dict) else None
        return DatasetSummaryResponse(
            runs=runs,
            aggregated=aggregated,
            total_groups=len(groups),
            total_records=total_records if isinstance(total_records, int) else None,
            summary_metadata=summary_payload,
        )

    def _reported_ids(self) -> List[str]:
        return [entry.get("group_id") for entry in self._load_reports() if entry.get("group_id")]

    def list_groups(self, filters: GroupFilters) -> GroupListResponse:
        groups = self._load_groups()
        reported_ids = self._reported_ids()
        filtered = filter_groups(groups, filters=filters, reported_ids=reported_ids)
        summaries = [
            GroupSummary(
                group_id=group.get("group_id"),
                display_name=group.get("_display_name"),
                metrics=GroupMetrics(**group["_metrics"]),
                source_path=group.get("_source_path"),
                reported=group.get("group_id") in reported_ids,
            )
            for group in filtered
        ]
        aggregated = summarize_groups(filtered)
        return GroupListResponse(
            items=summaries,
            total=len(summaries),
            aggregated=aggregated,
            reported_ids=reported_ids,
        )

    def get_group_detail(
        self,
        group_id: str,
        *,
        transaction_filters: Optional[TransactionFilters] = None,
    ) -> GroupDetailResponse:
        groups = self._load_groups()
        target = next((g for g in groups if g.get("group_id") == group_id), None)
        if not target:
            raise ValueError(f"Group {group_id} not found")
        tx_filters = transaction_filters or TransactionFilters()
        filtered_transactions = self._apply_transaction_filters(target, tx_filters)
        group_model = GroupDetail(
            group_id=target.get("group_id"),
            display_name=target.get("_display_name"),
            metrics=GroupMetrics(**target["_metrics"]),
            source_path=target.get("_source_path"),
            reported=target.get("group_id") in self._reported_ids(),
            canonical_attributes=dict(target.get("canonical_attributes") or {}),
            members=_convert_members(target.get("members") or []),
            transactions=_convert_transactions(filtered_transactions),
        )
        snapshots = self._select_relevant_snapshots(target)
        return GroupDetailResponse(
            group=group_model,
            snapshots=snapshots,
            snapshot_count=len(snapshots),
        )

    def _apply_transaction_filters(
        self,
        group: Dict[str, Any],
        filters: TransactionFilters,
    ) -> List[Dict[str, Any]]:
        transactions = list(group.get("_transactions") or [])
        filtered: List[Dict[str, Any]] = []
        for tx in transactions:
            amount = tx.get("amount")
            if isinstance(amount, (int, float)):
                amount_value = float(amount)
            else:
                amount_value = 0.0
            if amount_value < filters.min_amount or amount_value > filters.max_amount:
                continue
            ts = tx.get("parsed_timestamp") or parse_iso_datetime(tx.get("timestamp"))
            if filters.start_date and (not ts or ts < filters.start_date):
                continue
            if filters.end_date and (not ts or ts > filters.end_date):
                continue
            filtered.append(tx)
        return filtered

    def _select_relevant_snapshots(self, group: Dict[str, Any], limit: int = 25) -> List[Dict[str, Any]]:
        snapshots = self._load_snapshots()
        if not snapshots:
            return []
        member_ids = {m.get("record_id") for m in group.get("members") or [] if m.get("record_id")}
        signature_set = set()
        for member in group.get("members") or []:
            for signature in member.get("signature_history") or []:
                signature_set.add(signature)
        tax_id = group.get("canonical_attributes", {}).get("tax_id")
        matched: List[Dict[str, Any]] = []
        for snapshot in snapshots:
            if not isinstance(snapshot, dict):
                continue
            if snapshot.get("record_id") in member_ids:
                matched.append(snapshot)
                continue
            if snapshot.get("signature") in signature_set:
                matched.append(snapshot)
                continue
            if tax_id and snapshot.get("normalized_attributes", {}).get("tax_id") == tax_id:
                matched.append(snapshot)
        return matched[:limit]

    def get_network(
        self,
        filters: GroupFilters,
        *,
        highlight_reported: bool,
    ) -> NetworkResponse:
        groups = self._load_groups()
        reported_ids = self._reported_ids()
        filtered = filter_groups(groups, filters=filters, reported_ids=reported_ids)
        return build_network_payload(
            filtered,
            reported_ids=reported_ids,
            highlight_reported=highlight_reported,
        )

    def list_reports(self) -> List[ReportRecord]:
        return [ReportRecord(**entry) for entry in self._load_reports() if isinstance(entry, dict)]

    def submit_report(self, request: ReportCreateRequest) -> ReportCreateResponse:
        if not request.reason.strip():
            raise ValueError("A reason is required to record a report")
        groups = self._load_groups()
        target = next((g for g in groups if g.get("group_id") == request.group_id), None)
        if not target:
            raise ValueError(f"Group {request.group_id} not found")
        ensure_reports_file(self._config.paths.reports_file)
        reports = self._load_reports()
        payload = {
            "timestamp": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "group_id": request.group_id,
            "reason": request.reason.strip(),
            "checks": [str(check) for check in request.checks],
            "snapshot": {
                "num_members": target["_metrics"]["member_count"],
                "total_amount": target["_metrics"]["total_amount"],
                "risk_score": target["_metrics"]["risk_score"],
            },
        }
        updated_reports = reports + [payload]
        self._update_reports_cache(updated_reports)
        return ReportCreateResponse(
            record=ReportRecord(**payload),
            total_reports=len(updated_reports),
        )

    def refresh(self) -> None:
        """Clear caches so subsequent calls pick up fresh artifacts."""

        self._groups_cache = None
        self._summary_cache = None
        self._snapshots_cache = None
        self._reports_cache = None

    def list_snapshots(self, *, limit: int) -> SnapshotListResponse:
        snapshots = self._load_snapshots()
        limited = snapshots[:limit]
        return SnapshotListResponse(items=limited, total=len(snapshots), limit=limit)


def get_service() -> GroupService:
    """Return a memoised service instance."""

    # Using a function attribute avoids module-level globals while keeping a warm cache.
    if not hasattr(get_service, "_instance"):
        get_service._instance = GroupService()  # type: ignore[attr-defined]
    return get_service._instance  # type: ignore[attr-defined]
