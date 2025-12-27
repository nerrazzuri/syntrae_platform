from typing import Dict, Any, List, Optional
import time


class RAGPipeline:
    """
    Orchestrator coordinating schema expansion -> retrieval -> fusion -> reranking -> formatting.
    This module contains no heavy computation; it delegates to submodules.
    """

    def __init__(self):
        # Lazy imports to avoid startup overhead and circulars
        from .schema.schema_expander import SchemaExpander
        from .intent.intent_classifier import IntentClassifier
        from .intent.router import HybridContextualRouter
        from .structured.structured_executor import StructuredExecutor
        from .retriever.retriever_manager import RetrieverManager
        from .fusion.rank_fusion import RankFusion
        from .reranker.crossencoder_reranker import CrossEncoderReranker
        from .reranker.schema_bias_reranker import SchemaBiasReranker
        from .formatter.context_builder import ContextBuilder
        from .formatter.response_formatter import ResponseFormatter
        from .qc.post_generation_qc import PostGenerationQC
        from .fallback.confidence_checker import ConfidenceChecker
        from .fallback.semantic_fallback import SemanticFallback
        from .cache.cache_facade import PipelineCache
        import logging

        self.schema_expander = SchemaExpander()
        self.intent = IntentClassifier()
        self.intent_router = HybridContextualRouter()
        self.structured = StructuredExecutor()
        self.retriever = RetrieverManager()
        self.fusion = RankFusion()
        self.cross_reranker = CrossEncoderReranker()
        self.schema_bias = SchemaBiasReranker()
        self.context_builder = ContextBuilder()
        self.response_formatter = ResponseFormatter()
        self.qc = PostGenerationQC()
        self.confidence_checker = ConfidenceChecker()
        self.semantic_fallback = SemanticFallback(
            self.retriever, self.fusion, self.cross_reranker, self.schema_bias
        )
        self.cache = PipelineCache()
        self.log = logging.getLogger(__name__)

    def answer(
        self,
        query: str,
        tenant_id: str,
        preselected_contexts: Optional[List[str]] = None,
        db: Any = None,
        user_id: Optional[str] = None,
        role: Optional[str] = None,
        channel: Optional[str] = "web",
        correlation_id: Optional[str] = None,
        auth_type: Optional[str] = None,
        api_key_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """High-level pipeline flow. This mirrors current rag_service logic, but delegates work."""
        self.log.info(f"pipeline: start tenant={tenant_id}")
        import logging

        logger = logging.getLogger(__name__)
        # Structured logging
        try:
            from shared.logging.pipeline_logger import PipelineLogger

            plog = PipelineLogger(tenant_id)
        except Exception as e:
            logger.exception(
                "[rag.plog] init error",
                extra={"tenant_id": tenant_id, "action": "rag.answer"},
            )
            plog = None
        t_start = time.time()
        if plog:
            plog.emit({"query": query})
        # 1) Memory context: summary + recent turns (if session_id derivable from user/channel)
        conversation_context: List[Dict[str, Any]] = []
        memory_summary: Optional[str] = None
        try:
            if db and user_id:
                # derive a stable session_id from user_id+channel + day bucket
                import uuid as _uuid
                from datetime import datetime, timezone

                day = datetime.now(timezone.utc).strftime("%Y%m%d")
                sseed = f"{tenant_id}:{user_id}:{channel or 'web'}:{day}"
                session_id = str(_uuid.uuid5(_uuid.NAMESPACE_DNS, sseed))
                from ai_core.pipeline.memory.memory_service import MemoryService

                mem = MemoryService(db)
                mem_ctx = mem.get_context(tenant_id, session_id)
                memory_summary = mem_ctx.get("summary")
                # represent recent turns as pseudo-context for intent routing
                conversation_context = [
                    {
                        "role": t.split(":", 1)[0],
                        "text": t.split(":", 1)[1] if ":" in t else t,
                    }
                    for t in mem_ctx.get("recent_turns", [])
                ]
        except Exception as e:
            logger.exception(
                "[rag.context] fetch error",
                extra={"tenant_id": tenant_id, "action": "rag.answer"},
            )
            conversation_context = []
        decision = self.intent_router.classify(
            query, conversation_context, tenant_id, user_id or "anon"
        )
        intent = decision.intent
        self.log.info(f"pipeline: intent={intent}")
        if plog:
            plog.emit(
                {
                    "intent": intent,
                    "router_decision": {
                        "confidence": decision.confidence,
                        "source": decision.source,
                        "contextual_trigger": decision.contextual_trigger,
                    },
                }
            )

        expanded = self.schema_expander.expand(query, tenant_id)
        self.log.info(
            f"pipeline: expanded_terms={len(expanded.get('expanded_terms', []))}"
        )
        if plog:
            plog.emit(
                {"schema_expansion": {"count": len(expanded.get("expanded_terms", []))}}
            )

        retrieved = self.retriever.retrieve_all(
            query=query,
            tenant_id=tenant_id,
            db=db,
            preselected_contexts=preselected_contexts,
            expansion_terms=expanded.get("expanded_terms", []),
            user_id=user_id,
            role=role,
        )

        fused = self.fusion.fuse(
            bm25_texts=retrieved.get("bm25_texts", []),
            dense_hits=retrieved.get("dense_hits", []),
            field_value_hits=retrieved.get("field_value_hits", []),
            query=query,
            tenant_id=tenant_id,
        )
        self.log.info(f"pipeline: candidates after fuse={len(fused)}")
        if plog:
            plog.emit(
                {
                    "retrieval": {
                        "bm25_hits": len(retrieved.get("bm25_texts", [])),
                        "vector_hits": len(retrieved.get("dense_hits", [])),
                        "field_hits": len(retrieved.get("field_value_hits", [])),
                    }
                }
            )

        reranked_docs = self.cross_reranker.rerank(
            query,
            fused,
            rich_hits=retrieved.get("dense_hits", []),
            content_to_row=retrieved.get("content_to_row", {}),
        )
        reranked_docs = self.schema_bias.apply(
            query,
            reranked_docs,
            activated_fields=expanded.get("expanded_terms", []),
            rich_hits=retrieved.get("field_value_hits", []),
        )
        self.log.info(f"pipeline: reranked_docs={len(reranked_docs)}")
        if plog:
            plog.emit({"rerank": {"input": len(fused), "output": len(reranked_docs)}})
        # Audit retrieval/rerank
        try:
            if db:
                from ai_core.pipeline.audit_service import write_audit

                elapsed_ms = int((time.time() - t_start) * 1000)
                write_audit(
                    db=db,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    action="retrieval:rerank",
                    resource="knowledge",
                    request_text=query,
                    response_text="\n".join(
                        [
                            d.get("text", "")[:200]
                            if isinstance(d, dict)
                            else str(d)[:200]
                            for d in reranked_docs[:5]
                        ]
                    ),
                    success=True,
                    latency_ms=elapsed_ms,
                    model=None,
                    token_input=None,
                    token_output=None,
                    category="access",
                    auth_type=auth_type,
                    api_key_id=api_key_id,
                    correlation_id=correlation_id,
                )
        except Exception as e:
            logger.exception(
                "[rag.audit.retrieval] error",
                extra={"tenant_id": tenant_id, "action": "rag.answer"},
            )

        # 2) Structured executor for aggregate intent (prefer before retrieval)
        result_hint = None
        if intent == "aggregate":
            try:
                # Attempt to assemble a DataFrame from the most recent document's rows via retriever metadata
                import pandas as _pd  # type: ignore

                rows: List[Dict[str, Any]] = []
                schema_cols: List[str] = []
                for hit in retrieved.get("dense_hits", []):
                    pl = hit.get("payload", {})
                    meta = pl.get("metadata") or pl
                    row = meta.get("row") if isinstance(meta, dict) else None
                    if isinstance(row, dict) and row:
                        rows.append(row)
                    cols = pl.get("columns") or []
                    if isinstance(cols, list) and cols:
                        schema_cols = [str(c) for c in cols]
                if rows:
                    df = _pd.DataFrame(rows)
                    schema_info = {
                        "columns": [
                            c.lower()
                            for c in (
                                list(df.columns) if not schema_cols else schema_cols
                            )
                        ],
                        "types": {},
                    }
                    context = {"tenant_id": tenant_id, "intent": intent, "query": query}
                    agg = self.structured.execute(query, df, schema_info, context)
                    if agg and isinstance(agg.get("summary"), str):
                        # If we have a structured result, skip retrieval/rerank and answer directly
                        payload = self.response_formatter.generate(
                            query,
                            [agg.get("summary", "")],
                            intent=intent,
                            result_hint=agg.get("summary"),
                        )
                        self.log.info(
                            f"executor: used structured result -> {agg.get('summary')}"
                        )
                        if plog:
                            plog.emit(
                                {"executor": {"used": True, "operation": "aggregate"}}
                            )
                        return payload
            except Exception:
                self.log.warning("structured executor path failed; falling back")

        # Optional web-search fallback if tenant enabled and retrieval is empty
        ctx_texts = self.context_builder.build(reranked_docs)
        if not ctx_texts and db:
            try:
                from shared.database.models import Tenant as _Tenant
                t = db.query(_Tenant).filter(_Tenant.id == tenant_id).first()
                settings = (t.settings or {}) if t else {}
                if bool(settings.get("web_search_enabled", False)):
                    from ai_core.services.web_search import search as websearch

                    hits = websearch(query, max_results=3)
                    if hits:
                        # Build snippets from web results
                        structured_snippets = []
                        for i, h in enumerate(hits, start=1):
                            structured_snippets.append(
                                {
                                    "id": f"S{i}",
                                    "source_label": h.get("title") or f"Web {i}",
                                    "text": h.get("snippet") or "",
                                    "doc": {
                                        "document_id": None,
                                        "title": h.get("title"),
                                        "source_url": h.get("link"),
                                    },
                                }
                            )
                        payload = self.response_formatter.generate(
                            query, structured_snippets, intent=intent, tenant_id=tenant_id
                        )
                        return payload
            except Exception:
                pass
        # If still no context and web-search not used, return a standard helpful response
        if not ctx_texts:
            try:
                standard = (
                    "I couldn’t find relevant information in your workspace for this question.\n\n"
                    "- Try rephrasing with more specifics (topic, doc title, date).\n"
                    "- Ask about content you’ve uploaded (policies, procedures, FAQs).\n"
                    "- Or ask your admin to enable web search to broaden answers."
                )
                payload = self.response_formatter.generate(
                    query,
                    [standard],
                    intent="general",
                    result_hint=standard,
                    tenant_id=tenant_id,
                )
                return payload
            except Exception:
                pass
        # Prepend memory summary and recent exchanges to context (lightweight)
        memory_block: List[str] = []
        if memory_summary:
            memory_block.append(f"Previous summary:\n{memory_summary}")
        if conversation_context:
            try:
                pairs = []
                for rc in conversation_context[-5:]:
                    role = rc.get("role") or "user"
                    text = rc.get("text") or ""
                    pairs.append(f"{role.capitalize()}: {text}")
                if pairs:
                    memory_block.append("Recent exchanges:\n" + "\n".join(pairs))
            except Exception:
                pass
        if memory_block:
            ctx_texts = memory_block + ctx_texts
        # Build structured snippets with S# IDs and enrich with provenance when available
        structured_snippets = []
        try:
            text_to_meta = retrieved.get("text_to_docmeta", {})
        except Exception:
            text_to_meta = {}
        try:
            for i, t in enumerate(ctx_texts[: min(30, len(ctx_texts))], start=1):
                sid = f"S{i}"
                meta = text_to_meta.get(t, {}) if isinstance(text_to_meta, dict) else {}
                title = meta.get("title") or f"Context {i}"
                structured_snippets.append(
                    {
                        "id": sid,
                        "source_label": title,
                        "text": t,
                        "doc": {
                            "document_id": meta.get("document_id"),
                            "title": meta.get("title"),
                            "source_url": meta.get("source_url"),
                        },
                    }
                )
        except Exception:
            structured_snippets = [
                {"id": f"S{i+1}", "source_label": f"Context {i+1}", "text": t}
                for i, t in enumerate(ctx_texts[:30])
            ]
        payload = self.response_formatter.generate(
            query,
            structured_snippets,
            intent=intent,
            result_hint=result_hint,
            tenant_id=tenant_id,
        )
        if plog:
            try:
                model_name = getattr(
                    getattr(self.response_formatter, "_llm", None), "model", "unknown"
                )
            except Exception:
                model_name = "unknown"
            plog.emit({"generation": {"model": model_name, "ctx_used": len(ctx_texts)}})
        try:
            payload = self.qc.run(
                self.response_formatter._llm,
                payload,
                query,
                structured_snippets,
                intent,
                result_hint,
            )
            if plog:
                qc = payload.get("qc_status", {})
                plog.emit(
                    {
                        "qc": {
                            "confidence": qc.get("confidence"),
                            "rewrite": qc.get("rewrite_used"),
                        }
                    }
                )
        except Exception as e:
            logger.exception(
                "[rag.qc] error", extra={"tenant_id": tenant_id, "action": "rag.answer"}
            )
        # Propagate QC confidence to top-level and record metric
        try:
            qc_conf = float(payload.get("qc_status", {}).get("confidence", 0.0))
            payload["confidence"] = qc_conf
            try:
                from shared.metrics.quality_metrics import quality_metrics

                quality_metrics.set_response_conf(tenant_id, qc_conf)
            except Exception:
                pass
        except Exception:
            pass
        self.log.info(
            f"pipeline: response_len={len(payload.get('response',''))} ctx_used={len(ctx_texts)}"
        )
        # Audit generation
        try:
            if db:
                from ai_core.pipeline.audit_service import write_audit

                model_name = getattr(
                    getattr(self.response_formatter, "_llm", None), "model", "unknown"
                )
                elapsed_ms = int((time.time() - t_start) * 1000)
                write_audit(
                    db=db,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    action="generation:answer",
                    resource="llm",
                    request_text=query,
                    response_text=str(payload.get("response", ""))[:1000],
                    success=True,
                    latency_ms=elapsed_ms,
                    model=model_name,
                    token_input=None,
                    token_output=None,
                    category="generation",
                    auth_type=auth_type,
                    api_key_id=api_key_id,
                    correlation_id=correlation_id,
                )
        except Exception as e:
            logger.exception(
                "[rag.audit.generation] error",
                extra={"tenant_id": tenant_id, "action": "rag.answer"},
            )

        if self.confidence_checker.low(payload):
            fb = self.semantic_fallback.run(query, tenant_id, db)
            if fb:
                self.log.info("pipeline: semantic fallback used")
                if plog:
                    plog.emit({"fallback": {"used": True}})
                return fb

        if plog:
            plog.emit({"latency_ms": int((time.time() - t_start) * 1000)})

        # Attach intent metadata for downstream consumers (eval, UI)
        try:
            payload["intent"] = intent
            payload["intent_decision"] = {
                "intent": decision.intent,
                "confidence": decision.confidence,
                "source": decision.source,
                "contextual_trigger": decision.contextual_trigger,
                "tenant_overrides_used": decision.tenant_overrides_used,
            }
        except Exception:
            pass

        # Persist memory for this turn (user query + assistant reply)
        try:
            if db and user_id:
                import uuid as _uuid
                from datetime import datetime, timezone

                day = datetime.now(timezone.utc).strftime("%Y%m%d")
                sseed = f"{tenant_id}:{user_id}:{channel or 'web'}:{day}"
                session_id = str(_uuid.uuid5(_uuid.NAMESPACE_DNS, sseed))
                from ai_core.pipeline.memory.memory_service import MemoryService

                mem = MemoryService(db)
                mem.append_turn(tenant_id, session_id, "user", query)
                mem.append_turn(
                    tenant_id, session_id, "assistant", str(payload.get("response", ""))
                )
        except Exception:
            pass

        return payload
