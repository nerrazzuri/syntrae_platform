from __future__ import annotations

import hashlib
import time
from typing import Any, Dict, List, Union

from ai_core.capabilities.base import Capability
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse


"""
RecommendCapability

Supported context/constraints keys:
- context.candidates: pre-ranked or raw candidates (list[str|dict])
- context.shown_ids: list of item ids to suppress (already shown to user)
- context.suppress_ids: additional ids to suppress
- context.top_k or constraints.top_k: integer cap for returned items (default 5)
- context.flow: name of the active flow for telemetry

Inputs may also be sourced from request.input:
- input.scores: reranked candidates from prior 'score' capability
- input.retrieved: raw candidates from 'search' capability
"""


def _hash_id(text: str) -> str:
    sha = hashlib.sha1()
    sha.update(text.encode("utf-8", errors="ignore"))
    return sha.hexdigest()


def _normalize_candidates(
    candidates: List[Union[str, Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for idx, c in enumerate(candidates):
        if isinstance(c, str):
            item_id = _hash_id(c)
            title = c.strip().splitlines()[0][:80] if c else f"item-{idx+1}"
            normalized.append(
                {"id": item_id, "title": title, "content": c, "score": None}
            )
        elif isinstance(c, dict):
            # Accept common fields; fall back to hashing content if no id
            content = str(c.get("content") or c.get("text") or c.get("body") or "")
            item_id = str(
                c.get("id") or (_hash_id(content) if content else f"item-{idx+1}")
            )
            title = str(
                c.get("title")
                or c.get("label")
                or (content.strip().splitlines()[0][:80] if content else item_id)
            )
            score = c.get("score")
            if score is not None:
                try:
                    score = float(score)
                except Exception:
                    score = None
            normalized.append(
                {"id": item_id, "title": title, "content": content, "score": score}
            )
        else:
            continue
    return normalized


class RecommendCapability(Capability):
    async def execute(self, request: CapabilityRequest) -> CapabilityResponse:
        try:
            ctx = request.context or {}
            cons = request.constraints or {}

            # Source candidates from context (pre-ranked or raw)
            raw_candidates: List[Union[str, Dict[str, Any]]] = list(
                ctx.get("candidates") or []
            )

            # Fallbacks: allow flows to have placed candidates in input as 'scores' (reranked) or 'retrieved' (raw)
            if not raw_candidates:
                raw_candidates = list(
                    request.input.get("scores") or request.input.get("retrieved") or []
                )

            if not raw_candidates:
                return CapabilityResponse(
                    kind="recommend",
                    payload={"items": []},
                    telemetry={"reason": "no_candidates"},
                )

            items = _normalize_candidates(raw_candidates)

            # Diversity: deduplicate by id/content hash
            seen: set[str] = set()
            deduped: List[Dict[str, Any]] = []
            for it in items:
                if it["id"] in seen:
                    continue
                seen.add(it["id"])
                deduped.append(it)

            # Suppression: remove items already shown
            shown_ids = set(
                (ctx.get("shown_ids") or []) + (ctx.get("suppress_ids") or [])
            )
            filtered = [it for it in deduped if it["id"] not in shown_ids]

            # Rank: preserve incoming order; assign scores if missing
            for rnk, it in enumerate(filtered, start=1):
                if it.get("score") is None:
                    # simple descending score based on order (normalized)
                    it["score"] = max(0.0, 1.0 - (rnk - 1) * 0.01)
                it["rank"] = rnk
                # Mandatory explainability
                it["reason"] = (
                    "High relevance to query"
                    if rnk <= 3
                    else "Similar to prior results"
                )

            # Top-K
            top_k = int(ctx.get("top_k") or cons.get("top_k") or 5)
            out = filtered[: max(0, top_k)]

            # Minimal observability: items_shown event list (no side effects)
            ts = int(time.time())
            telemetry = {
                "items_shown": [
                    {
                        "tenant_id": request.tenant_id,
                        "user_id": request.user_id,
                        "item_id": it["id"],
                        "flow": (ctx.get("flow") or "unknown"),
                        "ts": ts,
                    }
                    for it in out
                ]
            }

            return CapabilityResponse(
                kind="recommend", payload={"items": out}, telemetry=telemetry
            )
        except Exception as e:
            return CapabilityResponse(
                kind="error", payload={"error": "recommend_failed", "detail": str(e)}
            )
