from typing import Any, Dict
from ai_core.capabilities.base import Capability
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse
from ai_core.pipeline.retriever.retriever_manager import RetrieverManager
from ai_core.pipeline.fusion.rank_fusion import RankFusion
from shared.database.session import SessionLocal


class SearchCapability(Capability):
    async def execute(self, request: CapabilityRequest) -> CapabilityResponse:
        query = request.input.get("query", "")
        rm = RetrieverManager()
        rf = RankFusion()
        db = SessionLocal()
        try:
            retrieved = rm.retrieve_all(
                query=query,
                tenant_id=request.tenant_id,
                db=db,
                user_id=request.user_id,
                role=",".join(request.roles) if request.roles else None,
            )
            fused = rf.fuse(
                bm25_texts=retrieved.get("bm25_texts", []),
                dense_hits=retrieved.get("dense_hits", []),
                field_value_hits=retrieved.get("field_value_hits", []),
                query=query,
                tenant_id=request.tenant_id,
            )
            return CapabilityResponse(
                kind="search",
                payload=fused,
                citations=None,
                telemetry={
                    "retrieval": {
                        "bm25": len(retrieved.get("bm25_texts", [])),
                        "dense": len(retrieved.get("dense_hits", [])),
                        "field": len(retrieved.get("field_value_hits", [])),
                    }
                },
            )
        finally:
            db.close()
