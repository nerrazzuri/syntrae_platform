import hashlib
import datetime
from typing import List, Dict, Optional, Any
from .schemas import (
    JWTPayload, RetrieveRequest, RetrieveResponse, SearchResult, GovernanceMetadata,
    ContentRequest, ContentResponse, DocumentContent
)

class AuthError(Exception):
    pass

class PermissionError(Exception):
    pass

class ServiceUnavailable(Exception):
    pass

class RateLimitExceeded(Exception):
    pass

class PayloadTooLarge(Exception):
    pass

class ConflictError(Exception):
    pass

class RAGGatewayService:
    """
    Phase 0: RAG Contract Gateway.
    Enforces security, isolation, and strict API contracts.
    """
    def __init__(self):
        # Mock Backend Storage
        # Tenant -> [Docs]
        self._backend_data = {
            "t1": [
                {"id": "doc1", "content": "This is doc 1 content.", "meta": {"type": "faq"}},
                {"id": "doc2", "content": "This is doc 2 content.", "meta": {"type": "product_info"}},
                {"id": "doc_url", "content": "Check http://example.com", "meta": {"type": "faq"}},
                {"id": "doc_price", "content": "Price is $10", "meta": {"type": "product_info"}}
            ],
            "t2": [
                {"id": "doc3", "content": "Tenant 2 private doc.", "meta": {"type": "faq"}}
            ]
        }
        
        # Simulation Flags
        self.qdrant_down = False
        self.postgres_down = False
        
        # Rate Limit Mock: token -> count
        self._rate_limits = {}

    def verify_token(self, token: str) -> JWTPayload:
        if not token:
            raise AuthError("Missing Authorization")

        # Mock JWT Validation
        # Format: "mock_jwt_tenantID_service_scopes[_expired]"
        # e.g. "mock_jwt_t1_phase5_rag.retrieve"
        if not token.startswith("mock_jwt_"):
            raise AuthError("Invalid Token Format")
        
        parts = token.replace("mock_jwt_", "").split("_")
        if len(parts) < 3:
            raise AuthError("Invalid Token Payload")
        
        tenant_id = parts[0]
        service = parts[1]
        scopes_str = parts[2]
        scopes = scopes_str.split(",")
        
        if "expired" in parts:
             raise AuthError("Token Expired")
        
        # Phase Boundary Check (Mock Logic)
        if service.startswith("phase1") or service.startswith("phase2") or service.startswith("phase3") or service.startswith("phase4"):
             raise PermissionError("rag_access_not_allowed_for_phase")
        if service.startswith("phase6") or service.startswith("phase7"):
             raise PermissionError("rag_access_not_allowed_for_phase")
        
        return JWTPayload(
            caller_service=service,
            scopes=scopes,
            tenant_id=tenant_id,
            exp=datetime.datetime.now() + datetime.timedelta(hours=1)
        )
    
    def _check_rate_limit(self, caller: str):
        count = self._rate_limits.get(caller, 0)
        if count >= 10: # Mock limit
             raise RateLimitExceeded("Too Many Requests")
        self._rate_limits[caller] = count + 1

    def process_retrieve(self, token: str, request: RetrieveRequest) -> RetrieveResponse:
        # Gate 1: Auth
        payload = self.verify_token(token)
        self._check_rate_limit(payload.caller_service)

        # Scopes
        if "rag.retrieve" not in payload.scopes:
             raise PermissionError("Missing scope: rag.retrieve")
             
        # Phase 5 Check (Implicit via Caller Service or just allowed if scope present + not blocked above)
        # Phase 5 is allowed.

        # Gate 2: Isolation (Tenant from Token)
        tenant_id = payload.tenant_id
        
        # Infrastructure Check
        if self.qdrant_down:
             raise ServiceUnavailable("Qdrant Unavailable")

        # Call Backend
        results = self._mock_backend_retrieve(tenant_id, request.query, request.top_k)
        
        return RetrieveResponse(results=results)

    def process_content(self, token: str, request: ContentRequest) -> ContentResponse:
        # Gate 1: Auth
        payload = self.verify_token(token)
        self._check_rate_limit(payload.caller_service)
        
        # Scopes
        if "rag.content.read" not in payload.scopes:
             raise PermissionError("Missing scope: rag.content.read")
             
        # Phase 8 Check (Implicit via Caller Service or Scope)
        
        # Gate 2: Isolation
        tenant_id = payload.tenant_id
        
        # Infrastructure Check
        if self.postgres_down:
             raise ServiceUnavailable("Postgres Unavailable")

        # Call Backend
        docs = self._mock_backend_content(tenant_id, request.doc_refs)
        
        return ContentResponse(docs=docs)

    def _mock_backend_retrieve(self, tenant_id: str, query: str, top_k: int) -> List[SearchResult]:
        # Simulate Qdrant Search with strict tenant filter
        tenant_docs = self._backend_data.get(tenant_id, [])
        results = []
        
        count = 0
        for d in tenant_docs:
            if count >= top_k:
                 break
            
            # Versioning
            version = hashlib.sha256(d["content"].encode()).hexdigest()[:8]
            
            # Governance
            gov = GovernanceMetadata(
                doc_type=d["meta"].get("type", "general"),
                contains_url="http" in d["content"],
                contains_price="$" in d["content"],
                language="en",
                compliance_level="safe"
            )
            
            results.append(SearchResult(
                doc_id=d["id"],
                version=version,
                score=0.9,
                metadata=gov
            ))
            count += 1
            
        return results

    def _mock_backend_content(self, tenant_id: str, doc_refs: List[str]) -> List[DocumentContent]:
        # doc_refs format "doc_id:version"
        tenant_docs = self._backend_data.get(tenant_id, [])
        out_docs = []
        
        doc_map = {d["id"]: d for d in tenant_docs}
        
        for ref in doc_refs:
            if ":" not in ref:
                continue
            did, v_req = ref.split(":")
            
            # Cross Tenant Check implicitly handled by doc_map lookup from tenant-specific list
            if did in doc_map:
                d = doc_map[did]
                
                # Check Metadata Existence (Mock rule: all in mock have meta, but test might check missing)
                if "meta" not in d:
                     raise ConflictError("metadata_missing")

                # Size Limit (Mock: > 1000 chars)
                if len(d["content"]) > 1000:
                     raise PayloadTooLarge("Payload Too Large")

                # Re-compute version to verify
                v_computed = hashlib.sha256(d["content"].encode()).hexdigest()[:8]
                # In mock we assume requested version matches current (or we could throw if mismatch)
                # Let's say we return current content if ID matches, but strictly we should check version.
                # If v_req != v_computed, it means concurrent update or old ref. 
                # For simplicity in mock, allow if ID matches but in real life we fetch specific version.
                
                out_docs.append(DocumentContent(
                    doc_id=did,
                    version=v_computed,
                    content=d["content"]
                ))
            else:
                # Cross Tenant Attempt or Not Found
                # Log incident
                pass
        
        return out_docs
