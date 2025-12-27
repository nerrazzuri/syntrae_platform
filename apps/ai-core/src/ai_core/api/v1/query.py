"""
Query API router integrating conversation and RAG services.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_
from ai_core.models.message import QueryRequest, QueryResponse
from ai_core.services.conversation_service import ConversationService
from ai_core.pipeline.rag_pipeline import RAGPipeline
from ai_core.pipeline.rag_pipeline import RAGPipeline
from shared.database.session import get_db
from ai_core.api.deps import require
from shared.database.models import (
    KnowledgeChunk,
    Document,
    KnowledgeBase,
    Tenant,
    CostSummary,
)
from shared.plans.registry import resolve_plan_label, get_plan
from shared.metrics.request_metrics import inc_request
from ai_core.api.deps import require
from ai_core.pipeline.audit_service import write_audit
import logging
import csv, io
import uuid
import re
import os
import asyncio

# Orchestrator (capability-based) imports
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.orchestrator.orchestrator import Orchestrator
from ai_core.capabilities.search import SearchCapability
from ai_core.capabilities.answer import AnswerCapability
from ai_core.capabilities.extract import ExtractCapability
from ai_core.capabilities.score import ScoreCapability

router = APIRouter(prefix="/v1", tags=["query"])

rag_pipeline = RAGPipeline()


@router.post("/query", response_model=QueryResponse)
async def post_query(
    payload: QueryRequest,
    request: Request,
    claims=Depends(require("retrieval:read", resource={"classification": "internal"})),
    db: Session = Depends(get_db),
) -> QueryResponse:
    # Only message and channel are strictly required; tenant will be derived from claims
    if not payload.message or not payload.channel:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required fields: message, channel",
        )

    # Derive tenant strictly from authenticated claims (never trust client-controlled fields)
    claims_tenant = str(claims.get("tenant_id") or "").strip()
    if not claims_tenant:
        raise HTTPException(status_code=401, detail="Invalid or missing token")
    # If client sent a tenantId, ensure it matches claims to prevent confused-deputy issues
    if payload.tenant_id and str(payload.tenant_id) != claims_tenant:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    # Use claims tenant downstream
    payload.tenant_id = claims_tenant
    # Cross-tenant enforcement for non-admins
    try:
        if str(claims.get("role")) != "ADMIN" and str(payload.tenant_id) != str(
            claims.get("tenant_id")
        ):
            # Audit and deny
            try:
                write_audit(
                    db,
                    str(payload.tenant_id),
                    claims.get("user_id"),
                    f"policy.denied:retrieval:read",
                    "policy",
                    str(payload.message)[:256],
                    "",
                    False,
                    0,
                )
            except Exception:
                pass
            raise HTTPException(status_code=403, detail="Tenant mismatch")
    except Exception:
        pass

    # Validate/convert UUIDs for DB compatibility
    try:
        tenant_uuid = uuid.UUID(str(payload.tenant_id))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid tenantId UUID")

    user_uuid = None
    if payload.user_id:
        try:
            user_uuid = uuid.UUID(str(payload.user_id))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid userId UUID")
    else:
        user_uuid = uuid.uuid4()

    # Sensitive attribute inference guard
    lower_q = payload.message.lower()
    sensitive_terms = [
        "ethnic",
        "ethnicity",
        "race",
        "hispanic",
        "religion",
        "sexual orientation",
    ]
    if any(term in lower_q for term in sensitive_terms):
        safe = {
            "response": "I can’t determine or infer a person’s protected characteristics. Please consult appropriate, consented records or escalate to a human agent.",
            "citations": [],
            "confidence": 0.0,
            "requiresHuman": True,
        }
        return QueryResponse(**safe)

    conversation_service = ConversationService(db)
    # Ensure UUID types where required by DB models: use deterministic UUIDs for test if missing
    conversation = conversation_service.get_or_create_conversation(
        tenant_id=tenant_uuid,
        user_id=user_uuid,
        channel=payload.channel,
        context=payload.context,
    )
    conversation_service.add_message(
        conversation, sender_type="USER", content=payload.message
    )
    # Load mutable conversation context (persist short-term memory like last person asked)
    convo_ctx = dict(conversation.context or {})

    # ---------------- Orchestrator feature flag short-circuit ----------------
    if os.getenv("ORCHESTRATOR_ENABLED", "false").lower() in {"1", "true", "yes"}:
        try:
            # Resolve plan label early for orchestrator gating
            try:
                t = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
                plan_label = resolve_plan_label(getattr(t, "subscription_tier", None))
            except Exception:
                plan_label = "free"
            allow_tools = plan_label in ("pro", "enterprise")
            # Build CapabilityRequest
            cap_req = CapabilityRequest(
                tenant_id=str(tenant_uuid),
                user_id=str(claims.get("user_id") or user_uuid),
                roles=[str(claims.get("role"))] if claims.get("role") else [],
                channel=payload.channel,
                input={"query": payload.message},
                context={
                    "conversation_id": str(getattr(conversation, "id", "")),
                    "flow": (payload.context or {}).get("flow"),
                    "plan": plan_label,
                    "tenant_access": True,
                },
                constraints={
                    "plan": plan_label,
                    "tenant_access": True,
                    "allow_tools": allow_tools,
                },
                trace_id=getattr(request.state, "correlation_id", None)
                if request
                else None,
            )
            # Use singletons from app state
            orch = getattr(request.app.state, "orchestrator", None)
            if orch is None:
                # Fallback (should not happen): create minimal capabilities map once
                capabilities = {
                    "search": SearchCapability(),
                    "answer": AnswerCapability(),
                    "extract": ExtractCapability(),
                    "score": ScoreCapability(),
                }
                orch = Orchestrator(capabilities)
            cap_res = await orch.run(cap_req)
            payload_out = (
                cap_res.payload
                if isinstance(cap_res.payload, dict)
                else {"response": str(cap_res.payload)}
            )
            # Persist assistant reply
            try:
                conversation_service.add_message(
                    conversation,
                    sender_type="SYSTEM",
                    content=str(payload_out.get("response", "")),
                )
            except Exception:
                pass
            return QueryResponse(**payload_out)
        except Exception as e:
            # If orchestrator path fails for any reason, fall back to legacy logic below
            logging.getLogger(__name__).exception(
                "orchestrator_path_failed",
                extra={
                    "tenant_id": str(tenant_uuid),
                    "trace_id": getattr(request.state, "correlation_id", None),
                    "flow": (payload.context or {}).get("flow") or "default",
                    "exc": e.__class__.__name__,
                },
            )

    # Helpers for normalization and matching
    def norm_col(s: str) -> str:
        s = s.strip().lower().replace("\ufeff", "")
        s = re.sub(r"[^a-z0-9]+", "_", s)
        return s.strip("_")

    def norm_name(s: str) -> str:
        return re.sub(r"\s+", " ", s.strip().lower().replace("\ufeff", ""))

    def name_variants(raw: str):
        n = norm_name(raw)
        variants = {n}
        if "," in raw:
            parts2 = [p.strip() for p in raw.replace("\ufeff", "").split(",")]
            if len(parts2) >= 2:
                variants.add(norm_name(f"{parts2[1]} {parts2[0]}"))
        return variants

    def looks_like_person(raw: str) -> bool:
        if not raw:
            return False
        s = raw.strip()
        sl = s.lower()
        # Exclude obvious non-person topics
        non_person_keywords = [
            "chapter",
            "program",
            "project",
            "management",
            "roles",
            "responsibilities",
            "governance",
            "policy",
            "process",
            "procedure",
            "guideline",
        ]
        if any(k in sl for k in non_person_keywords):
            return False
        # Disallow digits-heavy strings
        if re.search(r"\d", s):
            return False
        # Accept formats: "Last, First" or "First Last [Middle]?"
        if "," in s and len(s.split(",")) >= 2:
            return True
        tokens = [t for t in s.split() if t]
        return 2 <= len(tokens) <= 4

    # Plan label for metrics
    try:
        t = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
        plan_label = resolve_plan_label(getattr(t, "subscription_tier", None))
    except Exception:
        plan_label = "free"
    try:
        inc_request(plan_label, "/v1/query")
    except Exception:
        pass

    # Soft token quota enforcement (monthly)
    try:
        plan = get_plan(plan_label)
        limit_tokens = int(plan.get("limits", {}).get("max_tokens_per_month") or 0)
        if limit_tokens > 0:
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc)
            start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
            rows = (
                db.query(CostSummary.tokens_in, CostSummary.tokens_out)
                .filter(
                    CostSummary.tenant_id == str(tenant_uuid),
                    CostSummary.window_start >= start,
                )
                .all()
            )
            used = 0
            for r in rows:
                used += int(r[0] or 0) + int(r[1] or 0)
            if used >= int(limit_tokens * 0.98):
                try:
                    logging.getLogger("ai_core").info(
                        "plan_limit_hit",
                        extra={
                            "tenant_id": str(tenant_uuid),
                            "plan_type": plan_label,
                            "feature": "chat",
                            "action": "query",
                            "reason": "token_quota",
                            "status": 403,
                        },
                    )
                except Exception:
                    pass
                raise HTTPException(
                    status_code=403,
                    detail="Monthly token quota reached. Upgrade to Pro for higher limits.",
                )
    except HTTPException:
        raise
    except Exception:
        pass

    # Build tenant-specific corpus with associated columns metadata when available
    q = (
        db.query(
            KnowledgeChunk.content,
            KnowledgeChunk.embedding,
            Document.meta,
            KnowledgeChunk.meta,
        )
        .join(Document, KnowledgeChunk.document_id == Document.id)
        .join(KnowledgeBase, Document.knowledge_base_id == KnowledgeBase.id)
        .filter(KnowledgeBase.tenant_id == tenant_uuid)
    )
    # ABAC filtering: exclude restricted for non-admins
    try:
        if str(claims.get("role")) != "ADMIN":
            q = q.filter(Document.meta["classification"].astext != "restricted")
            # Document-level RBAC:
            # Allow docs with access in {tenant, public} or owned by the requesting user
            try:
                q = q.filter(
                    or_(
                        Document.meta["access"].astext.is_(None),
                        Document.meta["access"].astext.in_(["tenant", "public"]),
                        Document.meta["owner_user_id"].astext == str(user_uuid),
                    )
                )
                try:
                    logging.getLogger("ai_core").info(
                        "rbac_filter_applied",
                        extra={
                            "tenant_id": str(tenant_uuid),
                            "user_id": str(user_uuid),
                            "plan_type": plan_label,
                            "feature": "retrieval",
                            "action": "rbac_filter",
                        },
                    )
                except Exception:
                    pass
            except Exception:
                # If JSON filter not supported, proceed with classification-only
                pass
    except Exception:
        pass
    rows = q.order_by(KnowledgeChunk.created_at.desc()).limit(2000).all()
    corpus = [content for (content, _emb, _doc_meta, _kc_meta) in rows]
    [emb for (_content, emb, _doc_meta, _kc_meta) in rows]
    corpus_columns = []
    chunk_row_meta = []
    for _content, _emb, doc_meta, kc_meta in rows:
        cols = None
        if (
            isinstance(doc_meta, dict)
            and "columns" in doc_meta
            and isinstance(doc_meta["columns"], list)
        ):
            cols = [norm_col(str(c)) for c in doc_meta["columns"]]
        corpus_columns.append(cols)
        row_map = None
        if isinstance(kc_meta, dict) and isinstance(kc_meta.get("row"), dict):
            try:
                row_map = {
                    norm_col(str(k)): (
                        "" if kc_meta["row"][k] is None else str(kc_meta["row"][k])
                    )
                    for k in kc_meta["row"].keys()
                }
            except Exception:
                row_map = None
        chunk_row_meta.append(row_map)

    # Build lightweight candidate indices (avoid rag_service dependency for retirement path)
    if corpus:
        candidates = list(range(min(10, len(corpus))))
    else:
        candidates = []

    # -------- Short-term memory helpers (generic, not just pronouns) --------
    def read_memory_snippets(ctx: dict) -> list[str]:
        try:
            snips = ctx.get("memory_snippets", []) if isinstance(ctx, dict) else []
            return [s for s in snips if isinstance(s, str) and s.strip()]
        except Exception:
            return []

    def prepend_memory(preselected: list[str]) -> list[str]:
        try:
            mem_snips = read_memory_snippets(convo_ctx)
            # Dedup (case-insensitive) and cap to 6 memory items
            out = []
            seen = set()
            for s in mem_snips:
                sl = s.strip().lower()
                if sl in seen:
                    continue
                seen.add(sl)
                out.append(s.strip())
                if len(out) >= 6:
                    break
            return (out + preselected)[:12]
        except Exception:
            return preselected

    # Chapter navigation: answer "next chapter after chapter N"
    def detect_next_chapter_request(q: str):
        ql = q.lower()
        m = re.search(r"next\s+chapter\s+after\s+chapter\s+(\d+)", ql)
        if m:
            try:
                return int(m.group(1))
            except Exception:
                return None
        return None

    def extract_chapters(texts: list[str]) -> dict[int, str]:
        found: dict[int, str] = {}
        for t in texts:
            for line in t.splitlines():
                s = line.strip()
                if not s:
                    continue
                m = re.match(
                    r"^chapter\s+(\d+)\s*[\.:\-]?\s*(.*)$", s, flags=re.IGNORECASE
                )
                if m:
                    try:
                        num = int(m.group(1))
                        title = m.group(2).strip()
                        if num not in found and title:
                            found[num] = title
                    except Exception:
                        continue
        return found

    base_ch = detect_next_chapter_request(payload.message)
    if base_ch is not None:
        top_texts = [corpus[i] for i in (candidates[:8] if candidates else [])]
        chapters = extract_chapters(top_texts if top_texts else corpus)
        if (base_ch + 1) in chapters:
            next_num = base_ch + 1
            next_title = chapters[next_num]
            # Persist simple chapter memory
            try:
                convo_ctx["last_chapter"] = next_num
                convo_ctx["last_chapter_title"] = next_title
                conversation.context = convo_ctx
                db.add(conversation)
                db.commit()
                db.refresh(conversation)
            except Exception:
                db.rollback()
            reply = {
                "response": f"The next chapter is Chapter {next_num}: {next_title}.",
                "citations": [],
                "confidence": 0.9,
                "requiresHuman": False,
            }
            conversation_service.add_message(
                conversation, sender_type="SYSTEM", content=reply["response"]
            )
            return QueryResponse(**reply)
        else:
            no_next = {
                "response": "I couldn’t find the next chapter title in the uploaded content.",
                "citations": [],
                "confidence": 0.0,
                "requiresHuman": True,
            }
            conversation_service.add_message(
                conversation, sender_type="SYSTEM", content=no_next["response"]
            )
            return QueryResponse(**no_next)

    # Ordered-list extraction and follow-up memory (e.g., project management processes)
    def detect_list_request(q: str):
        ql = q.lower().strip()
        # Patterns: "first 3 ... of <topic>", "top 3 ... in <topic>", "next 5", "subsequent 5 ... of <topic>"
        m_first = re.search(r"\b(first|top)\s+(\d+)\b.*?(?:of|in)\s+(.+)$", ql)
        if m_first:
            n = int(m_first.group(2))
            topic = m_first.group(3).strip().rstrip("?").strip()
            return {"mode": "first", "n": n, "topic": topic}
        m_next = re.search(r"\b(next|subsequent)\s+(\d+)\b(?:.*?(?:of|in)\s+(.+))?", ql)
        if m_next:
            n = int(m_next.group(2))
            topic = (
                m_next.group(3).strip().rstrip("?").strip() if m_next.group(3) else None
            )
            return {"mode": "next", "n": n, "topic": topic}
        return None

    def extract_ordered_items(texts: list[str]) -> list[str]:
        items: list[str] = []
        for t in texts:
            for line in t.splitlines():
                s = line.strip()
                if not s:
                    continue
                if re.match(r"^(?:[-*•]\s+|\d+[\.)]\s+)", s):
                    # Remove bullet/number prefix
                    s = re.sub(r"^(?:[-*•]\s+|\d+[\.)]\s+)", "", s).strip()
                    if s and s not in items:
                        items.append(s)
        return items

    list_req = detect_list_request(payload.message)
    if list_req:
        topic = list_req.get("topic") or convo_ctx.get("last_list_topic")
        if not topic:
            no_topic = {
                "response": "Which topic are you referring to? For example: ‘first 3 processes of project management’.",
                "citations": [],
                "confidence": 0.0,
                "requiresHuman": False,
            }
            conversation_service.add_message(
                conversation, sender_type="SYSTEM", content=no_topic["response"]
            )
            return QueryResponse(**no_topic)

        # Gather top candidate texts as source for list extraction
        top_texts = [corpus[i] for i in (candidates[:6] if candidates else [])]
        items = extract_ordered_items(top_texts)

        # If we had a previous list and same topic, reuse items as source of truth
        if convo_ctx.get("last_list_topic") == topic and isinstance(
            convo_ctx.get("last_list_items"), list
        ):
            prev_items = [
                it
                for it in convo_ctx.get("last_list_items")
                if isinstance(it, str) and it
            ]
            # Prefer the longer list between prev and freshly extracted
            if len(prev_items) > len(items):
                items = prev_items

        if not items:
            no_items = {
                "response": f"I couldn’t find an ordered list of items for {topic}.",
                "citations": [],
                "confidence": 0.0,
                "requiresHuman": True,
            }
            conversation_service.add_message(
                conversation, sender_type="SYSTEM", content=no_items["response"]
            )
            return QueryResponse(**no_items)

        n = max(1, int(list_req.get("n", 1)))
        mode = list_req.get("mode")
        start_index = 0
        if mode == "next":
            # Continue from prior index if same topic
            if convo_ctx.get("last_list_topic") == topic and isinstance(
                convo_ctx.get("last_list_index"), int
            ):
                start_index = max(0, int(convo_ctx["last_list_index"]))

        end_index = min(len(items), start_index + n)
        slice_items = items[start_index:end_index]

        # Persist list memory
        try:
            convo_ctx["last_list_topic"] = topic
            convo_ctx["last_list_items"] = items
            convo_ctx["last_list_index"] = end_index
            conversation.context = convo_ctx
            db.add(conversation)
            db.commit()
            db.refresh(conversation)
        except Exception:
            db.rollback()

        numbered = [
            f"{i+1}. {it}" for i, it in enumerate(slice_items, start=start_index)
        ]
        response_text = (
            f"Here are the {'next' if mode=='next' else 'first'} {len(slice_items)} items for {topic}:\n"
            + "\n".join(numbered)
        )
        payload_out = {
            "response": response_text,
            "citations": [],
            "confidence": 0.8,
            "requiresHuman": False,
        }
        conversation_service.add_message(
            conversation, sender_type="SYSTEM", content=payload_out["response"]
        )
        return QueryResponse(**payload_out)

    # Schema-aware extraction for tabular rows
    def detect_requested_field(q: str):
        """Coarse intent detector for well-known fields; used only as a hint."""
        ql = q.lower()
        mapping = {
            "salary": [
                "salary",
                "annualsalary",
                "salaryamount",
                "pay",
                "compensation",
                "wage",
                "earning",
            ],
            "department": ["department", "dept", "division", "team", "unit"],
            "manager": [
                "manager",
                "managername",
                "supervisor",
                "boss",
                "reports to",
                "reporting manager",
            ],
            "employmentstatus": [
                "employmentstatus",
                "status",
                "employment status",
                "work status",
            ],
            "maritaldesc": [
                "marital status",
                "married",
                "single",
                "divorced",
                "widowed",
                "maritaldesc",
            ],
            "position": ["position", "title", "job title", "role", "designation"],
            "location": ["location", "office", "site", "workplace", "based in"],
            "recruitment_source": [
                "recruitment source",
                "hiring source",
                "recruitmentsource",
                "recruit source",
                "recruiting source",
                "sourcing channel",
            ],
            "last_performance_review_date": [
                "last performance review date",
                "last review date",
                "performance review date",
                "last appraisal date",
                "last evaluation date",
            ],
            "date_of_birth": [
                "dob",
                "date of birth",
                "birthday",
                "birth date",
                "birthdate",
                "dateofbirth",
            ],
            "performance_score": [
                "performance score",
                "performancescore",
                "rating",
                "review score",
                "appraisal score",
                "evaluation score",
            ],
        }
        for key, terms in mapping.items():
            if any(t in ql for t in terms):
                return key
        return None

    def resolve_field_column(
        q: str, available_cols: list[str]
    ) -> tuple[str | None, float]:
        """Resolve a free-form field phrase to a column name among available_cols.
        Returns (column_name, confidence).
        """
        import difflib

        qn = norm_col(q)
        cols = [norm_col(c) for c in (available_cols or [])]
        # Exact match
        if qn in cols:
            return qn, 1.0
        # Synonyms map to canonical columns; choose the first present in cols
        synonyms = {
            "salary": [
                "salary",
                "annualsalary",
                "salaryamount",
                "base_salary",
                "basepay",
                "pay",
                "compensation",
                "wage",
            ],
            "department": ["department", "dept", "division", "team", "unit"],
            "manager": [
                "manager",
                "managername",
                "reporting_manager",
                "supervisor",
                "boss",
            ],
            "employmentstatus": [
                "employment_status",
                "employmentstatus",
                "work_status",
                "status",
            ],
            "maritaldesc": [
                "marital",
                "marital_status",
                "maritalstatus",
                "maritaldesc",
                "married",
                "single",
                "divorced",
                "widowed",
            ],
            "position": ["position", "title", "job_title", "designation", "jobtitle"],
            "location": ["location", "office", "site", "workplace", "city", "state"],
            "recruitment_source": [
                "recruitment_source",
                "recruitmentsource",
                "hiring_source",
                "recruit_source",
                "recruiting_source",
                "sourcing_channel",
            ],
            "last_performance_review_date": [
                "last_performance_review_date",
                "performance_review_date",
                "last_review_date",
                "last_appraisal_date",
                "last_evaluation_date",
            ],
            "date_of_birth": [
                "dob",
                "date_of_birth",
                "dateofbirth",
                "birth_date",
                "birthdate",
            ],
            "performance_score": [
                "performance_score",
                "performancescore",
                "rating",
                "review_score",
                "appraisal_score",
                "evaluation_score",
            ],
        }
        for canon, syns in synonyms.items():
            if any(s in qn for s in syns):
                for s in syns:
                    if s in cols:
                        return s, 0.9
        # Token containment heuristic
        qtokens = [t for t in qn.split("_") if t]
        best = None
        best_score = 0.0
        for c in cols:
            ctokens = [t for t in c.split("_") if t]
            common = len(set(qtokens) & set(ctokens))
            score = common / max(1, len(set(qtokens)))
            if score > best_score:
                best_score = score
                best = c
        if best and best_score >= 0.5:
            return best, best_score
        # Fuzzy similarity as last resort
        matches = difflib.get_close_matches(qn, cols, n=1, cutoff=0.6)
        if matches:
            return matches[0], 0.6
        return None, 0.0

    def parse_csv_row(row_text: str):
        reader = csv.reader(io.StringIO(row_text))
        return next(reader)

    requested = detect_requested_field(payload.message)
    if requested:
        # Try to capture explicit name ("of/for NAME"); if missing, allow pronoun-only to rely on last_person memory
        person_match = re.search(
            r"(?:of|for)\s+([^?]+)", payload.message, flags=re.IGNORECASE
        )
        candidate = person_match.group(1).strip() if person_match else None
        pronoun_ref = any(
            p in re.findall(r"\b\w+\b", lower_q)
            for p in ["his", "her", "their", "him", "them"]
        )
        # Determine person context: either pronoun referring to memory, or the captured phrase looks like a person
        person_context = (pronoun_ref and bool(convo_ctx.get("last_person"))) or (
            candidate and looks_like_person(candidate)
        )
        if not person_context:
            # Not a person-specific query; answer via generic RAG/policy and return
            preselected_np = candidates[:6] if candidates else []
            # Augment with short-term memory interpreted snippets
            try:
                mem_buf = []
                if isinstance(conversation.context, dict):
                    mb = conversation.context.get("memory_buffer", [])
                    if isinstance(mb, list):
                        for entry in reversed(mb):
                            if isinstance(entry, dict):
                                ints = entry.get("interpreted", [])
                                if isinstance(ints, list):
                                    for s in ints:
                                        if isinstance(s, str) and s.strip():
                                            mem_buf.append(s.strip())
                # Dedup and cap memory items
                seen_mem = set()
                mem_unique = []
                for s in mem_buf:
                    sl = s.lower()
                    if sl in seen_mem:
                        continue
                    seen_mem.add(sl)
                    mem_unique.append(s)
                    if len(mem_unique) >= 6:
                        break
                preselected_np = (mem_unique + preselected_np)[:12]
            except Exception:
                pass
            # Always include general memory snippets for better context carryover
            preselected_np = prepend_memory(preselected_np)
            result_np = rag_pipeline.answer(
                payload.message,
                tenant_id=str(tenant_uuid),
                preselected_contexts=preselected_np,
                db=db,
                user_id=str(claims.get("user_id") or user_uuid),
                role=str(claims.get("role")) if claims and claims.get("role") else None,
            )
            conversation_service.add_message(
                conversation, sender_type="SYSTEM", content=result_np["response"]
            )
            # Persist generic memory snippet (last 10)
            try:
                snips = read_memory_snippets(convo_ctx)
                resp_txt = (result_np.get("response") or "").strip()
                if resp_txt:
                    snips.append(resp_txt)
                    if len(snips) > 10:
                        snips = snips[-10:]
                    convo_ctx["memory_snippets"] = snips
                    conversation.context = convo_ctx
                    db.add(conversation)
                    db.commit()
                    db.refresh(conversation)
            except Exception:
                db.rollback()
            return QueryResponse(**result_np)
        else:
            person_name_raw = candidate if candidate else convo_ctx.get("last_person")
            if not person_name_raw:
                no_person = {
                    "response": "Who are you asking about? Please include the person’s name (e.g., ‘What is the position of Jane Doe?’).",
                    "citations": [],
                    "confidence": 0.0,
                    "requiresHuman": False,
                }
                conversation_service.add_message(
                    conversation, sender_type="SYSTEM", content=no_person["response"]
                )
                return QueryResponse(**no_person)
            person_name_raw = person_name_raw.strip().strip("?")
            person_names = name_variants(person_name_raw)

        # First pass: find exact name matches (prefer structured metadata.row; fallback to parsing text row)
        matching_rows = []
        for i, cand in enumerate(corpus):
            col_to_val = {}
            row_map_meta = chunk_row_meta[i]
            if isinstance(row_map_meta, dict) and row_map_meta:
                col_to_val = row_map_meta
            else:
                # Fallback: parse "Record N:" mini-doc into key:value map
                try:
                    lines = [l.strip() for l in cand.splitlines() if l.strip()]
                    for line in lines[1:]:  # skip first line 'Record N:'
                        if ":" in line:
                            k, v = line.split(":", 1)
                            k2 = norm_col(k)
                            col_to_val[k2] = v.strip()
                except Exception:
                    col_to_val = {}

            # Determine row name
            name_cols = [
                "employee_name",
                "name",
                "employee",
                "empname",
                "full_name",
                "employee_full_name",
            ]
            row_name = None
            for nc in name_cols:
                if nc in col_to_val and str(col_to_val[nc]).strip() != "":
                    row_name = norm_name(str(col_to_val[nc]))
                    break

            # Check if this row matches the requested person
            is_match = False
            if row_name:
                # Check against all name variants
                for variant in person_names:
                    if row_name == norm_name(variant):
                        is_match = True
                        break

            if not is_match:
                # Fallback: check if any cell contains the exact name
                person_norms = {norm_name(v) for v in person_names}
                for v in col_to_val.values():
                    if norm_name(str(v)) in person_norms:
                        is_match = True
                        break

            if is_match:
                matching_rows.append((i, cand, col_to_val))

        # If no exact matches found, return error
        if not matching_rows:
            no_match = {
                "response": f"I couldn't find any records for {person_name_raw}. Please verify the name spelling or check if this person exists in the employee database.",
                "citations": [],
                "confidence": 0.0,
                "requiresHuman": True,
            }
            conversation_service.add_message(
                conversation, sender_type="SYSTEM", content=no_match["response"]
            )
            return QueryResponse(**no_match)

        # Second pass: resolve the requested field/column and extract value from matching rows
        best_value = None
        best_row_text = None
        best_score = -1.0

        canonical_name_for_memory = None
        for row_idx, row_text, col_to_val in matching_rows:
            # Resolve field column dynamically using available columns in this row
            resolved_col, confidence = resolve_field_column(
                payload.message if not requested else requested.replace("_", " "),
                list(col_to_val.keys()),
            )
            # Guard against mismatched name carry-over: if last_person exists but row name mismatches, skip
            lp = convo_ctx.get("last_person")
            if lp:
                try:
                    lp_norm = norm_name(lp)
                    row_name_val = None
                    for nc in [
                        "employee_name",
                        "name",
                        "employee",
                        "empname",
                        "full_name",
                        "employee_full_name",
                    ]:
                        if nc in col_to_val and str(col_to_val[nc]).strip() != "":
                            row_name_val = norm_name(str(col_to_val[nc]))
                            break
                    if row_name_val and row_name_val != lp_norm and not candidate:
                        # This row refers to a different person than memory; skip it
                        continue
                except Exception:
                    pass
            candidate_cols = []
            if resolved_col:
                candidate_cols.append(resolved_col)
            # Also consider the coarse intent (requested) as fallback
            if requested:
                candidate_cols.append(norm_col(requested))
            # Try candidates in order
            for k in candidate_cols:
                if k in col_to_val and str(col_to_val[k]).strip() != "":
                    score = 1.0 if k == resolved_col else 0.8
                    if score > best_score:
                        best_score = score
                        best_value = str(col_to_val[k]).strip()
                        best_row_text = row_text
                        for nc in [
                            "employee_name",
                            "name",
                            "employee",
                            "empname",
                            "full_name",
                            "employee_full_name",
                        ]:
                            if nc in col_to_val and str(col_to_val[nc]).strip() != "":
                                canonical_name_for_memory = str(col_to_val[nc]).strip()
                    break
        if best_value:
            # Format the response in a human-readable way
            person_display_name = canonical_name_for_memory or person_name_raw

            # Format response based on the field type
            if requested == "salary":
                # Format salary with currency symbol and thousands separator
                try:
                    salary_num = float(best_value.replace(",", "").replace("$", ""))
                    formatted_salary = f"${salary_num:,.0f}"
                    response_text = (
                        f"The salary of {person_display_name} is {formatted_salary}."
                    )
                except:
                    # Fallback if salary is not a number
                    response_text = (
                        f"The salary of {person_display_name} is {best_value}."
                    )
            elif requested == "department":
                response_text = (
                    f"The department of {person_display_name} is {best_value}."
                )
            elif requested == "manager":
                response_text = f"The manager of {person_display_name} is {best_value}."
            elif requested == "employmentstatus":
                response_text = (
                    f"The employment status of {person_display_name} is {best_value}."
                )
            elif requested == "position":
                response_text = f"{person_display_name} works as a {best_value}."
            elif requested == "location":
                response_text = f"{person_display_name} is located in {best_value}."
            elif requested == "recruitment_source":
                response_text = (
                    f"The recruitment source of {person_display_name} is {best_value}."
                )
            elif requested == "performance_score":
                response_text = (
                    f"The performance score of {person_display_name} is {best_value}."
                )
            else:
                # Generic format for other fields
                field_display = requested.replace("_", " ").title()
                response_text = f"The {field_display.lower()} of {person_display_name} is {best_value}."

            response_payload = {
                "response": response_text,
                "citations": [
                    {
                        "source": "row",
                        "title": "Matched record",
                        "relevance": 0.99,
                        "snippet": best_row_text[:160],
                    }
                ],
                "confidence": 0.9,
                "requiresHuman": False,
            }
            # Persist short-term memory of last referenced person
            try:
                convo_ctx["last_person"] = person_display_name
                conversation.context = convo_ctx
                db.add(conversation)
                db.commit()
                db.refresh(conversation)
            except Exception:
                db.rollback()
            conversation_service.add_message(
                conversation, sender_type="SYSTEM", content=response_payload["response"]
            )
            return QueryResponse(**response_payload)
        # Avoid falling back to generic RAG when a specific field was requested but not found
        field_display = requested.replace("_", " ").title()
        no_match = {
            "response": f"I found {person_name_raw} in the database, but their {field_display.lower()} information is not available or empty in the records.",
            "citations": [],
            "confidence": 0.0,
            "requiresHuman": True,
        }
        conversation_service.add_message(
            conversation, sender_type="SYSTEM", content=no_match["response"]
        )
        return QueryResponse(**no_match)

    # Fallback to generic RAG answer if no structured match
    # Use the previously retrieved candidates and limit to 6 (aligns with sample)
    preselected = candidates[:6] if candidates else []
    # Augment with short-term memory interpreted snippets
    try:
        mem_buf = []
        if isinstance(conversation.context, dict):
            mb = conversation.context.get("memory_buffer", [])
            if isinstance(mb, list):
                for entry in reversed(mb):
                    if isinstance(entry, dict):
                        ints = entry.get("interpreted", [])
                        if isinstance(ints, list):
                            for s in ints:
                                if isinstance(s, str) and s.strip():
                                    mem_buf.append(s.strip())
        # Dedup and cap memory items
        seen_mem = set()
        mem_unique = []
        for s in mem_buf:
            sl = s.lower()
            if sl in seen_mem:
                continue
            seen_mem.add(sl)
            mem_unique.append(s)
            if len(mem_unique) >= 6:
                break
        preselected = (mem_unique + preselected)[:12]
    except Exception:
        pass
    # Always include general memory snippets for better context carryover
    preselected = prepend_memory(preselected)
    # capture correlation and auth info for audit
    try:
        correlation_id = (
            getattr(__import__("builtins"), "getattr")(
                getattr(__import__("builtins"), "getattr")(
                    globals().get("request", request), "state", None
                ),
                "correlation_id",
                None,
            )
            if request
            else None
        )
    except Exception:
        correlation_id = None
    try:
        auth_type = getattr(request.state, "auth_type", None) if request else None
        api_key_id = getattr(request.state, "api_key_id", None) if request else None
    except Exception:
        auth_type = None
        api_key_id = None
    result = rag_pipeline.answer(
        payload.message,
        tenant_id=str(tenant_uuid),
        preselected_contexts=preselected,
        db=db,
        user_id=str(claims.get("user_id") or user_uuid),
        role=str(claims.get("role")) if claims and claims.get("role") else None,
        correlation_id=correlation_id,
        auth_type=auth_type,
        api_key_id=api_key_id,
    )
    # Persist short-term memory buffer (last 10) with interpreted outputs if available
    try:
        mem_key = "memory_buffer"
        buf = (
            list(conversation.context.get(mem_key, []))
            if isinstance(conversation.context, dict)
            else []
        )
        entry = {
            "q": payload.message,
            "interpreted": result.get("memory_interpreted", []),
        }
        buf.append(entry)
        # Cap memory buffer by plan
        mem_cap = 4 if plan_label == "free" else (10 if plan_label == "pro" else 20)
        if len(buf) > mem_cap:
            buf = buf[-mem_cap:]
        convo_ctx[mem_key] = buf
        # Also persist a generic memory snippet of the response (last 10)
        try:
            snips = read_memory_snippets(convo_ctx)
            resp_txt = (result.get("response") or "").strip()
            if resp_txt:
                snips.append(resp_txt)
                if len(snips) > 10:
                    snips = snips[-10:]
                convo_ctx["memory_snippets"] = snips
        except Exception:
            pass
        conversation.context = convo_ctx
        db.add(conversation)
        db.commit()
        db.refresh(conversation)
    except Exception:
        db.rollback()
    conversation_service.add_message(
        conversation, sender_type="SYSTEM", content=result["response"]
    )
    return QueryResponse(**result)
